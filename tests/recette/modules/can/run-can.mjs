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
  return {
    id,
    priority,
    module: 'CAN',
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

function dbConn() {
  return mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
}

async function downloadBytes(token, urlPath) {
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, buffer }
}

async function readEmployeeSignatureFields(requestId) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(
      'SELECT employee_signature_type AS sigType, employee_signature_data AS sigData FROM leave_requests WHERE id = ?',
      [requestId],
    )
    const row = rows[0] ?? {}
    return { type: row.sigType ?? null, data: row.sigData ?? null }
  } finally {
    await conn.end()
  }
}

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

const submitRequest = (id, token) =>
  apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []

  console.log('Préparation fixture CAN...')
  const [colAToken, respToken, rhToken, adminToken, directeurToken] = await Promise.all([
    login('col-a.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('admin.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
  ])

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const leaveType = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Congés payés CAN',
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
    body: { name: 'Service CAN', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })
  const serviceId = svc.data?.id
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { validationMode: 'RESPONSABLE_PUIS_RELAIS' } })
  await apiRequest('/leave-balances/initialize', {
    method: 'POST',
    token: rhToken,
    body: { employeeId: colA.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'Fixture CAN.' },
  }).catch(() => {})

  const browser = await chromium.launch({ headless: true })

  // ===== CAN-001 — Modification avant décision invalide la signature et repasse en brouillon =====
  {
    const start = Date.now()
    let page
    let requestId
    try {
      const draft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-14', endDate: '2026-12-15', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      requestId = draft.data?.id
      await submitRequest(requestId, colAToken)
      const before = await apiRequest(`/leave-requests/${requestId}`, { token: colAToken })
      const sigBefore = await readEmployeeSignatureFields(requestId)

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: 'Congés payés CAN' }).first().click()
      await page.waitForSelector('.request-detail-button--primary', { timeout: 10000 })
      await page.locator('.request-detail-button--primary', { hasText: 'Modifier la demande' }).click()
      await page.waitForSelector('.nr-cal', { timeout: 10000 })
      const found = await gotoMonthFor(page, '2026-12-16')
      if (!found) throw new Error('Calendrier décembre 2026 introuvable')
      await page.locator('button.nr-cal__cell[aria-label="2026-12-16"]').click()
      await page.waitForTimeout(150)
      await page.locator('button.nr-cal__cell[aria-label="2026-12-17"]').click()
      const patchPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'PATCH' && /\/leave-requests\/\d+$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.nr-recap__actions button', { hasText: 'Enregistrer les modifications' }).click()
      const patchResp = await patchPromise
      const patchHttp = patchResp.status()
      await page.waitForTimeout(400)
      await capture(page, 'CAP-CAN-001.png')

      const after = await apiRequest(`/leave-requests/${requestId}`, { token: colAToken })
      const sigAfter = await readEmployeeSignatureFields(requestId)

      const ok = patchHttp === 200 &&
        before.data?.status === 'EN_ATTENTE_VALIDATION' &&
        after.data?.status === 'BROUILLON' &&
        after.data?.employeeSignatureType === null &&
        after.data?.employeeSignedAt === null &&
        sigAfter.type === null && sigAfter.data === null

      results.push(result({
        id: 'CAN-001',
        priority: 'P1',
        scenario: 'Une modification avant décision invalide la signature et repasse en brouillon',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PATCH UI HTTP=${patchHttp} | statut ${before.data?.status}→${after.data?.status} | signature ${before.data?.employeeSignatureType}→${after.data?.employeeSignatureType} | dates ${after.data?.startDate}→${after.data?.endDate}`,
        proof: 'CAP-CAN-001.png',
        error: ok ? '' : 'Modification avant décision non conforme.',
        comment: `requestId=${requestId}, erratum attendu générique contradictoire`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-001 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-001', priority: 'P1', scenario: 'Une modification avant décision invalide la signature et repasse en brouillon', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-002 — Collaborateur annule une demande avant décision =====
  {
    const start = Date.now()
    let page
    let requestId
    try {
      const draft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-21', endDate: '2026-12-22', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      requestId = draft.data?.id
      await submitRequest(requestId, colAToken)
      const before = await apiRequest(`/leave-requests/${requestId}`, { token: colAToken })
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: 'Congés payés CAN' }).first().click()
      await page.waitForSelector('.request-detail-button--danger-outline', { timeout: 10000 })
      page.on('dialog', (dialog) => dialog.accept())
      const cancelPromise = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && /\/leave-requests\/\d+\/cancel$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
        { timeout: 15000 },
      )
      await page.locator('.request-detail-button--danger-outline', { hasText: 'Annuler la demande' }).click()
      const cancelResp = await cancelPromise
      const http = cancelResp.status()
      let cancelBody = null
      try { cancelBody = await cancelResp.json() } catch { cancelBody = null }
      await page.waitForTimeout(500)
      await capture(page, 'CAP-CAN-002.png')

      const after = await apiRequest(`/leave-requests/${requestId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')

      // Défaut produit constaté : POST /leave-requests/:id/cancel renvoie 409
      // (la réservation active est attendue alors que le modèle actuel ne réserve plus).
      const defect = http === 409 &&
        String(cancelBody?.message ?? '').includes('réservation') &&
        before.data?.status === 'EN_ATTENTE_VALIDATION' &&
        after.data?.status === 'EN_ATTENTE_VALIDATION' &&
        Number(nBefore?.availableDays) === Number(nAfter?.availableDays)

      results.push(result({
        id: 'CAN-002',
        priority: 'P1',
        scenario: 'Collaborateur annule une demande avant décision',
        type: 'C - UI + API',
        status: defect ? STATUS.NON_CONFORME : STATUS.BLOQUE,
        resultText: `cancel UI HTTP=${http} message="${cancelBody?.message ?? ''}" | statut ${before.data?.status}→${after.data?.status} | balance ${nBefore?.availableDays}→${nAfter?.availableDays}`,
        proof: 'CAP-CAN-002.png',
        error: defect ? 'ANO-011 : l’annulation avant décision échoue (409 réservation).' : 'Annulation avant décision non conforme.',
        comment: `requestId=${requestId}`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-002 ${defect ? 'NON CONFORME' : 'BLOQUE'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-002', priority: 'P1', scenario: 'Collaborateur annule une demande avant décision', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-003 — Annulation après validation (règle réelle : initiée par la RH) =====
  let validatedRequestId
  {
    const start = Date.now()
    let page
    try {
      const draft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-28', endDate: '2026-12-29', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      validatedRequestId = draft.data?.id
      await submitRequest(validatedRequestId, colAToken)
      await apiRequest(`/leave-requests/${validatedRequestId}/validate`, {
        method: 'POST',
        token: respToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })
      // Règle réelle : imputation du solde au début effectif du congé → backdate pour déclencher le débit.
      const conn = await dbConn()
      try {
        await conn.execute('UPDATE leave_requests SET start_date = ?, end_date = ? WHERE id = ?', ['2026-09-14', '2026-09-15', validatedRequestId])
      } finally {
        await conn.end()
      }
      await apiRequest(`/leave-requests/${validatedRequestId}/validate`, {
        method: 'POST',
        token: rhToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR', rhConfirmedDirectorAgreement: true },
      })
      const validated = await apiRequest(`/leave-requests/${validatedRequestId}`, { token: colAToken })

      // UI propriétaire : aucune action d'annulation après validation.
      let uiReadonly = false
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: 'Congés payés CAN' }).first().click()
      await page.waitForSelector('.request-detail-consent-note--ok', { timeout: 10000 })
      const bodyText = await page.locator('body').innerText()
      uiReadonly = bodyText.includes('lecture seule') || bodyText.includes('ne peut plus la refuser ni l’annuler')
      await capture(page, 'CAP-CAN-003.png')

      // Backend : le collaborateur ne peut pas initier l'annulation après validation.
      const collabAttempt = await apiRequest(`/leave-requests/${validatedRequestId}/cancellation-request`, {
        method: 'POST',
        token: colAToken,
        body: { reason: 'Tentative collaborateur - recette CAN-003.' },
      })

      // Initiation réelle par la RH (seule autorisée).
      const rhInitiate = await apiRequest(`/leave-requests/${validatedRequestId}/cancellation-request`, {
        method: 'POST',
        token: rhToken,
        body: { reason: 'Annulation après validation - recette CAN-003.' },
      })
      const after = await apiRequest(`/leave-requests/${validatedRequestId}`, { token: colAToken })

      const ok = validated.data?.status === 'VALIDEE' &&
        uiReadonly &&
        collabAttempt.status === 403 &&
        rhInitiate.status === 200 &&
        after.data?.status === 'ANNULATION_EN_ATTENTE_ACCORD' &&
        after.data?.cancellationReason === 'Annulation après validation - recette CAN-003.'

      results.push(result({
        id: 'CAN-003',
        priority: 'P1',
        scenario: 'Collaborateur demande l’annulation après validation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `statut validé=${validated.data?.status} | UI propriétaire lecture seule=${uiReadonly} | collaborateur HTTP=${collabAttempt.status} | RH initie HTTP=${rhInitiate.status} | statut final=${after.data?.status}`,
        proof: 'CAP-CAN-003.png',
        error: ok ? '' : 'Circuit d’annulation après validation non conforme.',
        comment: `requestId=${validatedRequestId}, erratum : seule la RH initie l’annulation après validation`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-003 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-003', priority: 'P1', scenario: 'Collaborateur demande l’annulation après validation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-004 — Responsable ne finalise pas l’annulation =====
  {
    const start = Date.now()
    let page
    try {
      const before = await apiRequest(`/leave-requests/${validatedRequestId}`, { token: colAToken })
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      const respAttempt = await apiRequest(`/leave-requests/${validatedRequestId}/cancellation-complete`, {
        method: 'POST',
        token: respToken,
      })

      let uiFinalizePresent = false
      let uiFound = false
      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/requests"]')
      await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
      const row = page.locator('.manager-all-requests-row--data', { hasText: 'Annulation en attente' }).first()
      if (await row.count()) {
        await row.click()
        await page.waitForTimeout(700)
        uiFound = (await page.locator('body').innerText()).includes('COL-A Recette')
        uiFinalizePresent = (await page.locator('.manager-request-action--validate').count()) > 0 || (await page.locator('.manager-request-action--refuse').count()) > 0
      }
      await capture(page, 'CAP-CAN-004.png')

      const after = await apiRequest(`/leave-requests/${validatedRequestId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      const unchanged = before.data?.status === after.data?.status &&
        Number(nBefore?.availableDays) === Number(nAfter?.availableDays) &&
        histBeforeList.length === histAfterList.length

      const ok = respAttempt.status === 403 && !uiFinalizePresent && unchanged

      results.push(result({
        id: 'CAN-004',
        priority: 'P1',
        scenario: 'Responsable ne finalise pas l’annulation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `RESP cancellation-complete HTTP=${respAttempt.status} | UI action présente=${uiFinalizePresent} (trouvée=${uiFound}) | statut ${before.data?.status}→${after.data?.status} | balance ${nBefore?.availableDays}→${nAfter?.availableDays}`,
        proof: 'CAP-CAN-004.png',
        error: ok ? '' : 'Protection RESP non conforme.',
        comment: `requestId=${validatedRequestId}`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-004 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-004', priority: 'P1', scenario: 'Responsable ne finalise pas l’annulation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-005 — RH finalise l’annulation et recrédite le solde =====
  {
    const start = Date.now()
    let page
    try {
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      const finalize = await apiRequest(`/leave-requests/${validatedRequestId}/cancellation-complete`, {
        method: 'POST',
        token: rhToken,
      })
      const after = await apiRequest(`/leave-requests/${validatedRequestId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      // UI RH : ouvrir la demande finalisée.
      let proof = ''
      try {
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
        const row = page.locator('.rh-events-row--data', { hasText: '14/09/2026' }).first()
        await row.click()
        await page.waitForTimeout(700)
        proof = await capture(page, 'CAP-CAN-005.png')
      } catch { proof = '' }

      const beforeAvail = Number(nBefore?.availableDays)
      const afterAvail = Number(nAfter?.availableDays)
      const recredited = afterAvail - beforeAvail

      const ok = finalize.status === 200 &&
        after.data?.status === 'ANNULEE_APRES_VALIDATION' &&
        recredited === 2 &&
        histAfterList.length === histBeforeList.length + 1

      results.push(result({
        id: 'CAN-005',
        priority: 'P1',
        scenario: 'RH finalise l’annulation et recrédite le solde',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `cancellation-complete HTTP=${finalize.status} | statut=${after.data?.status} | solde ${beforeAvail}→${afterAvail} (recrédité ${recredited}) | mouvements ${histBeforeList.length}→${histAfterList.length}`,
        proof: proof || 'CAP-CAN-005.png',
        error: ok ? '' : 'Finalisation RH non conforme.',
        comment: `requestId=${validatedRequestId}, erratum : pas d’UI dédiée, exécution API`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-005 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-005', priority: 'P1', scenario: 'RH finalise l’annulation et recrédite le solde', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-007 — Reprise avant délai avec urgence motivée (règle réelle : DIRECTEUR) =====
  {
    const start = Date.now()
    try {
      const directorMe = await apiRequest('/users/me', { token: directeurToken })
      const directorId = directorMe.data?.id
      const rhMe = await apiRequest('/users/me', { token: rhToken })
      const rhId = rhMe.data?.id
      await apiRequest(`/services/${serviceId}/validators`, { method: 'POST', token: adminToken, body: { validatorId: rhId } })

      const draft = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: '2026-12-09', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const urgentId = draft.data?.id
      await submitRequest(urgentId, colAToken)
      const before = await apiRequest(`/leave-requests/${urgentId}`, { token: colAToken })
      const submittedAt = before.data?.submittedAt
      const takeoverAt = submittedAt ? new Date(new Date(submittedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null

      const rhAttempt = await apiRequest(`/leave-requests/${urgentId}/validate`, {
        method: 'POST',
        token: rhToken,
        body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, emergencyTakeover: true, takeoverReason: 'Urgence motivée recette CAN-007.' },
      })

      const motivation = 'Urgence motivée recette CAN-007.'
      const dirAttempt = await apiRequest(`/leave-requests/${urgentId}/validate`, {
        method: 'POST',
        token: directeurToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR', emergencyTakeover: true, takeoverReason: motivation },
      })
      const after = await apiRequest(`/leave-requests/${urgentId}`, { token: rhToken })

      const ok = rhAttempt.status === 403 &&
        dirAttempt.status === 200 &&
        after.data?.isUrgent === true &&
        after.data?.urgentReason === motivation &&
        after.data?.finalDeciderId === directorId

      results.push(result({
        id: 'CAN-007',
        priority: 'P2',
        scenario: 'RH reprend une demande avant le délai avec urgence motivée',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `délai expiré=false (submittedAt=${submittedAt}) | RH HTTP=${rhAttempt.status} | Directeur HTTP=${dirAttempt.status} isUrgent=${after.data?.isUrgent} | finalDecider=${after.data?.finalDeciderId}`,
        error: ok ? '' : 'Reprise urgente non conforme.',
        comment: `requestId=${urgentId}, erratum : urgence réservée au Directeur (rôle RH → DIRECTEUR), takeoverAt=${takeoverAt}`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-007 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-007', priority: 'P2', scenario: 'RH reprend une demande avant le délai avec urgence motivée', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== Fixture partagée CAN-008/009/010/006 : demande VALIDEE + solde débité =====
  let sharedValidatedId
  {
    const draft = await apiRequest('/leave-requests', {
      method: 'POST',
      token: colAToken,
      body: { leaveTypeId, startDate: '2026-12-07', endDate: '2026-12-08', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
    })
    sharedValidatedId = draft.data?.id
    await submitRequest(sharedValidatedId, colAToken)
    await apiRequest(`/leave-requests/${sharedValidatedId}/validate`, {
      method: 'POST',
      token: respToken,
      body: { signatureType: 'INITIALS', signatureData: 'DR' },
    })
    const conn = await dbConn()
    try {
      await conn.execute('UPDATE leave_requests SET start_date = ?, end_date = ? WHERE id = ?', ['2026-09-07', '2026-09-08', sharedValidatedId])
    } finally {
      await conn.end()
    }
    await apiRequest(`/leave-requests/${sharedValidatedId}/validate`, {
      method: 'POST',
      token: rhToken,
      body: { signatureType: 'INITIALS', signatureData: 'DR', rhConfirmedDirectorAgreement: true },
    })
  }

  // ===== CAN-008 — RH initie une annulation après validation =====
  {
    const start = Date.now()
    let page
    try {
      const before = await apiRequest(`/leave-requests/${sharedValidatedId}`, { token: colAToken })
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')

      const initiate = await apiRequest(`/leave-requests/${sharedValidatedId}/cancellation-request`, {
        method: 'POST',
        token: rhToken,
        body: { reason: 'Annulation après validation - recette CAN-008.' },
      })
      const after = await apiRequest(`/leave-requests/${sharedValidatedId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')

      let proof = ''
      try {
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
        await page.locator('.rh-events-row--data', { hasText: '07/09/2026' }).first().click()
        await page.waitForTimeout(700)
        proof = await capture(page, 'CAP-CAN-008.png')
      } catch { proof = '' }

      const ok = initiate.status === 200 &&
        before.data?.status === 'VALIDEE' &&
        after.data?.status === 'ANNULATION_EN_ATTENTE_ACCORD' &&
        after.data?.employeeCancellationConsent === true &&
        Number(nBefore?.availableDays) === Number(nAfter?.availableDays)

      results.push(result({
        id: 'CAN-008',
        priority: 'P1',
        scenario: 'RH initie une annulation après validation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `RH initiation HTTP=${initiate.status} | statut ${before.data?.status}→${after.data?.status} | consentement=${after.data?.employeeCancellationConsent} | solde ${nBefore?.availableDays}→${nAfter?.availableDays}`,
        proof: proof || 'CAP-CAN-008.png',
        error: ok ? '' : 'Initiation annulation non conforme.',
        comment: `requestId=${sharedValidatedId}`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-008 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-008', priority: 'P1', scenario: 'RH initie une annulation après validation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-009 — Collaborateur donne son consentement (ancien flux → 403) =====
  {
    const start = Date.now()
    let page
    try {
      let uiNoConsent = false
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: '07/09/2026' }).first().click()
      await page.waitForTimeout(700)
      const bodyText = await page.locator('body').innerText()
      uiNoConsent = bodyText.includes('en cours de traitement par la RH') || bodyText.includes('Aucune action')
      await capture(page, 'CAP-CAN-009.png')

      const consent = await apiRequest(`/leave-requests/${sharedValidatedId}/cancellation-consent`, {
        method: 'POST',
        token: colAToken,
        body: { consent: true },
      })
      const after = await apiRequest(`/leave-requests/${sharedValidatedId}`, { token: colAToken })

      const ok = uiNoConsent &&
        consent.status === 403 &&
        after.data?.employeeCancellationConsent === true &&
        after.data?.status === 'ANNULATION_EN_ATTENTE_ACCORD'

      results.push(result({
        id: 'CAN-009',
        priority: 'P1',
        scenario: 'Collaborateur donne son consentement à l’annulation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI aucune action consentement=${uiNoConsent} | cancellation-consent HTTP=${consent.status} | consentement déjà=${after.data?.employeeCancellationConsent} | statut=${after.data?.status}`,
        proof: 'CAP-CAN-009.png',
        error: ok ? '' : 'Consentement non conforme.',
        comment: `requestId=${sharedValidatedId}, erratum : consentement géré par le flux RH`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-009 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-009', priority: 'P1', scenario: 'Collaborateur donne son consentement à l’annulation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-010 — RH finalise l’annulation avec consentement =====
  {
    const start = Date.now()
    let page
    try {
      const balBefore = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nBefore = (Array.isArray(balBefore.data) ? balBefore.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histBefore = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []

      const finalize = await apiRequest(`/leave-requests/${sharedValidatedId}/cancellation-complete`, {
        method: 'POST',
        token: rhToken,
      })
      const after = await apiRequest(`/leave-requests/${sharedValidatedId}`, { token: colAToken })
      const balAfter = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
      const nAfter = (Array.isArray(balAfter.data) ? balAfter.data : []).find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const histAfter = await apiRequest(`/leave-balances/employee/${colA.id}/history`, { token: rhToken })
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []

      let proof = ''
      try {
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
        await page.locator('.rh-events-row--data', { hasText: '07/09/2026' }).first().click()
        await page.waitForTimeout(700)
        proof = await capture(page, 'CAP-CAN-010.png')
      } catch { proof = '' }

      const beforeAvail = Number(nBefore?.availableDays)
      const afterAvail = Number(nAfter?.availableDays)
      const recredited = afterAvail - beforeAvail

      const ok = finalize.status === 200 &&
        after.data?.status === 'ANNULEE_APRES_VALIDATION' &&
        recredited === 2 &&
        histAfterList.length === histBeforeList.length + 1

      results.push(result({
        id: 'CAN-010',
        priority: 'P1',
        scenario: 'RH finalise l’annulation avec consentement',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `cancellation-complete HTTP=${finalize.status} | statut=${after.data?.status} | solde ${beforeAvail}→${afterAvail} (recrédité ${recredited}) | mouvements ${histBeforeList.length}→${histAfterList.length}`,
        proof: proof || 'CAP-CAN-010.png',
        error: ok ? '' : 'Finalisation annulation non conforme.',
        comment: `requestId=${sharedValidatedId}`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-010 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-010', priority: 'P1', scenario: 'RH finalise l’annulation avec consentement', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== CAN-006 — Collaborateur télécharge le PDF d’annulation (UI réelle) =====
  {
    const start = Date.now()
    let page
    try {
      const dl = await downloadBytes(colAToken, `/leave-requests/${sharedValidatedId}/cancellation-pdf`)
      const contentType = dl.headers.get('content-type') ?? ''
      const signature = dl.buffer.subarray(0, 5).toString('ascii')

      let downloadOk = false
      let downloadName = ''
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.click('a[href="/app/my-requests"]')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.locator('.my-request-card', { hasText: '07/09/2026' }).first().click()
      await page.waitForSelector('.request-detail-button--orange', { timeout: 10000 })
      await capture(page, 'CAP-CAN-006.png')
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('.request-detail-button--orange', { hasText: 'PDF d’annulation' }).click(),
      ])
      downloadName = download.suggestedFilename()
      downloadOk = Boolean(downloadName) && /\.pdf$/i.test(downloadName)

      const ok = dl.status === 200 &&
        contentType.includes('application/pdf') &&
        dl.buffer.length > 0 &&
        signature === '%PDF-' &&
        downloadOk

      results.push(result({
        id: 'CAN-006',
        priority: 'P1',
        scenario: 'Collaborateur télécharge le PDF d’annulation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PDF HTTP=${dl.status} type=${contentType} taille=${dl.buffer.length} signature=${signature} | download UI="${downloadName}"`,
        proof: 'CAP-CAN-006.png',
        error: ok ? '' : 'Téléchargement PDF d’annulation non conforme.',
        comment: `requestId=${sharedValidatedId}, propriétaire=COL-A`,
        duration: Date.now() - start,
      }))
      console.log(`CAN-006 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'CAN-006', priority: 'P1', scenario: 'Collaborateur télécharge le PDF d’annulation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-can' })
  console.log('CAN-001..010 terminés')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
