// Retest LOT 2 — anomalies bloquantes ANO-007 / ANO-009 / ANO-011
// Exécution réelle contre l'instance MySQL isolée (port 3307).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const DB = {
  host: '127.0.0.1',
  port: 3307,
  user: 'recette',
  password: 'recette',
  database: 'gestion_conges_gmes_test',
}

async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection(DB)
  try {
    const [rows] = await c.query(sql, params)
    return rows
  } finally {
    await c.end()
  }
}

async function login(email) {
  const r = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password: 'RecetteGMES@2026!' },
  })
  return r.data?.accessToken
}

async function loginPage(browser, email) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  return page
}

async function capture(page, fileName) {
  try {
    const filePath = path.join(PREUVES_DIR, fileName)
    await page.screenshot({ path: filePath, fullPage: true })
    return fileName
  } catch {
    return ''
  }
}

function stamp() {
  return String(Date.now()).slice(-8)
}

function writeReport(payload) {
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(
    path.join(REPORTS_DIR, 'retest-lot2-bloquantes.json'),
    JSON.stringify(payload, null, 2),
    'utf8',
  )
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const startedAt = Date.now()
  const ts = stamp()

  const [adminToken, rhToken, colAToken, colBToken, colCToken, directeurToken, respToken] =
    await Promise.all([
      login('admin.recette@gmes.fr'),
      login('rh.recette@gmes.fr'),
      login('col-a.recette@gmes.fr'),
      login('col-b.recette@gmes.fr'),
      login('col-c.recette@gmes.fr'),
      login('directeur.recette@gmes.fr'),
      login('responsable.recette@gmes.fr'),
    ])
  if (!adminToken || !rhToken || !colAToken || !colBToken || !colCToken) {
    throw new Error('Connexion impossible pour un ou plusieurs comptes.')
  }

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')
  const colC = users.find((u) => u.email === 'col-c.recette@gmes.fr')

  const browser = await chromium.launch({ headless: true })

  const report = []
  const scenario = (id, status, resultText, extra = {}) => ({
    id,
    status,
    result: resultText,
    ...extra,
  })

  // =========================================================================
  // ANO-007 — Réactivation fermeture GMES (ADM-020 / ADM-021 / ADM-022)
  // =========================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-007',
      cause:
        "Le backend disposait déjà de PATCH /holidays/:id/enable, mais l'UI ne chargeait que les fermetures actives et n'exposait aucune action de réactivation.",
      filesModified: [
        'frontend/src/services/rh/rhHolidays.js',
        'frontend/src/pages/rh/HolidaysPage.jsx',
        'frontend/src/styles/rh/holidays.css',
      ],
      scenarios: [],
      nonRegression: [],
      conclusion: '',
    }
    let closureDate = null
    const closureName = `Fermeture-LOT2-${ts}`
    let closureId = null

    // Choisir un jour ouvré de septembre 2026 sans fermeture GMES existante.
    const mgmt = await apiRequest('/holidays/management?year=2026', { token: adminToken })
    const usedDates = new Set((Array.isArray(mgmt.data) ? mgmt.data : []).filter((h) => h.holidayType === 'FERMETURE_GMES').map((h) => h.date))
    const candidates = []
    for (let d = 1; d <= 30; d += 1) {
      const candidate = `2026-09-${String(d).padStart(2, '0')}`
      const dow = new Date(`${candidate}T00:00:00Z`).getUTCDay()
      if (dow >= 1 && dow <= 5 && !usedDates.has(candidate)) candidates.push(candidate)
    }

    // Service actif pour COL-A (prérequis ADM-022).
    const admSvc = await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service ADM LOT2 ${ts}`, serviceType: 'INTERNE' },
    })
    await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: admSvc.data?.id } })

    // Création fermeture (réessaie sur le jour ouvré suivant en cas de conflit férié).
    for (const candidate of candidates) {
      const create = await apiRequest('/holidays', {
        method: 'POST',
        token: adminToken,
        body: { date: candidate, name: closureName, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' },
      })
      if (create.status === 201 || create.status === 200) {
        closureDate = candidate
        closureId = create.data?.id
        break
      }
    }

    // ADM-020 — désactivation (non-régression)
    try {
      const disable = await apiRequest(`/holidays/${closureId}/disable`, {
        method: 'PATCH',
        token: adminToken,
      })
      const count = await dbQuery(
        `SELECT COUNT(*) AS n FROM holidays WHERE date = ? AND holiday_type = 'FERMETURE_GMES'`,
        [closureDate],
      )
      const ok = disable.status === 200 && disable.data?.isActive === false && Number(count[0].n) === 1
      anomaly.scenarios.push(scenario('ADM-020', ok ? 'Conforme' : 'Non conforme',
        `PATCH /holidays/${closureId}/disable HTTP=${disable.status} | isActive=${disable.data?.isActive} | fermetures pour cette date=${count[0].n} (aucun doublon)`, { http: disable.status }))
    } catch (e) {
      anomaly.scenarios.push(scenario('ADM-020', 'Bloqué', e.message))
    }

    // ADM-021 — réactivation depuis l'UI (nouvelle action)
    try {
      let page = await loginPage(browser, 'rh.recette@gmes.fr')
      await page.click('a[href="/app/rh-holidays"]')
      await page.waitForSelector('.rh-holidays-row--body', { timeout: 15000 })
      const row = page.locator('.rh-holidays-row--body', { hasText: closureName }).first()
      await row.waitFor({ timeout: 10000 })
      const statusText = await row.locator('.rh-holidays-status').textContent().catch(() => '')
      const reactivateBtn = row.locator('button[title="Réactiver la fermeture"]')
      const btnPresent = await reactivateBtn.count()
      const enablePromise = page.waitForResponse(
        (resp) => resp.request().method() === 'PATCH' && /\/holidays\/\d+\/enable$/.test(new URL(resp.url()).pathname),
        { timeout: 15000 },
      )
      if (btnPresent) {
        await reactivateBtn.click()
      }
      const enableResp = await enablePromise
      const enableHttp = enableResp.status()
      await page.waitForTimeout(400)
      await capture(page, 'CAP-ADM-021.png')
      await page.close()

      const check = await apiRequest(`/holidays/${closureId}`, { token: adminToken })
      const ok = btnPresent === 1 &&
        enableHttp === 200 &&
        statusText.trim() === 'Inactive' &&
        check.data?.isActive === true
      anomaly.scenarios.push(scenario('ADM-021', ok ? 'Conforme' : 'Non conforme',
        `UI bouton Réactiver présent=${btnPresent === 1} | statut affiché="${statusText.trim()}" | PATCH /holidays/${closureId}/enable HTTP=${enableHttp} | isActive après=${check.data?.isActive}`, { http: enableHttp }))
    } catch (e) {
      anomaly.scenarios.push(scenario('ADM-021', 'Bloqué', e.message))
    }

    // ADM-022 — fermeture (réactivée) non décomptable
    try {
      const paidType = await apiRequest('/leave-types', {
        method: 'POST',
        token: adminToken,
        body: { name: `Congé ADM LOT2 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true },
      })
      const req = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId: paidType.data?.id, startDate: closureDate, endDate: closureDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const msg = String(req.data?.message ?? '')
      const ok = req.status === 400 && /non décomptable|décomptable|fermeture|n’est pas/i.test(msg)
      anomaly.scenarios.push(scenario('ADM-022', ok ? 'Conforme' : 'Non conforme',
        `POST /leave-requests startDate=${closureDate} HTTP=${req.status} message="${msg}"`, { http: req.status }))
    } catch (e) {
      anomaly.scenarios.push(scenario('ADM-022', 'Bloqué', e.message))
    }

    const conformes = anomaly.scenarios.every((s) => s.status === 'Conforme')
    anomaly.conclusion = conformes
      ? 'ANO-007 corrigée : réactivation UI disponible, désactivation préservée, fermeture non décomptable toujours appliquée.'
      : 'ANO-007 partiellement corrigée — voir scénarios non conformes.'
    report.push(anomaly)
  }

  // =========================================================================
  // ANO-009 — Archivage du justificatif rejeté (ABS-011..015)
  // =========================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-009',
      cause:
        "uploadForAbsence créait un nouveau justificatif sans archiver l'ancien REJETE ; l'ancien restait actif et bloquait l'enregistrement définitif (registerByRh).",
      filesModified: ['backend/src/documents/documents.service.ts'],
      scenarios: [],
      nonRegression: [],
      conclusion: '',
    }
    const pdfPath = path.resolve(__dirname, '../fixtures/justificatif-abs-recette.pdf')
    const pdfName = 'justificatif-abs-recette.pdf'
    const pdfBuffer = readFileSync(pdfPath)
    const pdfSize = pdfBuffer.length
    const newPdfPath = path.resolve(__dirname, '../fixtures/justificatif-abs-remplacement.pdf')
    const newPdfName = 'justificatif-abs-remplacement.pdf'
    const newPdfBuffer = readFileSync(newPdfPath)
    const newPdfSize = newPdfBuffer.length

    let docAbsenceId = null
    let oldDocumentId = null
    let newDocumentId = null

    try {
      const docType = await apiRequest('/leave-types', {
        method: 'POST',
        token: adminToken,
        body: { name: `Absence justif LOT2 ${ts}`, category: 'DECLARATION_ABSENCE', documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false },
      })
      const svc = await apiRequest('/services', {
        method: 'POST',
        token: adminToken,
        body: { name: `Service ABS LOT2 ${ts}`, serviceType: 'INTERNE' },
      })
      await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc.data?.id } })
      const abs = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: rhToken,
        body: { employeeId: colB.id, leaveTypeId: docType.data?.id, startDate: '2026-12-20', endDate: '2026-12-20', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `ABS justif LOT2 ${ts}` },
      })
      docAbsenceId = abs.data?.id
      await apiRequest(`/absence-declarations/${docAbsenceId}/submit`, {
        method: 'POST', token: rhToken, body: { certifiedAccurate: true },
      })
    } catch (e) {
      anomaly.scenarios.push(scenario('ABS-011', 'Bloqué', `Fixture: ${e.message}`))
      anomaly.scenarios.push(scenario('ABS-012', 'Bloqué', 'Prérequis ABS-011 indisponible.'))
      anomaly.scenarios.push(scenario('ABS-013', 'Bloqué', 'Prérequis ABS-012 indisponible.'))
      anomaly.scenarios.push(scenario('ABS-014', 'Bloqué', 'Prérequis ABS-013 indisponible.'))
      anomaly.scenarios.push(scenario('ABS-015', 'Bloqué', 'Prérequis ABS-014 indisponible.'))
    }

    const readAllDocs = async () => {
      const r = await apiRequest(`/documents/management?absenceDeclarationId=${docAbsenceId}`, { token: rhToken })
      return Array.isArray(r.data) ? r.data : []
    }

    // Upload initial du justificatif (prérequis ABS-011) — via UI collaborateur
    if (docAbsenceId) {
      try {
        let page = await loginPage(browser, 'col-b.recette@gmes.fr')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        await page.locator('.my-request-card', { hasText: `Absence justif LOT2 ${ts}` }).first().click()
        await page.waitForSelector('.request-detail-page', { timeout: 10000 })
        const upPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/absence\/\d+$/.test(new URL(resp.url()).pathname),
          { timeout: 15000 },
        )
        await page.setInputFiles('.request-detail-file-input', { name: pdfName, mimeType: 'application/pdf', buffer: pdfBuffer })
        const upResp = await upPromise
        const body = await upResp.json().catch(() => null)
        oldDocumentId = body?.id ?? null
        await page.waitForTimeout(400)
        await page.close()
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-011', 'Bloqué', `Upload initial: ${e.message}`))
      }
    }

    // ABS-011 — RH rejette le justificatif (UI)
    if (oldDocumentId) {
      try {
        const reason = 'Justificatif illisible - retest LOT2.'
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        let page = await loginPage(browser, 'rh.recette@gmes.fr')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
        await page.locator('.rh-events-row--data', { hasText: `Absence justif LOT2 ${ts}` }).first().click()
        await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
        await page.locator('.rh-absence-button--document-reject').first().click()
        await page.waitForSelector('.rh-absence-document-reject-form textarea', { timeout: 10000 })
        await page.locator('.rh-absence-document-reject-form textarea').fill(reason)
        const rejPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/\d+\/reject$/.test(new URL(resp.url()).pathname),
          { timeout: 15000 },
        )
        await page.locator('.rh-absence-button--danger').click()
        const rejResp = await rejPromise
        await page.waitForTimeout(400)
        await page.close()

        const docs = await readAllDocs()
        const doc = docs.find((d) => d.id === oldDocumentId)
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const ok = rejResp.status() === 200 && doc?.status === 'REJETE' && doc?.rejectionReason === reason && declAfter.data?.status === 'JUSTIFICATIF_EN_ATTENTE'
        anomaly.scenarios.push(scenario('ABS-011', ok ? 'Conforme' : 'Non conforme',
          `rejet UI HTTP=${rejResp.status()} | document EN_ATTENTE → ${doc?.status} | motif="${doc?.rejectionReason}" | déclaration ${declBefore.data?.status} → ${declAfter.data?.status}`, { http: rejResp.status() }))
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-011', 'Bloqué', e.message))
      }
    }

    // ABS-012 — Collaborateur remplace le justificatif rejeté (UI)
    if (oldDocumentId) {
      try {
        const oldBefore = (await readAllDocs()).find((d) => d.id === oldDocumentId)
        let page = await loginPage(browser, 'col-b.recette@gmes.fr')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        await page.locator('.my-request-card', { hasText: `Absence justif LOT2 ${ts}` }).first().click()
        await page.waitForSelector('.request-detail-page', { timeout: 10000 })
        const upPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/absence\/\d+$/.test(new URL(resp.url()).pathname),
          { timeout: 15000 },
        )
        await page.setInputFiles('.request-detail-file-input', { name: newPdfName, mimeType: 'application/pdf', buffer: newPdfBuffer })
        const upResp = await upPromise
        const body = await upResp.json().catch(() => null)
        newDocumentId = body?.id ?? null
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-012.png')
        await page.close()

        const docs = await readAllDocs()
        const oldAfter = docs.find((d) => d.id === oldDocumentId)
        const newDoc = docs.find((d) => d.id === newDocumentId)
        const decl = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const oldArchived = oldAfter?.status === 'ARCHIVE'
        const ok = upResp.status() === 201 &&
          Boolean(newDocumentId) && newDocumentId !== oldDocumentId &&
          oldBefore?.status === 'REJETE' && oldArchived &&
          newDoc?.status === 'EN_ATTENTE' &&
          Number(newDoc?.fileSize) === newPdfSize &&
          decl.data?.status === 'A_VERIFIER_PAR_RH'
        anomaly.scenarios.push(scenario('ABS-012', ok ? 'Conforme' : 'Non conforme',
          `POST /documents/absence/${docAbsenceId} HTTP=${upResp.status()} | old ${oldBefore?.status} → ${oldAfter?.status} (archivé=${oldArchived}) | new id=${newDocumentId} (${newDoc?.status}) | déclaration=${decl.data?.status}`, { http: upResp.status() }))
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-012', 'Bloqué', e.message))
      }
    }

    // ABS-013 — Ancien justificatif archivé non traitable
    if (oldDocumentId && newDocumentId) {
      try {
        const docsBefore = await readAllDocs()
        const oldDoc = docsBefore.find((d) => d.id === oldDocumentId)
        const newDoc = docsBefore.find((d) => d.id === newDocumentId)
        const acceptOld = await apiRequest(`/documents/${oldDocumentId}/accept`, { method: 'POST', token: rhToken })
        const rejectOld = await apiRequest(`/documents/${oldDocumentId}/reject`, { method: 'POST', token: rhToken, body: { reason: 'Tentative ancien document.' } })
        const docsAfter = await readAllDocs()
        const oldAfter = docsAfter.find((d) => d.id === oldDocumentId)
        const newAfter = docsAfter.find((d) => d.id === newDocumentId)
        const oldArchived = oldDoc?.status === 'ARCHIVE'
        const nonTreatable = (acceptOld.status === 404 || acceptOld.status === 400) && (rejectOld.status === 404 || rejectOld.status === 400)
        const unchanged = oldAfter?.status === oldDoc?.status && newAfter?.status === newDoc?.status
        const ok = oldArchived && nonTreatable && unchanged
        anomaly.scenarios.push(scenario('ABS-013', ok ? 'Conforme' : 'Non conforme',
          `old réellement ARCHIVE=${oldArchived} (${oldDoc?.status}) | accept old HTTP=${acceptOld.status} | reject old HTTP=${rejectOld.status} | old après=${oldAfter?.status} | new après=${newAfter?.status}`, { http: acceptOld.status }))
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-013', 'Bloqué', e.message))
      }
    }

    // ABS-014 — RH accepte le justificatif de remplacement (UI)
    if (newDocumentId) {
      try {
        const before = (await readAllDocs()).find((d) => d.id === newDocumentId)
        let page = await loginPage(browser, 'rh.recette@gmes.fr')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
        await page.locator('.rh-events-row--data', { hasText: `Absence justif LOT2 ${ts}` }).first().click()
        await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
        const acceptBtn = page.locator('.rh-absence-button--document-accept').first()
        await acceptBtn.waitFor({ timeout: 10000 })
        const accPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/documents\/\d+\/accept$/.test(new URL(resp.url()).pathname),
          { timeout: 15000 },
        )
        await acceptBtn.click()
        const accResp = await accPromise
        await page.waitForTimeout(400)
        await capture(page, 'CAP-ABS-014.png')
        await page.close()

        const after = (await readAllDocs()).find((d) => d.id === newDocumentId)
        const ok = accResp.status() === 200 && before?.status === 'EN_ATTENTE' && after?.status === 'ACCEPTE'
        anomaly.scenarios.push(scenario('ABS-014', ok ? 'Conforme' : 'Non conforme',
          `acceptation UI HTTP=${accResp.status()} | new ${before?.status} → ${after?.status}`, { http: accResp.status() }))
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-014', 'Bloqué', e.message))
      }
    }

    // ABS-015 — RH enregistre définitivement l'absence (UI bouton + API)
    if (newDocumentId) {
      try {
        const declBefore = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        let page = await loginPage(browser, 'rh.recette@gmes.fr')
        await page.click('a[href="/app/rh-leaves-absences"]')
        await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
        await page.locator('.rh-events-row--data', { hasText: `Absence justif LOT2 ${ts}` }).first().click()
        await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
        await page.waitForTimeout(400)
        const registerBtnCount = await page.locator('.rh-absence-button--primary').count()
        await capture(page, 'CAP-ABS-015.png')
        await page.close()

        const registerApi = await apiRequest(`/absence-declarations/${docAbsenceId}/register`, { method: 'POST', token: rhToken, body: {} })
        const declAfter = await apiRequest(`/absence-declarations/${docAbsenceId}`, { token: rhToken })
        const ok = registerBtnCount > 0 && registerApi.status === 200 && declAfter.data?.status === 'ENREGISTREE'
        anomaly.scenarios.push(scenario('ABS-015', ok ? 'Conforme' : 'Non conforme',
          `bouton Autoriser l'absence visible=${registerBtnCount > 0 ? 'oui' : 'non'} | register HTTP=${registerApi.status} | statut ${declBefore.data?.status} → ${declAfter.data?.status}`, { http: registerApi.status }))
      } catch (e) {
        anomaly.scenarios.push(scenario('ABS-015', 'Bloqué', e.message))
      }
    }

    const conformes = anomaly.scenarios.every((s) => s.status === 'Conforme')
    anomaly.conclusion = conformes
      ? 'ANO-009 corrigée : le remplacement archive l’ancien justificatif rejeté, le nouveau est EN_ATTENTE, et l’enregistrement définitif aboutit.'
      : 'ANO-009 partiellement corrigée — voir scénarios non conformes.'
    report.push(anomaly)
  }

  // =========================================================================
  // ANO-011 — Annulation avant décision (CAN-002 / RHC-031 / RHC-032 / HALF-054)
  // =========================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-011',
      cause:
        "Le nouveau modèle de compteurs ne réserve plus de jours à la soumission ; cancelBeforeDecision exigeait pourtant releasedDays === deductedDays alors qu'aucune réservation active n'existe (releasedDays=0).",
      filesModified: ['backend/src/leave-requests/leave-requests.service.ts'],
      scenarios: [],
      nonRegression: [],
      conclusion: '',
    }
    const ltName = `Congés payés LOT2 ${ts}`
    let leaveTypeId = null
    let svcId = null
    try {
      const lt = await apiRequest('/leave-types', {
        method: 'POST',
        token: adminToken,
        body: { name: ltName, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true },
      })
      leaveTypeId = lt.data?.id
      const svc = await apiRequest('/services', {
        method: 'POST',
        token: adminToken,
        body: { name: `Service CAN LOT2 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
      })
      svcId = svc.data?.id
      await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svcId } })
      await apiRequest('/leave-balances/initialize', {
        method: 'POST',
        token: rhToken,
        body: { employeeId: colA.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'Fixture LOT2.' },
      }).catch(() => {})
    } catch (e) {
      anomaly.scenarios.push(scenario('CAN-002', 'Bloqué', `Fixture: ${e.message}`))
      anomaly.scenarios.push(scenario('RHC-031', 'Bloqué', 'Prérequis indisponible.'))
      anomaly.scenarios.push(scenario('RHC-032', 'Bloqué', 'Prérequis indisponible.'))
      anomaly.scenarios.push(scenario('HALF-054', 'Bloqué', 'Prérequis indisponible.'))
    }

    const newRequest = async (startDate, endDate, startPeriod = 'MATIN', endPeriod = 'APRES_MIDI') => {
      const r = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate, endDate, startPeriod, endPeriod },
      })
      return r.data?.id
    }
    const submitRequest = (id) =>
      apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })

    // CAN-002 — collaborateur annule avant décision (UI)
    if (leaveTypeId) {
      try {
        const rid = await newRequest('2026-12-21', '2026-12-22')
        await submitRequest(rid)
        const before = await apiRequest(`/leave-requests/${rid}`, { token: colAToken })
        const movBefore = await dbQuery(`SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id = ?`, [rid])

        let page = await loginPage(browser, 'col-a.recette@gmes.fr')
        await page.click('a[href="/app/my-requests"]')
        await page.waitForSelector('.my-request-card', { timeout: 10000 })
        await page.locator('.my-request-card', { hasText: ltName }).first().click()
        await page.waitForSelector('.request-detail-button--danger-outline', { timeout: 10000 })
        page.on('dialog', (dialog) => dialog.accept())
        const cancelPromise = page.waitForResponse(
          (resp) => resp.request().method() === 'POST' && /\/leave-requests\/\d+\/cancel$/.test(new URL(resp.url()).pathname),
          { timeout: 15000 },
        )
        await page.locator('.request-detail-button--danger-outline', { hasText: 'Annuler la demande' }).click()
        const cancelResp = await cancelPromise
        const http = cancelResp.status()
        await page.waitForTimeout(400)
        await capture(page, 'CAP-CAN-002.png')
        await page.close()

        const after = await apiRequest(`/leave-requests/${rid}`, { token: colAToken })
        const movAfter = await dbQuery(`SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id = ?`, [rid])
        const ok = http === 200 &&
          before.data?.status === 'EN_ATTENTE_VALIDATION' &&
          after.data?.status === 'ANNULEE' &&
          Number(movBefore[0].n) === 0 && Number(movAfter[0].n) === 0
        anomaly.scenarios.push(scenario('CAN-002', ok ? 'Conforme' : 'Non conforme',
          `cancel UI HTTP=${http} | statut ${before.data?.status} → ${after.data?.status} | mouvements solde ${movBefore[0].n} → ${movAfter[0].n} (aucun débit/crédit double)`, { http }))
      } catch (e) {
        anomaly.scenarios.push(scenario('CAN-002', 'Bloqué', e.message))
      }
    }

    // RHC-031 (non-régression) + RHC-032 + ownership
    if (leaveTypeId) {
      try {
        const rid = await newRequest('2026-12-28', '2026-12-29')
        await submitRequest(rid)
        const rhCancel = await apiRequest(`/leave-requests/${rid}/cancel`, { method: 'POST', token: rhToken, body: { reason: 'Tentative RH.' } })
        anomaly.scenarios.push(scenario('RHC-031', rhCancel.status === 403 ? 'Conforme' : 'Non conforme',
          `RH cancel HTTP=${rhCancel.status} (interdiction préservée)`, { http: rhCancel.status }))

        const otherCancel = await apiRequest(`/leave-requests/${rid}/cancel`, { method: 'POST', token: colBToken, body: { reason: 'Tentative autre collaborateur.' } })
        anomaly.nonRegression.push(scenario('OWNERSHIP', otherCancel.status === 403 ? 'Conforme' : 'Non conforme',
          `autre collaborateur (COL-B) cancel HTTP=${otherCancel.status}`, { http: otherCancel.status }))

        const colCancel = await apiRequest(`/leave-requests/${rid}/cancel`, { method: 'POST', token: colAToken, body: { reason: 'Annulation recette.' } })
        const after = await apiRequest(`/leave-requests/${rid}`, { token: colAToken })
        const ok = colCancel.status === 200 && after.data?.status === 'ANNULEE'
        anomaly.scenarios.push(scenario('RHC-032', ok ? 'Conforme' : 'Non conforme',
          `collaborateur propriétaire cancel HTTP=${colCancel.status} | statut=${after.data?.status}`, { http: colCancel.status }))
      } catch (e) {
        anomaly.scenarios.push(scenario('RHC-031', 'Bloqué', e.message))
        anomaly.scenarios.push(scenario('RHC-032', 'Bloqué', e.message))
      }
    }

    // HALF-054 — annulation avec demi-journée
    if (leaveTypeId) {
      try {
        const rid = await newRequest('2026-12-30', '2026-12-30', 'MATIN', 'MATIN')
        await submitRequest(rid)
        const before = await apiRequest(`/leave-requests/${rid}`, { token: colAToken })
        const deductedDays = Number(before.data?.deductedDays)
        const cancel = await apiRequest(`/leave-requests/${rid}/cancel`, { method: 'POST', token: colAToken, body: { reason: 'Annulation demi-journée.' } })
        const after = await apiRequest(`/leave-requests/${rid}`, { token: colAToken })
        const ok = cancel.status === 200 && after.data?.status === 'ANNULEE' && deductedDays === 0.5
        anomaly.scenarios.push(scenario('HALF-054', ok ? 'Conforme' : 'Non conforme',
          `demi-journée deductedDays=${deductedDays} | cancel HTTP=${cancel.status} | statut=${after.data?.status}`, { http: cancel.status }))
      } catch (e) {
        anomaly.scenarios.push(scenario('HALF-054', 'Bloqué', e.message))
      }
    }

    const conformes = anomaly.scenarios.every((s) => s.status === 'Conforme')
    anomaly.conclusion = conformes
      ? 'ANO-011 corrigée : annulation avant décision autorisée au propriétaire, interdictions préservées, demi-journées gérées, aucun mouvement de solde parasite.'
      : 'ANO-011 partiellement corrigée — voir scénarios non conformes.'
    report.push(anomaly)
  }

  // =========================================================================
  // Non-régression LOT 1 — ABS-001 / ABS-004 / ABS-017
  // =========================================================================
  const lot1 = {
    anomalyId: 'NON_REGRESSION_LOT1',
    cause: 'Contrôle de non-régression des correctifs LOT 1 (absences collaborateur).',
    filesModified: [],
    scenarios: [],
    conclusion: '',
  }
  {
    try {
      const allowedType = await apiRequest('/leave-types', {
        method: 'POST',
        token: adminToken,
        body: { name: `Absence collab LOT1-reg ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false },
      })
      const svc = await apiRequest('/services', {
        method: 'POST', token: adminToken, body: { name: `Service ABS LOT1-reg ${ts}`, serviceType: 'INTERNE' },
      })
      await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc.data?.id } })

      // ABS-001
      const create = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId: allowedType.data?.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `RETEST LOT2 ABS-001 ${ts}` },
      })
      const draftId = create.data?.id
      const ok001 = (create.status === 201 || create.status === 200) && create.data?.status === 'BROUILLON' && create.data?.employeeId === colB.id
      lot1.scenarios.push(scenario('ABS-001', ok001 ? 'Conforme' : 'Non conforme',
        `POST /absence-declarations HTTP=${create.status} | status=${create.data?.status} | employeeId=self=${create.data?.employeeId === colB.id}`, { http: create.status }))

      // ABS-004
      const submit = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: colBToken, body: { certifiedAccurate: true } })
      const afterSub = await apiRequest(`/absence-declarations/${draftId}`, { token: colBToken })
      const ok004 = submit.status === 200 && afterSub.data?.status === 'A_VERIFIER_PAR_RH'
      lot1.scenarios.push(scenario('ABS-004', ok004 ? 'Conforme' : 'Non conforme',
        `submit HTTP=${submit.status} | BROUILLON → ${afterSub.data?.status}`, { http: submit.status }))

      // ABS-017
      const draft2 = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId: allowedType.data?.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `RETEST LOT2 ABS-017 ${ts}` },
      })
      const draft2Id = draft2.data?.id
      const cancel = await apiRequest(`/absence-declarations/${draft2Id}/cancel`, { method: 'POST', token: colBToken, body: {} })
      const afterCancel = await apiRequest(`/absence-declarations/${draft2Id}`, { token: colBToken })
      const ok017 = cancel.status === 200 && afterCancel.data?.status === 'ANNULEE'
      lot1.scenarios.push(scenario('ABS-017', ok017 ? 'Conforme' : 'Non conforme',
        `cancel HTTP=${cancel.status} | BROUILLON → ${afterCancel.data?.status}`, { http: cancel.status }))
    } catch (e) {
      lot1.scenarios.push(scenario('ABS-001', 'Bloqué', e.message))
      lot1.scenarios.push(scenario('ABS-004', 'Bloqué', e.message))
      lot1.scenarios.push(scenario('ABS-017', 'Bloqué', e.message))
    }
  }
  lot1.conclusion = lot1.scenarios.every((s) => s.status === 'Conforme')
    ? 'Non-régression LOT 1 préservée : ABS-001, ABS-004 et ABS-017 conformes.'
    : 'Non-régression LOT 1 impactée — voir scénarios.'
  report.push(lot1)

  await browser.close()

  const payload = {
    generatedAt: new Date().toISOString(),
    dateRetest: '29/09/2026',
    executed: true,
    anomalies: report,
  }
  writeReport(payload)

  console.log('\n===== SYNTHÈSE RETEST LOT 2 =====')
  for (const a of report) {
    console.log(`\n${a.anomalyId}: ${a.conclusion}`)
    for (const s of [...a.scenarios, ...(a.nonRegression ?? [])]) {
      console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
    }
  }
  console.log(`\nRapport écrit dans tests/recette/reports/retest-lot2-bloquantes.json (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
