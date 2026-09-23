import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import mysql from 'mysql2/promise'

import { apiRequest } from '../../helpers/api.mjs'
import { config } from '../../helpers/config.mjs'
import { writeReport, STATUS } from '../../helpers/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES_DIR = path.resolve(__dirname, '../../preuves')

function result({ id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '', duration }) {
  const module = id.split('-')[0]
  return {
    id,
    priority,
    module,
    scenario,
    type,
    status,
    result: resultText,
    date: new Date().toISOString(),
    duration: `${duration ?? 0} ms`,
    proof,
    error,
    comment,
  }
}

async function loginPage(browser, email, password) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  return page
}

async function capture(page, fileName) {
  const filePath = path.join(PREUVES_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  return fileName
}

async function login(email) {
  const r = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password: 'RecetteGMES@2026!' },
  })
  return r.data?.accessToken
}

async function downloadBytes(token, urlPath) {
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, buffer }
}

async function readSignatureFields(requestId) {
  const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
  try {
    const [rows] = await conn.execute(
      'SELECT validator_signature_type AS sigType, validator_signature_data AS sigData FROM leave_requests WHERE id = ?',
      [requestId],
    )
    const row = rows[0] ?? {}
    return { type: row.sigType ?? null, data: row.sigData ?? null }
  } finally {
    await conn.end()
  }
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []

  console.log('Préparation fixture LEA...')
  const [colAToken, colBToken, respToken, rhToken, adminToken] = await Promise.all([
    login('col-a.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('admin.recette@gmes.fr'),
  ])

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const leaveType = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Congés payés LEA',
      category: 'DEMANDE_CONGE',
      deductsPaidLeaveBalance: true,
      documentRequired: false,
      documentCanBeAddedLater: false,
      employeeCanCreate: true,
      rhOnly: false,
      allowsDays: true,
      allowsHalfDays: true,
      allowsHours: false,
      requiresValidation: true,
    },
  })
  const leaveTypeId = leaveType.data?.id

  const svc = await apiRequest('/services', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Service LEA', serviceType: 'INTERNE', minimumPresence: 3, hasMinimumPresenceRule: true },
  })
  const serviceId = svc.data?.id
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  await apiRequest('/leave-balances/initialize', {
    method: 'POST',
    token: rhToken,
    body: { employeeId: colA.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'Fixture LEA.' },
  }).catch(() => {})

  // Précondition LEA-001 : brouillon COL-A.
  const draft = await apiRequest('/leave-requests', {
    method: 'POST',
    token: colAToken,
    body: { leaveTypeId, startDate: '2026-12-10', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
  })
  const requestId = draft.data?.id

  const browser = await chromium.launch({ headless: true })

  // ===== LEA-001 — Collaborateur met à jour son brouillon (UI) =====
  {
    const start = Date.now()
    let page
    try {
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: 'Congés payés LEA' }).first().click()
      await page.waitForSelector('.nr-cal', { timeout: 10000 })

      await page.locator('.nr-cal__cell[aria-label="2026-12-14"]').first().click()
      await page.locator('.nr-cal__cell[aria-label="2026-12-15"]').first().click()

      const patchPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'PATCH' && /\/leave-requests\/\d+$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.nr-recap__actions button').first().click()
      const patchResp = await patchPromise
      const patchHttp = patchResp.status()
      let patchBody = null
      try { patchBody = await patchResp.json() } catch { patchBody = null }
      await page.waitForTimeout(400)
      await capture(page, 'CAP-LEA-001.png')

      const after = await apiRequest(`/leave-requests/${requestId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      const ok = patchHttp === 200 &&
        patchBody?.id === requestId &&
        after.data?.employeeId === colA.id &&
        after.data?.leaveTypeId === leaveTypeId &&
        after.data?.startDate === '2026-12-14' &&
        after.data?.endDate === '2026-12-15' &&
        after.data?.status === 'BROUILLON'

      results.push(result({
        id: 'LEA-001',
        priority: 'P2',
        scenario: 'Collaborateur met à jour son brouillon',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PATCH UI HTTP=${patchHttp} | requestId=${requestId} | dates ${after.data?.startDate}→${after.data?.endDate} | statut=${after.data?.status} | balance ${nBefore?.availableDays}→${nAfter?.availableDays} | reserved ${nBefore?.reservedDays}→${nAfter?.reservedDays} | mouvements ${histBeforeList.length}→${histAfterList.length}`,
        proof: 'CAP-LEA-001.png',
        error: ok ? '' : 'Mise à jour UI du brouillon non conforme.',
        comment: `propriétaire=COL-A (${colA.id}), route=/app/new-request/${requestId}`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-001 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-001', priority: 'P2', scenario: 'Collaborateur met à jour son brouillon', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // Soumettre pour LEA-002 (signature).
  await apiRequest(`/leave-requests/${requestId}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

  // ===== LEA-002 — Responsable consulte les alertes de disponibilité (UI) =====
  {
    const start = Date.now()
    let page
    try {
      const mgmt = await apiRequest('/leave-requests/management/all', { token: respToken })
      const mgmtRow = (Array.isArray(mgmt.data) ? mgmt.data : []).find((r) => r.id === requestId)
      const alerts = await apiRequest(`/leave-requests/management/${requestId}/alerts`, { token: respToken })

      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/requests"]')
      await page.waitForSelector('.manager-all-requests-filter-button', { timeout: 10000 })
      await page.click('.manager-all-requests-filter-button')
      await page.waitForSelector('.manager-all-requests-filter-panel', { timeout: 10000 })
      await page.locator('.manager-all-requests-filter-panel select').first().selectOption({ label: 'Congés payés LEA' })
      await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(400)

      const row = page.locator('.manager-all-requests-row--data', { hasText: 'COL-A Recette' }).first()
      const rowClass = await row.getAttribute('class')
      const isWarning = String(rowClass ?? '').includes('is-warning')
      const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      await capture(page, 'CAP-LEA-002.png')

      const ok = mgmt.status === 200 &&
        mgmtRow?.hasAvailabilityAlert === true &&
        mgmtRow?.minimumPresenceBreached === true &&
        alerts.data?.minimumPresenceBreached === true &&
        alerts.data?.minimumPresence === 3 &&
        isWarning

      results.push(result({
        id: 'LEA-002',
        priority: 'P2',
        scenario: 'Responsable consulte les alertes de disponibilité',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI filtre type appliqué | ligne alerte (is-warning)=${isWarning} | API hasAvailabilityAlert=${mgmtRow?.hasAvailabilityAlert} minimumPresenceBreached=${mgmtRow?.minimumPresenceBreached} | minimumPresence=${alerts.data?.minimumPresence}`,
        proof: 'CAP-LEA-002.png',
        error: ok ? '' : 'Alerte de disponibilité non visible pour le Responsable.',
        comment: `requestId=${requestId}, texte ligne="${rowText}"`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-002 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-002', priority: 'P2', scenario: 'Responsable consulte les alertes de disponibilité', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-003 — RH ne reprend pas la demande avant le délai sans urgence =====
  {
    const start = Date.now()
    let page
    try {
      const rhMe = await apiRequest('/users/me', { token: rhToken })
      const rhId = rhMe.data?.id

      const assignBackup = await apiRequest(`/services/${serviceId}/validators`, {
        method: 'POST',
        token: adminToken,
        body: { validatorId: rhId },
      })
      const validators = await apiRequest(`/services/${serviceId}/validators`, { token: adminToken })
      const backupList = Array.isArray(validators.data?.backupValidators) ? validators.data.backupValidators : []
      const rhInBackup = backupList.some((v) => Number(v.validatorId) === Number(rhId))

      const before = await apiRequest(`/leave-requests/${requestId}`, { token: rhToken })
      const submittedAtMain = before.data?.submittedAt
      const takeoverAtMain = submittedAtMain ? new Date(new Date(submittedAtMain).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
      const sigBefore = await readSignatureFields(requestId)

      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      const attempt = await apiRequest(`/leave-requests/${requestId}/validate`, {
        method: 'POST',
        token: rhToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })
      const after = await apiRequest(`/leave-requests/${requestId}`, { token: rhToken })
      const sigAfter = await readSignatureFields(requestId)

      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      // Témoin : même configuration, submittedAt vieilli au-delà du délai.
      const witnessDraft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-22', endDate: '2026-12-23', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const witnessId = witnessDraft.data?.id
      const witnessSubmit = await apiRequest(`/leave-requests/${witnessId}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
      try {
        await conn.execute('UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id = ?', [witnessId])
      } finally {
        await conn.end()
      }
      const witnessBefore = await apiRequest(`/leave-requests/${witnessId}`, { token: rhToken })
      const submittedAtWitness = witnessBefore.data?.submittedAt

      const witnessAttempt = await apiRequest(`/leave-requests/${witnessId}/validate`, {
        method: 'POST',
        token: rhToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })

      // UI RH : ouvrir la demande exacte puis l'action de validation.
      let proof = ''
      let uiRequestFound = false
      let uiActionPresent = false
      try {
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
        const row = page.locator('.rh-events-row--data', { hasText: 'COL-A Recette' }).first()
        await row.click()
        await page.waitForTimeout(700)
        const valBtnCount = await page.locator('.manager-request-action--validate').count()
        uiRequestFound = (await page.locator('body').innerText()).includes('COL-A Recette')
        uiActionPresent = valBtnCount > 0
        proof = await capture(page, 'CAP-LEA-003.png')
      } catch { proof = '' }

      const mainRefusedByDelay = attempt.status === 403
      const witnessEligible = witnessAttempt.status === 400 && String(witnessAttempt.data?.message ?? '').includes('justification')
      const unchanged = before.data?.status === after.data?.status &&
        before.data?.finalDeciderId === after.data?.finalDeciderId &&
        before.data?.finalDeciderRole === after.data?.finalDeciderRole &&
        Number(nBefore?.availableDays) === Number(nAfter?.availableDays) &&
        Number(nBefore?.reservedDays) === Number(nAfter?.reservedDays) &&
        histBeforeList.length === histAfterList.length

      const signatureUnchanged = sigBefore.type === sigAfter.type && sigBefore.data === sigAfter.data

      const ok = mainRefusedByDelay && witnessEligible && unchanged && signatureUnchanged &&
        (assignBackup.status === 200 || assignBackup.status === 201) && rhInBackup &&
        uiRequestFound && !uiActionPresent && Boolean(proof)

      results.push(result({
        id: 'LEA-003',
        priority: 'P2',
        scenario: 'RH ne reprend pas la demande avant le délai sans urgence',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `principale HTTP=${attempt.status} | témoin HTTP=${witnessAttempt.status} | UI demande trouvée=${uiRequestFound} action reprise présente=${uiActionPresent} | statut ${before.data?.status}→${after.data?.status} | balance ${nBefore?.availableDays}→${nAfter?.availableDays} reserved ${nBefore?.reservedDays}→${nAfter?.reservedDays} mouvements ${histBeforeList.length}→${histAfterList.length}`,
        proof,
        error: ok ? '' : 'Preuve UI ou règle de délai incomplète.',
        comment: `requestId=${requestId}, witnessId=${witnessId}, submittedAtMain=${submittedAtMain}, takeoverAtMain=${takeoverAtMain}, submittedAtWitness=${submittedAtWitness}, signatureUnchanged=${signatureUnchanged}`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-003 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-003', priority: 'P2', scenario: 'RH ne reprend pas la demande avant le délai sans urgence', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-004 — Validation sans justification du seuil refusée =====
  {
    const start = Date.now()
    let page
    try {
      const before = await apiRequest(`/leave-requests/management/${requestId}`, { token: respToken })
      const sigBefore = await readSignatureFields(requestId)
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      const apiAttempt = await apiRequest(`/leave-requests/${requestId}/validate`, {
        method: 'POST',
        token: respToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })

      let uiPostCount = 0
      let uiBlocked = false
      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/requests"]')
      await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
      await page.locator('.manager-all-requests-row--data', { hasText: 'COL-A Recette' }).first().click()
      await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
      page.on('request', (req) => {
        if (req.method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(req.url()).pathname.replace(/^\/api/, ''))) uiPostCount += 1
      })
      await page.locator('.manager-request-action--validate').click()
      await page.waitForTimeout(400)
      const bodyText = await page.locator('body').innerText()
      uiBlocked = bodyText.includes('justification est obligatoire') || bodyText.includes('seuil minimum')

      const after = await apiRequest(`/leave-requests/management/${requestId}`, { token: respToken })
      const sigAfter = await readSignatureFields(requestId)
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      const unchanged = before.data?.status === after.data?.status &&
        before.data?.finalDeciderId === after.data?.finalDeciderId &&
        sigBefore.type === sigAfter.type && sigBefore.data === sigAfter.data &&
        Number(nBefore?.availableDays) === Number(nAfter?.availableDays) &&
        Number(nBefore?.reservedDays) === Number(nAfter?.reservedDays) &&
        histBeforeList.length === histAfterList.length

      const ok = apiAttempt.status === 400 &&
        String(apiAttempt.data?.message ?? '').includes('justification') &&
        uiBlocked && uiPostCount === 0 && unchanged

      results.push(result({
        id: 'LEA-004',
        priority: 'P1',
        scenario: 'Validation sans justification du seuil refusée',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `backend HTTP=${apiAttempt.status} message="${apiAttempt.data?.message ?? ''}" | UI bloqué=${uiBlocked} requête UI envoyée=${uiPostCount > 0 ? 'oui' : 'non'} | statut ${before.data?.status}→${after.data?.status} | balance ${nBefore?.availableDays}→${nAfter?.availableDays} mouvements ${histBeforeList.length}→${histAfterList.length}`,
        error: ok ? '' : 'Refus de validation sans justification non conforme.',
        comment: `requestId=${requestId}, acteur=RESP (${resp.id})`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-004 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-004', priority: 'P1', scenario: 'Validation sans justification du seuil refusée', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-005 — Responsable valide avec justification obligatoire =====
  {
    const start = Date.now()
    let page
    try {
      const before = await apiRequest(`/leave-requests/management/${requestId}`, { token: respToken })
      const justification = 'Validation avec justification - recette LEA-005.'

      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/requests"]')
      await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
      await page.locator('.manager-all-requests-row--data', { hasText: 'COL-A Recette' }).first().click()
      await page.waitForSelector('#minimum-presence-justification', { timeout: 10000 })
      await page.fill('#minimum-presence-justification', justification)
      await page.locator('.manager-request-action--validate').click()
      await page.waitForSelector('#signature-initials', { timeout: 10000 })
      await page.fill('#signature-initials', 'DR')
      const postPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.nr-modal__footer .nr-btn--primary').click()
      const postResp = await postPromise
      const http = postResp.status()
      await page.waitForTimeout(400)
      await capture(page, 'CAP-LEA-005.png')

      const after = await apiRequest(`/leave-requests/management/${requestId}`, { token: respToken })
      const sigAfter = await readSignatureFields(requestId)

      // Justification persistée dans l'audit (DEMANDE_PREVALIDEE).
      let justificationPersisted = false
      try {
        const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
        try {
          const [rows] = await conn.execute(
            "SELECT new_value AS nv FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='DEMANDE_PREVALIDEE' ORDER BY id DESC LIMIT 1",
            [requestId],
          )
          const nv = rows[0]?.nv
          justificationPersisted = typeof nv === 'string' ? nv.includes(justification) : JSON.stringify(nv ?? '').includes(justification)
        } finally {
          await conn.end()
        }
      } catch { justificationPersisted = false }

      const ok = http === 200 &&
        after.data?.finalDeciderId === resp.id &&
        after.data?.validatorSignatureType === 'INITIALS' &&
        sigAfter.type === 'INITIALS' && sigAfter.data === 'DR' &&
        justificationPersisted

      results.push(result({
        id: 'LEA-005',
        priority: 'P1',
        scenario: 'Responsable valide avec justification obligatoire',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `validate UI HTTP=${http} | finalDecider=${after.data?.finalDeciderId} | signature=${after.data?.validatorSignatureType} | justification persistée=${justificationPersisted} | statut=${after.data?.status}`,
        proof: 'CAP-LEA-005.png',
        error: ok ? '' : 'Validation avec justification non conforme.',
        comment: `requestId=${requestId}, acteur=RESP (${resp.id}), justification="${justification}"`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-005 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-005', priority: 'P1', scenario: 'Responsable valide avec justification obligatoire', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // Calendrier : avancer jusqu'à ce que la date cible soit visible.
  const gotoMonthFor = async (page, targetIso) => {
    for (let i = 0; i < 14; i += 1) {
      if (await page.locator(`button.nr-cal__cell[aria-label="${targetIso}"]`).count()) return true
      const next = page.locator('button.nr-cal__nav-btn[aria-label="Mois suivant"]')
      if (!(await next.count())) return false
      await next.first().click()
      await page.waitForTimeout(180)
    }
    return false
  }

  // ===== LEA-006 — Collaborateur télécharge le PDF de validation =====
  {
    const start = Date.now()
    let page
    try {
      // Finalisation RH de la demande déjà validée par le Responsable (LEA-005).
      const finalize = await apiRequest(`/leave-requests/${requestId}/validate`, {
        method: 'POST',
        token: rhToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Validation finale RH - recette LEA-006.' },
      })

      const dl = await downloadBytes(colAToken, `/leave-requests/${requestId}/pdf`)
      const contentType = dl.headers.get('content-type') ?? ''
      const signature = dl.buffer.subarray(0, 5).toString('ascii')

      let downloadOk = false
      let downloadName = ''
      let proof = ''
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.waitForSelector('.my-request-card__action--download', { timeout: 10000 })
      proof = await capture(page, 'CAP-LEA-006.png')
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('.my-request-card__action--download').first().click(),
      ])
      downloadName = download.suggestedFilename()
      downloadOk = Boolean(downloadName) && /\.pdf$/i.test(downloadName)

      const ok = finalize.status === 200 &&
        finalize.data?.status === 'VALIDEE' &&
        dl.status === 200 &&
        contentType.includes('application/pdf') &&
        dl.buffer.length > 0 &&
        signature === '%PDF-' &&
        downloadOk

      results.push(result({
        id: 'LEA-006',
        priority: 'P1',
        scenario: 'Collaborateur télécharge le PDF de validation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `finalisation RH HTTP=${finalize.status} statut=${finalize.data?.status} | PDF HTTP=${dl.status} type=${contentType} taille=${dl.buffer.length} signature=${signature} | download UI="${downloadName}"`,
        proof,
        error: ok ? '' : 'Téléchargement du PDF non conforme.',
        comment: `requestId=${requestId}`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-006 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-006', priority: 'P1', scenario: 'Collaborateur télécharge le PDF de validation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-007 — Autre collaborateur ne télécharge pas le PDF =====
  {
    const start = Date.now()
    let page
    try {
      const dl = await downloadBytes(colBToken, `/leave-requests/${requestId}/pdf`)
      const denied = dl.status === 403 || dl.status === 404
      const pdfLeak = dl.buffer.subarray(0, 5).toString('ascii') === '%PDF-'

      page = await loginPage(browser, 'col-b.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForTimeout(1200)
      const cards = await page.locator('.my-request-card').count()
      const downloadButtons = await page.locator('.my-request-card__action--download').count()
      const noAccessUi = cards === 0 && downloadButtons === 0

      const ok = denied && !pdfLeak && noAccessUi
      results.push(result({
        id: 'LEA-007',
        priority: 'P2',
        scenario: 'Autre collaborateur ne télécharge pas le PDF',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `download COL-B HTTP=${dl.status} | fuite PDF=${pdfLeak} | UI COL-B cartes=${cards} boutons download=${downloadButtons}`,
        error: ok ? '' : 'Accès PDF non protégé.',
        comment: `requestId=${requestId}, demandeur=COL-B`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-007 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-007', priority: 'P2', scenario: 'Autre collaborateur ne télécharge pas le PDF', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-008 — Responsable refuse la demande en chevauchement (vraie UI + motif) =====
  {
    const start = Date.now()
    let page
    let colBRequestId
    try {
      const colBDraft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId, startDate: '2026-12-14', endDate: '2026-12-15', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      colBRequestId = colBDraft.data?.id
      await apiRequest(`/leave-requests/${colBRequestId}/submit`, { method: 'POST', token: colBToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

      const motif = 'Chevauchement d’absences - recette LEA-008.'
      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/requests"]')
      await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
      await page.locator('.manager-all-requests-row--data', { hasText: 'COL-B' }).first().click()
      await page.waitForSelector('.manager-request-action--refuse', { timeout: 10000 })
      await page.locator('.manager-request-action--refuse').click()
      await page.waitForSelector('#manager-refusal-comment', { timeout: 10000 })
      await page.fill('#manager-refusal-comment', motif)
      const postPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && /\/leave-requests\/\d+\/refuse$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.manager-decision-btn--danger').click()
      const postResp = await postPromise
      const http = postResp.status()
      await page.waitForTimeout(300)

      const after = await apiRequest(`/leave-requests/management/${colBRequestId}`, { token: respToken })
      const ok = http === 200 &&
        after.data?.status === 'REFUSEE' &&
        after.data?.refusalComment === motif

      results.push(result({
        id: 'LEA-008',
        priority: 'P1',
        scenario: 'Responsable refuse la demande en chevauchement',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `refus UI HTTP=${http} | statut=${after.data?.status} | motif="${after.data?.refusalComment}"`,
        error: ok ? '' : 'Refus non conforme.',
        comment: `requestId=${colBRequestId}, acteur=RESP (${resp.id})`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-008 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-008', priority: 'P1', scenario: 'Responsable refuse la demande en chevauchement', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-009 — Calcul d'une demi-journée à 0,5 jour (UI + API) =====
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/new-request"]')
      await page.waitForSelector('.nr-types__pill', { timeout: 10000 })
      await page.locator('.nr-types__pill', { hasText: 'Congés payés LEA' }).first().click()
      const found = await gotoMonthFor(page, '2026-12-16')
      if (!found) throw new Error('Calendrier décembre 2026 introuvable')
      await page.locator('button.nr-cal__cell[aria-label="2026-12-16"]').click()
      await page.waitForTimeout(150)
      await page.locator('button.nr-cal__cell[aria-label="2026-12-16"]').click()
      await page.waitForSelector('.nr-cal__period-actions--single', { timeout: 10000 })
      await page.locator('.nr-cal__period-actions--single button', { hasText: 'Matin' }).click()
      await page.waitForTimeout(300)
      const recapDays = (await page.locator('.nr-recap__days').first().innerText().catch(() => '')) || ''
      const halfLabel = (await page.locator('.nr-recap__halfday').first().innerText().catch(() => '')) || ''

      const postPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && /\/leave-requests$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.nr-recap__actions button', { hasText: 'Enregistrer en brouillon' }).click()
      const postResp = await postPromise
      const created = await postResp.json().catch(() => ({}))
      const deducted = Number(created?.deductedDays)

      const uiOk = recapDays.includes('0,5') && halfLabel.toLowerCase().includes('matin')
      const ok = uiOk && deducted === 0.5
      results.push(result({
        id: 'LEA-009',
        priority: 'P2',
        scenario: 'Calcul d’une demi-journée à 0,5 jour',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI recap="${recapDays.trim()}" halfday="${halfLabel.trim()}" | POST deductedDays=${deducted}`,
        error: ok ? '' : 'Calcul demi-journée incorrect.',
        comment: `requestId=${created?.id}, période=MATIN`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-009 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-009', priority: 'P2', scenario: 'Calcul d’une demi-journée à 0,5 jour', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-010 — Suppression d'un brouillon de congé (UI réelle) =====
  {
    const start = Date.now()
    let page
    let draftId
    try {
      const draft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-17', endDate: '2026-12-18', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      draftId = draft.data?.id

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card__action--delete', { timeout: 10000 })
      const targetCard = page.locator('.my-request-card', { hasText: '18/12/2026' }).first()
      const targetDelete = targetCard.locator('.my-request-card__action--delete')
      page.on('dialog', (dialog) => dialog.accept())
      const delPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'DELETE' && /\/leave-requests\/\d+$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await targetDelete.click()
      const delResp = await delPromise
      const http = delResp.status()
      await page.waitForTimeout(500)
      const stillVisible = await targetCard.count()

      const mine = await apiRequest('/leave-requests/my', { token: colAToken })
      const stillThere = (Array.isArray(mine.data) ? mine.data : []).some((r) => Number(r.id) === Number(draftId))
      const ok = http === 204 && !stillThere
      results.push(result({
        id: 'LEA-010',
        priority: 'P1',
        scenario: 'Suppression d’un brouillon de congé',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `DELETE UI HTTP=${http} | boutons delete restants=${stillVisible} | encore visible API=${stillThere}`,
        error: ok ? '' : 'Suppression non conforme.',
        comment: `draftId=${draftId}`,
        duration: Date.now() - start,
      }))
      console.log(`LEA-010 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-010', priority: 'P1', scenario: 'Suppression d’un brouillon de congé', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== LEA-011 — Un dimanche ne peut pas être une borne de congé (UI + API) =====
  {
    const start = Date.now()
    let page
    try {
      const sunday = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-13', endDate: '2026-12-14', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const backendRefused = sunday.status === 400 && String(sunday.data?.message ?? '').includes('dimanche')

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/new-request"]')
      await page.waitForSelector('.nr-types__pill', { timeout: 10000 })
      await page.locator('.nr-types__pill', { hasText: 'Congés payés LEA' }).first().click()
      const found = await gotoMonthFor(page, '2026-12-13')
      if (!found) throw new Error('Calendrier décembre 2026 introuvable')
      const sundayCell = page.locator('button.nr-cal__cell[aria-label="2026-12-13"]')
      const isDisabled = await sundayCell.isDisabled()
      const isSundayClass = ((await sundayCell.getAttribute('class')) || '').includes('nr-cal__cell--sunday')
      let postSent = 0
      page.on('request', (req) => {
        if (req.method() === 'POST' && /\/leave-requests$/.test(new URL(req.url()).pathname.replace(/^\/api/, ''))) postSent += 1
      })
      await sundayCell.click({ force: true }).catch(() => {})
      await page.waitForTimeout(300)
      const recapText = (await page.locator('.nr-recap__days').first().innerText().catch(() => '')) || ''
      const uiBlocked = isDisabled && isSundayClass && postSent === 0

      const ok = backendRefused && uiBlocked
      results.push(result({
        id: 'LEA-011',
        priority: 'P1',
        scenario: 'Un dimanche ne peut pas être une borne de congé',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `backend HTTP=${sunday.status} message="${sunday.data?.message ?? ''}" | UI dimanche désactivé=${isDisabled} classe sunday=${isSundayClass} POST envoyés=${postSent}`,
        error: ok ? '' : 'Dimanche non refusé.',
        comment: 'dimanche testé = 2026-12-13',
        duration: Date.now() - start,
      }))
      console.log(`LEA-011 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'LEA-011', priority: 'P1', scenario: 'Un dimanche ne peut pas être une borne de congé', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  await browser.close()
  writeReport(results, { label: 'recette-results-lea' })
  console.log('LEA-001..011 terminés')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
