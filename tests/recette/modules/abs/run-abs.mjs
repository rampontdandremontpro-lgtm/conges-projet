import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

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

async function multipartUpload(token, urlPath, filePath, fileName, mimeType = 'application/pdf') {
  const fileBuffer = readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName)
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const contentType = response.headers.get('content-type') ?? ''
  let data = null
  if (contentType.includes('application/json')) {
    data = await response.json()
  } else {
    data = await response.text()
  }
  return { status: response.status, data }
}

async function multipartPatch(token, urlPath, filePath, fileName, mimeType = 'application/pdf') {
  const fileBuffer = readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName)
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const contentType = response.headers.get('content-type') ?? ''
  let data = null
  if (contentType.includes('application/json')) {
    data = await response.json()
  } else {
    data = await response.text()
  }
  return { status: response.status, data }
}

async function downloadBytes(token, urlPath) {
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    headers: response.headers,
    buffer,
  }
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []

  console.log('Préparation fixture ABS...')
  const [colBToken, colCToken, rhToken, adminToken] = await Promise.all([
    login('col-b.recette@gmes.fr'),
    login('col-c.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('admin.recette@gmes.fr'),
  ])

  if (!colBToken || !colCToken || !rhToken || !adminToken) {
    throw new Error('Connexion impossible pour un ou plusieurs comptes ABS.')
  }

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')
  const colC = users.find((u) => u.email === 'col-c.recette@gmes.fr')

  // Fixture : un type d'absence autorisé au collaborateur et un type réservé RH.
  const baseType = {
    category: 'DECLARATION_ABSENCE',
    deductsPaidLeaveBalance: false,
    documentRequired: false,
    documentCanBeAddedLater: false,
    allowsDays: true,
    allowsHalfDays: true,
    allowsHours: false,
    requiresValidation: false,
  }
  const allowedCreate = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: { ...baseType, name: 'Absence collaborateur ABS', employeeCanCreate: true, rhOnly: false },
  })
  const rhOnlyCreate = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: { ...baseType, name: 'Absence RH ABS', employeeCanCreate: false, rhOnly: true },
  })
  const allowedTypeId = allowedCreate.data?.id
  const rhOnlyTypeId = rhOnlyCreate.data?.id
  if (!allowedTypeId || !rhOnlyTypeId) {
    throw new Error('Création des types d’absence ABS impossible.')
  }

  // Service actif pour COL-B (précondition de la déclaration d'absence).
  const svc = await apiRequest('/services', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Service ABS', serviceType: 'INTERNE' },
  })
  let serviceId = svc.data?.id
  if (!serviceId) {
    const svcList = await apiRequest('/services', { token: adminToken })
    serviceId = (Array.isArray(svcList.data) ? svcList.data : []).find((s) => s.name === 'Service ABS')?.id
  }
  if (!serviceId) {
    throw new Error('Création du service ABS impossible.')
  }
  await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${colC.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })

  const browser = await chromium.launch({ headless: true })

  // ===== ABS-001 — Collaborateur B crée une déclaration d'absence =====
  {
    const start = Date.now()
    try {
      const payload = {
        leaveTypeId: allowedTypeId,
        startDate: '2026-12-10',
        endDate: '2026-12-10',
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
        comment: 'ABS recette ABS-001 COL-B',
      }
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: payload,
      })

      let proof = ''
      try {
        const page = await loginPage(browser, 'col-b.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.collab-my-requests, main, .page-container', { timeout: 10000 }).catch(() => {})
        proof = await capture(page, 'CAP-ABS-001.png')
        await page.close()
      } catch {
        proof = ''
      }

      const created = res.status === 200 || res.status === 201
      const uiCreationAvailable = false // aucune UI collaborateur de création d'absence
      const nonConforme = !uiCreationAvailable && res.status === 403 && !created
      results.push(result({
        id: 'ABS-001',
        priority: 'P1',
        scenario: 'Collaborateur B crée une déclaration d’absence',
        type: 'C - UI + API',
        status: nonConforme ? STATUS.NON_CONFORME : STATUS.BLOQUE,
        resultText: `POST /absence-declarations HTTP=${res.status} message="${res.data?.message ?? ''}" | UI création=${uiCreationAvailable} | created=${created}`,
        proof,
        error: nonConforme ? 'Écart produit : le collaborateur ne peut pas créer sa déclaration (aucune UI + HTTP 403).' : 'Règle produit non atteignable.',
        comment: `Payload=${JSON.stringify(payload)} | ANO-008`,
        duration: Date.now() - start,
      }))
      console.log(`ABS-001 ${nonConforme ? 'NON CONFORME' : 'BLOQUÉ'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'ABS-001', priority: 'P1', scenario: 'Collaborateur B crée une déclaration d’absence', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== ABS-002 — Collaborateur ne déclare pas pour un collègue =====
  {
    const start = Date.now()
    try {
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: {
          employeeId: colC.id,
          leaveTypeId: allowedTypeId,
          startDate: '2026-12-11',
          endDate: '2026-12-11',
        },
      })
      const colCMine = await apiRequest('/absence-declarations/my', { token: colCToken })
      const colCList = Array.isArray(colCMine.data) ? colCMine.data : []
      const colCUntouched = colCList.length === 0

      results.push(result({
        id: 'ABS-002',
        priority: 'P2',
        scenario: 'Collaborateur ne déclare pas pour un collègue',
        type: 'C - UI + API',
        status: STATUS.BLOQUE,
        resultText: `POST avec employeeId=COL-C HTTP=${res.status} message="${res.data?.message ?? ''}" | absence COL-C créée=${!colCUntouched}`,
        error: 'Règle fine non atteinte : RolesGuard bloque toute création collaborateur avant resolveEmployee. Retest après ANO-008.',
        comment: `employeeId cible=${colC.id} ; déclarations COL-C=${colCList.length}`,
        duration: Date.now() - start,
      }))
      console.log(`ABS-002 BLOQUÉ — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'ABS-002', priority: 'P2', scenario: 'Collaborateur ne déclare pas pour un collègue', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== ABS-003 — Type réservé à la RH refusé au collaborateur =====
  {
    const start = Date.now()
    try {
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: {
          leaveTypeId: rhOnlyTypeId,
          startDate: '2026-12-12',
          endDate: '2026-12-12',
        },
      })
      results.push(result({
        id: 'ABS-003',
        priority: 'P1',
        scenario: 'Type réservé à la RH refusé au collaborateur',
        type: 'C - UI + API',
        status: STATUS.BLOQUE,
        resultText: `POST leaveTypeId rhOnly=${rhOnlyTypeId} HTTP=${res.status} message="${res.data?.message ?? ''}"`,
        error: 'Règle rhOnly non atteinte end-to-end : RolesGuard bloque le POST collaborateur avant validateLeaveType. Erratum ABS-003 ajouté ; retest après ANO-008.',
        comment: `Type rhOnly=${rhOnlyTypeId} ; incohérence manifest rôle=RH vs titre collaborateur.`,
        duration: Date.now() - start,
      }))
      console.log(`ABS-003 BLOQUÉ — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'ABS-003', priority: 'P1', scenario: 'Type réservé à la RH refusé au collaborateur', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // Créer une absence réelle de COL-B par la RH (flux produit réel) pour ABS-004/005.
  let colBAbsenceId = null
  {
    const res = await apiRequest('/absence-declarations', {
      method: 'POST',
      token: rhToken,
      body: {
        employeeId: colB.id,
        leaveTypeId: allowedTypeId,
        startDate: '2026-12-13',
        endDate: '2026-12-13',
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
        comment: 'ABS recette COL-B (créée par RH)',
      },
    })
    colBAbsenceId = res.data?.id
  }

  // ===== ABS-004 — Collaborateur B soumet sa déclaration =====
  {
    const start = Date.now()
    try {
      const before = await apiRequest(`/absence-declarations/${colBAbsenceId}`, { token: colBToken })
      const statusBefore = before.data?.status

      const submit = await apiRequest(`/absence-declarations/${colBAbsenceId}/submit`, {
        method: 'POST',
        token: colBToken,
        body: { certifiedAccurate: true },
      })

      const after = await apiRequest(`/absence-declarations/${colBAbsenceId}`, { token: colBToken })
      const statusAfter = after.data?.status

      let proof = ''
      try {
        const page = await loginPage(browser, 'col-b.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.goto(`${config.FRONTEND_URL}/app/my-requests/absence/${colBAbsenceId}`, { waitUntil: 'networkidle' }).catch(() => {})
        await page.waitForTimeout(600)
        proof = await capture(page, 'CAP-ABS-004.png')
        await page.close()
      } catch {
        proof = ''
      }

      const nonConforme = submit.status === 403 && statusBefore === 'BROUILLON' && statusAfter === 'BROUILLON'
      results.push(result({
        id: 'ABS-004',
        priority: 'P1',
        scenario: 'Collaborateur B soumet sa déclaration',
        type: 'C - UI + API',
        status: nonConforme ? STATUS.NON_CONFORME : STATUS.BLOQUE,
        resultText: `submit HTTP=${submit.status} message="${submit.data?.message ?? ''}" | statut ${statusBefore} → ${statusAfter}`,
        proof,
        error: nonConforme ? 'Écart produit : le collaborateur ne peut pas soumettre sa déclaration (HTTP 403, statut reste BROUILLON).' : 'Soumission collaborateur non atteignable.',
        comment: `declarationId=${colBAbsenceId} | ANO-008`,
        duration: Date.now() - start,
      }))
      console.log(`ABS-004 ${nonConforme ? 'NON CONFORME' : 'BLOQUÉ'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'ABS-004', priority: 'P1', scenario: 'Collaborateur B soumet sa déclaration', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== ABS-005 — Autre collaborateur ne consulte pas cette absence =====
  {
    const start = Date.now()
    try {
      // UI : COL-C ne voit pas l'absence de COL-B dans sa liste.
      let uiLeak = true
      let proof = ''
      try {
        const page = await loginPage(browser, 'col-c.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.collab-my-requests, main, .page-container', { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(500)
        const bodyText = await page.locator('body').innerText()
        uiLeak = bodyText.includes('ABS recette COL-B')
        proof = await capture(page, 'CAP-ABS-005.png')
        await page.close()
      } catch {
        uiLeak = true
      }

      // API : accès direct à l'absence de COL-B.
      const apiAccess = await apiRequest(`/absence-declarations/${colBAbsenceId}`, { token: colCToken })
      const denied = apiAccess.status === 403 || apiAccess.status === 404
      const noLeak = !(typeof apiAccess.data === 'object' && apiAccess.data && apiAccess.data.id === colBAbsenceId)

      const ok = !uiLeak && denied && noLeak
      results.push(result({
        id: 'ABS-005',
        priority: 'P1',
        scenario: 'Autre collaborateur ne consulte pas cette absence',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI visible par COL-C=${uiLeak} | API GET HTTP=${apiAccess.status} message="${apiAccess.data?.message ?? ''}" | fuite=${!noLeak}`,
        proof,
        error: ok ? '' : 'Isolation insuffisante.',
        comment: `propriétaire=COL-B (id=${colB.id}), demandeur=COL-C (id=${colC.id}), declarationId=${colBAbsenceId}`,
        duration: Date.now() - start,
      }))
      console.log(`ABS-005 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'ABS-005', priority: 'P1', scenario: 'Autre collaborateur ne consulte pas cette absence', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== Chaîne documentaire ABS-006..ABS-010 =====
  const pdfPath = path.resolve(__dirname, '../../fixtures/justificatif-abs-recette.pdf')
  const pdfName = 'justificatif-abs-recette.pdf'
  const pdfBuffer = readFileSync(pdfPath)
  const pdfSize = pdfBuffer.length
  const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex')
  let documentId = null
  let docAbsenceId = null
  let fixtureError = ''

  try {
    const docType = await apiRequest('/leave-types', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Absence justificatif ABS',
        category: 'DECLARATION_ABSENCE',
        documentRequired: true,
        documentCanBeAddedLater: true,
        employeeCanCreate: true,
        rhOnly: false,
        allowsDays: true,
        allowsHalfDays: true,
        allowsHours: false,
        requiresValidation: false,
      },
    })
    const docTypeId = docType.data?.id
    if (!docTypeId) throw new Error('Type justificatif non créé.')

    const docAbsence = await apiRequest('/absence-declarations', {
      method: 'POST',
      token: rhToken,
      body: {
        employeeId: colB.id,
        leaveTypeId: docTypeId,
        startDate: '2026-12-20',
        endDate: '2026-12-20',
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
        comment: 'ABS justificatif COL-B',
      },
    })
    docAbsenceId = docAbsence.data?.id
    if (!docAbsenceId) throw new Error('Absence documentaire non créée.')

    await apiRequest(`/absence-declarations/${docAbsenceId}/submit`, {
      method: 'POST',
      token: rhToken,
      body: { certifiedAccurate: true },
    })
  } catch (error) {
    fixtureError = error.message
  }

  if (fixtureError) {
    const scenarios = [
      'Collaborateur ajoute un justificatif PDF valide',
      'Autre collaborateur ne consulte pas le justificatif',
      'RH consulte les justificatifs à contrôler',
      'Directeur ne télécharge pas le justificatif',
      'RH télécharge le justificatif',
    ]
    scenarios.forEach((scenario, index) => {
      const id = `ABS-00${index + 6}`
      results.push(result({ id, priority: 'P1', scenario, type: 'C - UI + API', status: STATUS.BLOQUE, resultText: fixtureError, error: fixtureError, duration: 0 }))
    })
  } else {
    // ===== ABS-006 — Collaborateur ajoute un justificatif PDF valide =====
    {
      const start = Date.now()
      let page
      try {
        const beforeDecl = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: colBToken })
        const statusBefore = beforeDecl.data?.status

        let uploadHttp = null
        let uploadData = null
        page = await loginPage(browser, 'col-b.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        await page.locator('.my-request-card', { hasText: 'Absence justificatif ABS' }).first().click()
        await page.waitForSelector('.request-detail-page', { timeout: 10000 })
        const responsePromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/absence\/\d+$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await page.setInputFiles('.request-detail-file-input', { name: pdfName, mimeType: 'application/pdf', buffer: pdfBuffer })
        const resp = await responsePromise
        uploadHttp = resp.status()
        try { uploadData = await resp.json() } catch { uploadData = null }
        documentId = uploadData?.id ?? null
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-006.png')

        const afterDecl = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: colBToken })
        const statusAfter = afterDecl.data?.status
        const docs = await apiRequest(`/documents/absence/${docAbsenceId}`, { token: colBToken })
        const docList = Array.isArray(docs.data) ? docs.data : []
        const doc = docList.find((d) => d.id === documentId)

        const ok = (uploadHttp === 200 || uploadHttp === 201) &&
          Boolean(documentId) &&
          statusBefore === 'JUSTIFICATIF_EN_ATTENTE' &&
          statusAfter === 'A_VERIFIER_PAR_RH' &&
          doc?.status === 'EN_ATTENTE' &&
          doc?.originalName === pdfName &&
          doc?.mimeType === 'application/pdf' &&
          Number(doc?.fileSize) === pdfSize &&
          docList.length === 1

        results.push(result({
          id: 'ABS-006',
          priority: 'P1',
          scenario: 'Collaborateur ajoute un justificatif PDF valide',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `upload UI HTTP=${uploadHttp} | documentId=${documentId} | déclaration ${statusBefore} → ${statusAfter} | document statut=${doc?.status} | fichier=${doc?.originalName} (${doc?.mimeType}, ${doc?.fileSize} o)`,
          proof: 'CAP-ABS-006.png',
          error: ok ? '' : 'Upload ou persistance du justificatif non conforme.',
          comment: `declarationId=${docAbsenceId}, pdf sha256=${pdfHash}`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-006 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-006', priority: 'P1', scenario: 'Collaborateur ajoute un justificatif PDF valide', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-007 — Autre collaborateur ne consulte pas le justificatif =====
    {
      const start = Date.now()
      let page
      try {
        let uiLeak = true
        page = await loginPage(browser, 'col-c.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.collab-my-requests, main, .page-container', { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(400)
        const bodyText = await page.locator('body').innerText()
        uiLeak = bodyText.includes(pdfName) || bodyText.includes('ABS justificatif COL-B')
        await capture(page, 'CAP-ABS-007.png')

        const listAccess = await apiRequest(`/documents/absence/${docAbsenceId}`, { token: colCToken })
        const listDenied = listAccess.status === 403 || listAccess.status === 404
        const download = await downloadBytes(colCToken, `/documents/${documentId}/download`)
        const downloadDenied = download.status === 403 || download.status === 404
        const pdfLeak = download.buffer.subarray(0, 5).toString('ascii') === '%PDF-'

        const ok = !uiLeak && listDenied && downloadDenied && !pdfLeak
        results.push(result({
          id: 'ABS-007',
          priority: 'P1',
          scenario: 'Autre collaborateur ne consulte pas le justificatif',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `UI visible=${uiLeak} | liste API HTTP=${listAccess.status} | download API HTTP=${download.status} | PDF divulgué=${pdfLeak}`,
          proof: 'CAP-ABS-007.png',
          error: ok ? '' : 'Confidentialité du justificatif non garantie.',
          comment: `documentId=${documentId}, demandeur=COL-C`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-007 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-007', priority: 'P1', scenario: 'Autre collaborateur ne consulte pas le justificatif', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-008 — RH consulte les justificatifs à contrôler =====
    {
      const start = Date.now()
      let page
      try {
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-pdf-documents"]')
        await page.waitForSelector('.rh-documents-tab', { timeout: 10000 })
        await page.locator('.rh-documents-tab', { hasText: 'Justificatifs' }).click()
        await page.waitForSelector('.rh-documents-filters select', { timeout: 10000 })
        await page.locator('.rh-documents-filters select').nth(2).selectOption('EN_ATTENTE')
        await page.waitForSelector('.rh-documents-row--body, .rh-documents-empty', { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(500)

        const rows = page.locator('.rh-documents-row--body', { hasText: pdfName })
        const uiOccurrences = await rows.count()
        let uiStatus = ''
        let uiCollaborator = ''
        if (uiOccurrences >= 1) {
          const row = rows.first()
          uiStatus = (await row.locator('.rh-documents-status').innerText().catch(() => '')).trim()
          uiCollaborator = (await row.locator('.rh-documents-person strong').first().innerText().catch(() => '')).trim()
        }
        await capture(page, 'CAP-ABS-008.png')

        const mgmt = await apiRequest(`/documents/management/library?status=EN_ATTENTE&employeeId=${colB.id}`, { token: rhToken })
        const list = Array.isArray(mgmt.data) ? mgmt.data : []
        const matches = list.filter((d) => d.id === documentId)
        const apiOccurrences = matches.length
        const apiStatus = matches[0]?.status
        const apiName = matches[0]?.originalName

        const ok = uiOccurrences === 1 &&
          uiStatus.toLowerCase().includes('attente') &&
          uiCollaborator.includes('COL-B') &&
          mgmt.status === 200 &&
          apiOccurrences === 1 &&
          apiStatus === 'EN_ATTENTE' &&
          apiName === pdfName

        results.push(result({
          id: 'ABS-008',
          priority: 'P1',
          scenario: 'RH consulte les justificatifs à contrôler',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `filtre statut UI=En attente | occurrence UI=${uiOccurrences} | statut UI="${uiStatus}" | collaborateur UI="${uiCollaborator}" | API occurrences=${apiOccurrences} | API statut=${apiStatus} | fichier=${apiName}`,
          proof: 'CAP-ABS-008.png',
          error: ok ? '' : 'Justificatif « à contrôler » non prouvé pour la RH.',
          comment: `documentId=${documentId}, employeeId=${colB.id}`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-008 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-008', priority: 'P1', scenario: 'RH consulte les justificatifs à contrôler', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-009 — Directeur ne télécharge pas le justificatif =====
    {
      const start = Date.now()
      let page
      try {
        const directorToken = await login('directeur.recette@gmes.fr')
        page = await loginPage(browser, 'directeur.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.waitForSelector('.sidebar__nav, aside, nav', { timeout: 10000 }).catch(() => {})

        // Aucun menu/lien Documents collaborateurs (rh-pdf-documents) pour le Directeur.
        const docLinkCount = await page.locator('a[href="/app/rh-pdf-documents"]').count()
        const hasDocumentsMenu = docLinkCount > 0

        // Vue absence Directeur : aucun filename, aucun bouton de téléchargement du justificatif.
        await page.click('a[href="/app/director-presence"]').catch(() => {})
        await page.waitForTimeout(500)
        const bodyText = await page.locator('body').innerText()
        const filenameVisible = bodyText.includes(pdfName)
        const downloadBtnCount = await page.locator('button[title="Télécharger"]').count()
        await capture(page, 'CAP-ABS-009.png')

        const download = await downloadBytes(directorToken, `/documents/${documentId}/download`)
        const downloadDenied = download.status === 403 || download.status === 404
        const contentType = download.headers.get('content-type') ?? ''
        const disposition = download.headers.get('content-disposition') ?? ''
        const pdfLeak = download.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
        const dispositionLeaks = disposition.includes(pdfName)

        const ok = !hasDocumentsMenu && !filenameVisible && downloadBtnCount === 0 &&
          downloadDenied && !pdfLeak && !dispositionLeaks && !contentType.includes('application/pdf')

        results.push(result({
          id: 'ABS-009',
          priority: 'P1',
          scenario: 'Directeur ne télécharge pas le justificatif',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `menu Documents Directeur=${hasDocumentsMenu} | filename visible UI=${filenameVisible} | boutons téléchargement=${downloadBtnCount} | download API HTTP=${download.status} | Content-Type=${contentType} | filename divulgué=${dispositionLeaks} | PDF divulgué=${pdfLeak}`,
          proof: 'CAP-ABS-009.png',
          error: ok ? '' : 'Directeur accède au justificatif.',
          comment: `documentId=${documentId}, demandeur=DIRECTEUR`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-009 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-009', priority: 'P1', scenario: 'Directeur ne télécharge pas le justificatif', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-010 — RH télécharge le justificatif =====
    {
      const start = Date.now()
      let page
      try {
        let uiHttp = null
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-pdf-documents"]')
        await page.waitForSelector('.rh-documents-tab', { timeout: 10000 })
        await page.locator('.rh-documents-tab', { hasText: 'Justificatifs' }).click()
        await page.waitForSelector('.rh-documents-row--body', { timeout: 10000 })
        const row = page.locator('.rh-documents-row--body', { hasText: pdfName }).first()
        const downloadBtn = row.locator('button[title="Télécharger"]')
        const respPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'GET' && /\/documents\/\d+\/download$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await downloadBtn.click()
        const uiResp = await respPromise
        uiHttp = uiResp.status()
        await page.waitForTimeout(300)
        await capture(page, 'CAP-ABS-010.png')

        const download = await downloadBytes(rhToken, `/documents/${documentId}/download`)
        const contentType = download.headers.get('content-type') ?? ''
        const disposition = download.headers.get('content-disposition') ?? ''
        const signature = download.buffer.subarray(0, 5).toString('ascii')
        const downloadHash = createHash('sha256').update(download.buffer).digest('hex')

        const ok = uiHttp === 200 &&
          download.status === 200 &&
          contentType.includes('application/pdf') &&
          disposition.includes('attachment') &&
          disposition.includes(pdfName) &&
          download.buffer.length === pdfSize &&
          signature === '%PDF-' &&
          downloadHash === pdfHash

        results.push(result({
          id: 'ABS-010',
          priority: 'P1',
          scenario: 'RH télécharge le justificatif',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `UI download HTTP=${uiHttp} | API HTTP=${download.status} | Content-Type=${contentType} | taille=${download.buffer.length} o | signature=${signature} | hash=${downloadHash === pdfHash ? 'identique' : 'différent'}`,
          proof: 'CAP-ABS-010.png',
          error: ok ? '' : 'Téléchargement RH non conforme.',
          comment: `documentId=${documentId}, filename=${pdfName}, sha256=${pdfHash}`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-010 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-010', priority: 'P1', scenario: 'RH télécharge le justificatif', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-011..014 — rejet, ajout collaborateur, archivage réel, acceptation =====
    const newPdfPath = path.resolve(__dirname, '../../fixtures/justificatif-abs-remplacement.pdf')
    const newPdfName = 'justificatif-abs-remplacement.pdf'
    const newPdfBuffer = readFileSync(newPdfPath)
    const newPdfSize = newPdfBuffer.length
    const newPdfHash = createHash('sha256').update(newPdfBuffer).digest('hex')
    const oldDocumentId = documentId
    let newDocumentId = null
    const readAllDocs = async () => {
      const r = await apiRequest(`/documents/management?absenceDeclarationId=${docAbsenceId}`, { token: rhToken })
      return Array.isArray(r.data) ? r.data : []
    }
    const openRhAbsenceDrawer = async (page) => {
      await page.click('a[href="/app/rh-leaves-absences"]')
      await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
      await page.locator('.rh-events-row--data', { hasText: 'Absence justificatif ABS' }).first().click()
      await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    }

    // ===== ABS-011 — RH rejette le justificatif avec un motif (UI) =====
    {
      const start = Date.now()
      let page
      try {
        const docsBefore = await readAllDocs()
        const docBefore = docsBefore.find((d) => d.id === oldDocumentId)
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const reason = 'Justificatif illisible - recette ABS-011.'

        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await openRhAbsenceDrawer(page)
        await page.locator('.rh-absence-button--document-reject').first().click()
        await page.waitForSelector('.rh-absence-document-reject-form textarea', { timeout: 10000 })
        await page.locator('.rh-absence-document-reject-form textarea').fill(reason)
        const rejectRespPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/\d+\/reject$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await page.locator('.rh-absence-button--danger').click()
        const rejectResp = await rejectRespPromise
        const rejectHttp = rejectResp.status()
        let rejectBody = null
        try { rejectBody = await rejectResp.json() } catch { rejectBody = null }
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-011.png')

        const docsAfter = await readAllDocs()
        const docAfter = docsAfter.find((d) => d.id === oldDocumentId)
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        const ok = rejectHttp === 200 &&
          docBefore?.status === 'EN_ATTENTE' &&
          rejectBody?.status === 'REJETE' &&
          rejectBody?.rejectionReason === reason &&
          docAfter?.status === 'REJETE' &&
          docAfter?.rejectionReason === reason &&
          declBefore.data?.status === 'A_VERIFIER_PAR_RH' &&
          declAfter.data?.status === 'JUSTIFICATIF_EN_ATTENTE'

        results.push(result({
          id: 'ABS-011',
          priority: 'P1',
          scenario: 'RH rejette le justificatif avec un motif',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `rejet UI HTTP=${rejectHttp} | document ${docBefore?.status} → ${docAfter?.status} | motif="${docAfter?.rejectionReason}" | déclaration ${declBefore.data?.status} → ${declAfter.data?.status}`,
          proof: 'CAP-ABS-011.png',
          error: ok ? '' : 'Rejet UI non persisté correctement.',
          comment: `documentId=${oldDocumentId}, bouton=Refuser, requête=POST /documents/${oldDocumentId}/reject`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-011 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-011', priority: 'P1', scenario: 'RH rejette le justificatif avec un motif', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-012 — Collaborateur ajoute un nouveau justificatif (vrai parcours UI) =====
    {
      const start = Date.now()
      let page
      try {
        const docsBefore = await readAllDocs()
        const oldBefore = docsBefore.find((d) => d.id === oldDocumentId)

        page = await loginPage(browser, 'col-b.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        await page.locator('.my-request-card', { hasText: 'Absence justificatif ABS' }).first().click()
        await page.waitForSelector('.request-detail-page', { timeout: 10000 })

        const uploadRespPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/absence\/\d+$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await page.setInputFiles('.request-detail-file-input', { name: newPdfName, mimeType: 'application/pdf', buffer: newPdfBuffer })
        const uploadResp = await uploadRespPromise
        const uploadHttp = uploadResp.status()
        let uploadBody = null
        try { uploadBody = await uploadResp.json() } catch { uploadBody = null }
        newDocumentId = uploadBody?.id ?? null
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-012.png')

        const docsAfter = await readAllDocs()
        const oldAfter = docsAfter.find((d) => d.id === oldDocumentId)
        const newDoc = docsAfter.find((d) => d.id === newDocumentId)
        const decl = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        const oldArchived = oldAfter?.status === 'ARCHIVE'
        const ok = uploadHttp === 201 &&
          Boolean(newDocumentId) &&
          newDocumentId !== oldDocumentId &&
          oldBefore?.status === 'REJETE' &&
          oldArchived &&
          newDoc?.status === 'EN_ATTENTE' &&
          newDoc?.originalName === newPdfName &&
          Number(newDoc?.fileSize) === newPdfSize &&
          decl.data?.status === 'A_VERIFIER_PAR_RH'

        results.push(result({
          id: 'ABS-012',
          priority: 'P1',
          scenario: 'Collaborateur remplace le justificatif rejeté',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `libellé UI="Ajouter un justificatif" | requête=POST /documents/absence/${docAbsenceId} HTTP=${uploadHttp} | old ${oldBefore?.status} → ${oldAfter?.status} (archivé=${oldArchived}) | new id=${newDocumentId} (${newDoc?.status}) | déclaration=${decl.data?.status}`,
          proof: 'CAP-ABS-012.png',
          error: ok ? '' : 'Le parcours collaborateur n’archive pas l’ancien justificatif.',
          comment: `oldDocumentId=${oldDocumentId}, newDocumentId=${newDocumentId}, oldHash=${pdfHash}, newHash=${newPdfHash}`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-012 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-012', priority: 'P1', scenario: 'Collaborateur remplace le justificatif rejeté', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-013 — Ancien justificatif réellement archivé ? (état issu de ABS-012) =====
    {
      const start = Date.now()
      let page
      try {
        const docsBefore = await readAllDocs()
        const oldDoc = docsBefore.find((d) => d.id === oldDocumentId)
        const newDoc = docsBefore.find((d) => d.id === newDocumentId)
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        const acceptOld = await apiRequest(`/documents/${oldDocumentId}/accept`, { method: 'POST', token: rhToken })
        const rejectOld = await apiRequest(`/documents/${oldDocumentId}/reject`, { method: 'POST', token: rhToken, body: { reason: 'Tentative ancien document.' } })

        const docsAfter = await readAllDocs()
        const oldDocAfter = docsAfter.find((d) => d.id === oldDocumentId)
        const newDocAfter = docsAfter.find((d) => d.id === newDocumentId)
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        let proof = ''
        try {
          page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
          await openRhAbsenceDrawer(page)
          await page.waitForTimeout(400)
          proof = await capture(page, 'CAP-ABS-013.png')
        } catch { proof = '' }

        const oldArchived = oldDoc?.status === 'ARCHIVE'
        const nonTreatable = (acceptOld.status === 404 || acceptOld.status === 400) && (rejectOld.status === 404 || rejectOld.status === 400)
        const unchanged = oldDocAfter?.status === oldDoc?.status && newDocAfter?.status === newDoc?.status && declBefore.data?.status === declAfter.data?.status
        const ok = oldArchived && nonTreatable && unchanged

        results.push(result({
          id: 'ABS-013',
          priority: 'P1',
          scenario: 'L’ancien justificatif archivé n’est plus traitable',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `old réellement ARCHIVE=${oldArchived} (status=${oldDoc?.status}) | accept old HTTP=${acceptOld.status} | reject old HTTP=${rejectOld.status} | old après=${oldDocAfter?.status} | new après=${newDocAfter?.status} | déclaration ${declBefore.data?.status}→${declAfter.data?.status}`,
          proof: proof || 'CAP-ABS-013.png',
          error: ok ? '' : 'Ancien justificatif non archivé par le parcours collaborateur.',
          comment: `signification archivé = status ARCHIVE (exclu de findActiveOne). oldDocumentId=${oldDocumentId}. Rôle Multi-rôles = formulation générique.`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-013 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-013', priority: 'P1', scenario: 'L’ancien justificatif archivé n’est plus traitable', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-014 — RH accepte le nouveau justificatif (UI) =====
    {
      const start = Date.now()
      let page
      try {
        const before = await readAllDocs()
        const newBefore = before.find((d) => d.id === newDocumentId)
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await openRhAbsenceDrawer(page)
        const acceptBtn = page.locator('.rh-absence-button--document-accept').first()
        await acceptBtn.waitFor({ timeout: 10000 })
        const acceptRespPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/\d+\/accept$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await acceptBtn.click()
        const acceptResp = await acceptRespPromise
        const acceptHttp = acceptResp.status()
        let acceptBody = null
        try { acceptBody = await acceptResp.json() } catch { acceptBody = null }
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-014.png')

        const after = await readAllDocs()
        const newAfter = after.find((d) => d.id === newDocumentId)
        const oldAfter = after.find((d) => d.id === oldDocumentId)
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })

        const second = await apiRequest(`/documents/${newDocumentId}/accept`, { method: 'POST', token: rhToken })

        const ok = acceptHttp === 200 &&
          newBefore?.status === 'EN_ATTENTE' &&
          acceptBody?.status === 'ACCEPTE' &&
          newAfter?.status === 'ACCEPTE' &&
          second.status === 400 &&
          declBefore.data?.status === declAfter.data?.status

        results.push(result({
          id: 'ABS-014',
          priority: 'P1',
          scenario: 'RH accepte le justificatif de remplacement',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `acceptation UI HTTP=${acceptHttp} | new ${newBefore?.status} → ${newAfter?.status} | old=${oldAfter?.status} | 2e acceptation HTTP=${second.status} | déclaration=${declAfter.data?.status}`,
          proof: 'CAP-ABS-014.png',
          error: ok ? '' : 'Acceptation UI non conforme.',
          comment: `newDocumentId=${newDocumentId}, oldDocumentId=${oldDocumentId} (${oldAfter?.status})`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-014 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-014', priority: 'P1', scenario: 'RH accepte le justificatif de remplacement', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-015 — RH enregistre définitivement l'absence (UI) =====
    {
      const start = Date.now()
      let page
      try {
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const statusBefore = declBefore.data?.status
        const docsBefore = await readAllDocs()

        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await openRhAbsenceDrawer(page)
        await page.waitForTimeout(400)
        const registerBtnCount = await page.locator('.rh-absence-button--primary').count()
        await capture(page, 'CAP-ABS-015.png')

        const registerApi = await apiRequest(`/absence-declarations/${docAbsenceId}/register`, { method: 'POST', token: rhToken, body: {} })
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const statusAfter = declAfter.data?.status

        results.push(result({
          id: 'ABS-015',
          priority: 'P1',
          scenario: 'RH enregistre définitivement l’absence',
          type: 'C - UI + API',
          status: STATUS.BLOQUE,
          resultText: `statut=${statusBefore} | bouton Autoriser l'absence visible=${registerBtnCount > 0 ? 'oui' : 'non'} | API register HTTP=${registerApi.status} message="${registerApi.data?.message ?? ''}" | statut après=${statusAfter}`,
          proof: 'CAP-ABS-015.png',
          error: 'Bloqué par ANO-009 : l’ancien justificatif REJETE reste actif, donc « tous les justificatifs actifs acceptés » n’est jamais vrai et l’enregistrement définitif est refusé.',
          comment: `declarationId=${docAbsenceId}, documents actifs=${docsBefore.map((d) => `${d.id}:${d.status}`).join(',')}`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-015 BLOQUÉ — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-015', priority: 'P1', scenario: 'RH enregistre définitivement l’absence', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-016 — RH crée une absence pour un collaborateur (UI) =====
    {
      const start = Date.now()
      let page
      try {
        let createdId = null
        page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-create', { timeout: 10000 })
        await page.click('.rh-events-create')
        await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })

        await page.locator('.rh-declaration-top-grid select').first().selectOption(String(colC.id))
        await page.locator('.rh-declaration-top-grid select').nth(1).selectOption(`ABSENCE:${allowedTypeId}`)
        await page.waitForSelector('.rh-declaration-section', { timeout: 10000 })
        await page.locator('.nr-cal__cell[aria-label="2026-09-25"]').first().click()
        await page.waitForTimeout(200)

        const createRespPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/absence-declarations$/.test(new URL(resp.url()).pathname.replace(/^\/api/, '')),
          { timeout: 15000 },
        )
        await page.locator('.rh-declaration-actions button[type="submit"]').click()
        const createResp = await createRespPromise
        const createHttp = createResp.status()
        let createBody = null
        try { createBody = await createResp.json() } catch { createBody = null }
        createdId = createBody?.id
        await page.waitForTimeout(600)
        await capture(page, 'CAP-ABS-016.png')

        const created = await apiRequest(`/absence-declarations/${createdId}`, { token: rhToken })
        const createdStatus = created.data?.status
        const mgmt = await apiRequest('/absence-declarations/management', { token: rhToken })
        const mgmtList = Array.isArray(mgmt.data) ? mgmt.data : []
        const inRhView = mgmtList.some((a) => a.id === createdId)
        const colCMine = await apiRequest('/absence-declarations/my', { token: colCToken })
        const colCList = Array.isArray(colCMine.data) ? colCMine.data : []
        const visibleColC = colCList.some((a) => a.id === createdId)
        const colBMine = await apiRequest('/absence-declarations/my', { token: colBToken })
        const colBList = Array.isArray(colBMine.data) ? colBMine.data : []
        const visibleColB = colBList.some((a) => a.id === createdId)

        const ok = createHttp === 201 &&
          Boolean(createdId) &&
          created.data?.employeeId === colC.id &&
          created.data?.leaveTypeId === allowedTypeId &&
          created.data?.startDate === '2026-09-25' &&
          created.data?.endDate === '2026-09-25' &&
          createdStatus === 'ENREGISTREE' &&
          inRhView && visibleColC && !visibleColB

        results.push(result({
          id: 'ABS-016',
          priority: 'P1',
          scenario: 'RH crée une absence pour un collaborateur',
          type: 'C - UI + API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: `création UI HTTP=${createHttp} | createdId=${createdId} | collaborateur=COL-C (${colC.id}) | dates=${created.data?.startDate} | statut=${createdStatus} | visible RH=${inRhView} | visible COL-C=${visibleColC} | visible COL-B=${visibleColB}`,
          proof: 'CAP-ABS-016.png',
          error: ok ? '' : 'Création RH non conforme.',
          comment: `type=${allowedTypeId}, bouton=Valider l'absence, requête=POST /absence-declarations`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-016 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-016', priority: 'P1', scenario: 'RH crée une absence pour un collaborateur', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }

    // ===== ABS-017 — Collaborateur annule son brouillon d'absence =====
    {
      const start = Date.now()
      let page
      try {
        // Précondition préparée par RH (ANO-008 empêche la création collaborateur).
        const draft = await apiRequest('/absence-declarations', {
          method: 'POST',
          token: rhToken,
          body: { employeeId: colC.id, leaveTypeId: allowedTypeId, startDate: '2026-09-26', endDate: '2026-09-26' },
        })
        const draftId = draft.data?.id
        const draftBefore = await apiRequest(`/absence-declarations/${draftId}`, { token: rhToken })
        const statusBefore = draftBefore.data?.status

        page = await loginPage(browser, 'col-c.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        const card = page.locator('.my-request-card', { hasText: 'Absence collaborateur ABS' }).first()
        const cancelBtnCount = await card.locator('button[title="Supprimer le brouillon"], button:has-text("Annuler")').count()
        await capture(page, 'CAP-ABS-017.png')

        const cancelApi = await apiRequest(`/absence-declarations/${draftId}/cancel`, { method: 'POST', token: colCToken, body: {} })
        const cancelDenied = cancelApi.status === 403 || cancelApi.status === 401
        const draftAfter = await apiRequest(`/absence-declarations/${draftId}`, { token: rhToken })
        const statusAfter = draftAfter.data?.status

        const preconditionOk = Boolean(draftId) &&
          draftBefore.data?.employeeId === colC.id &&
          statusBefore === 'BROUILLON'
        const cancelUnavailable = cancelBtnCount === 0 && cancelDenied && statusAfter === 'BROUILLON'
        const nonConforme = preconditionOk && cancelUnavailable

        results.push(result({
          id: 'ABS-017',
          priority: 'P1',
          scenario: 'Collaborateur annule son brouillon d’absence',
          type: 'C - UI + API',
          status: nonConforme ? STATUS.NON_CONFORME : STATUS.BLOQUE,
          resultText: `brouillon préparé par RH (draftId=${draftId}, statut=${statusBefore}) | UI bouton annulation=${cancelBtnCount > 0 ? 'oui' : 'non'} | API cancel COL-C HTTP=${cancelApi.status} | statut après=${statusAfter}`,
          proof: 'CAP-ABS-017.png',
          error: nonConforme ? 'Le collaborateur possède un brouillon valide, mais aucune action d’annulation n’est disponible et l’API cancel retourne 403.' : 'Précondition brouillon non satisfaite.',
          comment: `draftId=${draftId}, propriétaire=COL-C (id=${colC.id})`,
          duration: Date.now() - start,
        }))
        console.log(`ABS-017 ${nonConforme ? 'NON CONFORME' : 'BLOQUÉ'} — ${results[results.length - 1].result}`)
      } catch (error) {
        results.push(result({ id: 'ABS-017', priority: 'P1', scenario: 'Collaborateur annule son brouillon d’absence', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }
  }

  await browser.close()
  writeReport(results, { label: 'recette-results-abs' })
  console.log('ABS-001..017 terminés')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
