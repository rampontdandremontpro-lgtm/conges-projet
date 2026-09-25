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
    module: 'DER',
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

async function navigateViaSidebar(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  await link.waitFor({ state: 'visible', timeout: 10000 })
  await link.click()
  await page.waitForURL(`**${href}`, { timeout: 10000 })
}

async function openDraftCard(page, hasText) {
  await page.waitForSelector('.my-request-card', { timeout: 10000 })
  const card = page.locator('.my-request-card', { hasText }).first()
  await card.click()
  await page.waitForURL('**/new-request/**', { timeout: 10000 })
}

function frenchRange(startIso, endIso) {
  const [sy, sm, sd] = startIso.split('-')
  const [ey, em, ed] = endIso.split('-')
  return `${sd}/${sm}/${sy} → ${ed}/${em}/${ey}`
}

async function login(email) {
  const r = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password: 'RecetteGMES@2026!' },
  })
  return r.data?.accessToken
}

function dbConn() {
  return mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'gestion_conges_gmes_test',
  })
}

function isoAddDays(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function utcWeekday(iso) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Fenêtre dérogatoire : départ dans [minOffset, minOffset+20] jours, jours ouvrés
// consécutifs, sans dimanche ni jour férié (la base recette ne contient aucun jour férié).
function pickDerogationWindow(minOffset) {
  const base = todayIso()
  let start = isoAddDays(base, minOffset)
  for (let i = 0; i < 40; i += 1) {
    const startDow = utcWeekday(start)
    const end = isoAddDays(start, 1)
    const endDow = utcWeekday(end)
    const weekdays = startDow >= 1 && startDow <= 5 && endDow >= 1 && endDow <= 5
    if (weekdays) {
      return { start, end }
    }
    start = isoAddDays(start, 1)
  }
  throw new Error('Impossible de déterminer une fenêtre de dérogation ouvrée.')
}

async function readDerogationAudit(leaveRequestId) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(
      `SELECT action, actor_id AS actorId, new_value AS newValue
         FROM audit_logs
        WHERE resource_type = 'DEROGATIONS' AND resource_id = ?
        ORDER BY id ASC`,
      [leaveRequestId],
    )
    return rows.map((row) => {
      let newValue = row.newValue
      if (typeof newValue === 'string') {
        try { newValue = JSON.parse(newValue) } catch { newValue = null }
      }
      return { action: row.action, actorId: row.actorId, newValue }
    })
  } finally {
    await conn.end()
  }
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []

  console.log('Préparation fixture DER...')
  const [colAToken, respToken, rhToken, adminToken, dirToken] = await Promise.all([
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

  const rhMe = await apiRequest('/users/me', { token: rhToken })
  const rhId = rhMe.data?.id
  const dirMe = await apiRequest('/users/me', { token: dirToken })
  const dirId = dirMe.data?.id

  const leaveType = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Congés payés DER',
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
    body: { name: 'Service DER', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })
  const serviceId = svc.data?.id
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id } })
  await apiRequest('/leave-balances/initialize', {
    method: 'POST',
    token: rhToken,
    body: { employeeId: colA.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'Fixture DER.' },
  }).catch(() => {})

  // Demande 1 : support de la chaîne partagée DER-001..006.
  const window1 = pickDerogationWindow(4)
  const draft1 = await apiRequest('/leave-requests', {
    method: 'POST',
    token: colAToken,
    body: { leaveTypeId, startDate: window1.start, endDate: window1.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
  })
  const requestId1 = draft1.data?.id

  const browser = await chromium.launch({ headless: true })

  // ===== DER-001 — Collaborateur crée une dérogation (UI réelle NewRequestPage) =====
  let derogationId1
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await navigateViaSidebar(page, '/app/my-requests')
      await openDraftCard(page, 'Congés payés DER')
      await page.waitForSelector('.nr-recap__derogation-cta', { timeout: 15000 })
      await page.click('.nr-recap__derogation-cta')
      await page.waitForSelector('#derogation-reason', { timeout: 10000 })
      await page.fill('#derogation-reason', 'Motif initial recette DER-001.')

      const postPromise = page.waitForResponse((resp) => {
        if (resp.request().method() !== 'POST') return false
        return /\/derogations$/.test(new URL(resp.url()).pathname)
      }, { timeout: 15000 })

      await page.locator('.nr-derogation-form__actions button', { hasText: 'Envoyer la demande' }).click()
      const postResp = await postPromise
      const http = postResp.status()
      await page.waitForTimeout(500)
      await capture(page, 'CAP-DER-001.png')

      const my = await apiRequest('/derogations/my', { token: colAToken })
      const myList = Array.isArray(my.data) ? my.data : []
      const created = myList.find((d) => Number(d.leaveRequestId) === Number(requestId1))
      const persisted = created ? await apiRequest(`/derogations/my/${created.id}`, { token: colAToken }) : { status: 0, data: null }
      const duplicateCount = myList.filter((d) => Number(d.leaveRequestId) === Number(requestId1)).length

      if (created?.id) derogationId1 = created.id

      const ok = http === 201 &&
        Boolean(created) &&
        created.status === 'EN_ATTENTE_RH' &&
        created.reason === 'Motif initial recette DER-001.' &&
        persisted.status === 200 &&
        Number(persisted.data?.id) === Number(created.id) &&
        duplicateCount === 1

      results.push(result({
        id: 'DER-001',
        priority: 'P2',
        scenario: 'Collaborateur crée une dérogation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `POST /derogations UI HTTP=${http} | statut initial=${created?.status} | motif="${created?.reason}" | persistance GET=${persisted.status} | doublons=${duplicateCount}`,
        proof: 'CAP-DER-001.png',
        error: ok ? '' : 'Création de dérogation non conforme.',
        comment: `derogationId=${derogationId1}, requestId=${requestId1}, période=${window1.start}→${window1.end}. Erratum : aucune page Dérogations collaborateur ; la création réelle passe par Nouvelle demande (RecapCard).`,
        duration: Date.now() - start,
      }))
      console.log(`DER-001 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-001', priority: 'P2', scenario: 'Collaborateur crée une dérogation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== DER-002 — Modifier le motif (API : aucune UI de modification du motif) =====
  {
    const start = Date.now()
    try {
      const before = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })
      const update = await apiRequest(`/derogations/${derogationId1}`, {
        method: 'PATCH',
        token: colAToken,
        body: { reason: 'Motif modifié recette DER-002.' },
      })
      const after = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })
      const my = await apiRequest('/derogations/my', { token: colAToken })
      const myList = Array.isArray(my.data) ? my.data : []
      const duplicateCount = myList.filter((d) => Number(d.leaveRequestId) === Number(requestId1)).length

      const ok = update.status === 200 &&
        update.data?.reason === 'Motif modifié recette DER-002.' &&
        after.data?.reason === 'Motif modifié recette DER-002.' &&
        before.data?.reason === 'Motif initial recette DER-001.' &&
        duplicateCount === 1

      results.push(result({
        id: 'DER-002',
        priority: 'P2',
        scenario: 'Collaborateur modifie le motif de dérogation',
        type: 'B - API',
        status: STATUS.NON_CONFORME,
        resultText: `PATCH /derogations/:id HTTP=${update.status} | motif "${before.data?.reason}" → "${after.data?.reason}" | persistance=${after.data?.reason === 'Motif modifié recette DER-002.'} | doublons=${duplicateCount}`,
        proof: '',
        error: 'ANO-012 : le backend expose PATCH /derogations/:id pour modifier le motif, mais aucune action correspondante n’est disponible dans l’interface collaborateur.',
        comment: `derogationId=${derogationId1}. Écart UI produit : modification du motif réalisable uniquement par API.`,
        duration: Date.now() - start,
      }))
      console.log(`DER-002 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-002', priority: 'P2', scenario: 'Collaborateur modifie le motif de dérogation', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== DER-003 — Soumettre la dérogation (API : aucune UI de soumission dédiée) =====
  {
    const start = Date.now()
    let page
    try {
      const submit = await apiRequest(`/derogations/${derogationId1}/submit`, {
        method: 'POST',
        token: colAToken,
      })
      const after = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })
      const audit = await readDerogationAudit(requestId1)
      const demanded = audit.filter((entry) => entry.action === 'DEROGATION_DEMANDEE')
      const lastDemanded = demanded[demanded.length - 1]
      const lastMetaDerogationId = lastDemanded?.newValue?.metadata?.derogationId

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await navigateViaSidebar(page, '/app/my-requests')
      await openDraftCard(page, 'Congés payés DER')
      await page.waitForSelector('.nr-derogation-badge', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(400)
      await capture(page, 'CAP-DER-003.png')

      const ok = submit.status === 200 &&
        after.data?.status === 'EN_ATTENTE_RH' &&
        demanded.length >= 2 &&
        Number(lastMetaDerogationId) === Number(derogationId1)

      results.push(result({
        id: 'DER-003',
        priority: 'P1',
        scenario: 'Collaborateur soumet la dérogation',
        type: 'B - API',
        status: STATUS.NON_CONFORME,
        resultText: `POST /derogations/:id/submit HTTP=${submit.status} | statut suivant=${after.data?.status} | trace DEROGATION_DEMANDEE=${demanded.length} entrée(s), dernière derogationId=${lastMetaDerogationId} | signature dédiée=aucune (non prévue pour une dérogation)`,
        proof: 'CAP-DER-003.png',
        error: 'ANO-012 : le backend expose POST /derogations/:id/submit pour soumettre la dérogation, mais aucune action correspondante n’est disponible dans l’interface collaborateur.',
        comment: `derogationId=${derogationId1}. Écart UI produit : soumission réalisable uniquement par API.`,
        duration: Date.now() - start,
      }))
      console.log(`DER-003 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-003', priority: 'P1', scenario: 'Collaborateur soumet la dérogation', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== DER-004 — Responsable ne décide pas la dérogation =====
  {
    const start = Date.now()
    let page
    try {
      const before = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })

      let uiNoDerogation = false
      page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
      await page.waitForSelector('nav, aside', { timeout: 10000 }).catch(() => {})
      const rhLinkCount = await page.locator('a[href="/app/rh-derogations"]').count()
      const dirLinkCount = await page.locator('a[href="/app/director-derogations"]').count()
      uiNoDerogation = rhLinkCount === 0 && dirLinkCount === 0
      await capture(page, 'CAP-DER-004.png')

      const respDecide = await apiRequest(`/derogations/${derogationId1}/decision`, {
        method: 'PATCH',
        token: respToken,
        body: { decision: 'ACCORDER' },
      })
      const respManage = await apiRequest('/derogations/management', { token: respToken })
      const after = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })

      const unchanged = before.data?.status === after.data?.status &&
        after.data?.status === 'EN_ATTENTE_RH' &&
        after.data?.decidedByRhId === null

      const ok = uiNoDerogation &&
        respDecide.status === 403 &&
        respManage.status === 403 &&
        unchanged

      results.push(result({
        id: 'DER-004',
        priority: 'P2',
        scenario: 'Responsable ne décide pas la dérogation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI Responsable sans Dérogations=${uiNoDerogation} (liens RH=${rhLinkCount}, DIR=${dirLinkCount}) | PATCH decision HTTP=${respDecide.status} | GET management HTTP=${respManage.status} | statut ${before.data?.status}→${after.data?.status} (décidéPar=${after.data?.decidedByRhId})`,
        proof: 'CAP-DER-004.png',
        error: ok ? '' : 'Protection Responsable non conforme.',
        comment: `derogationId=${derogationId1}. Le contrôleur décisionnel est @Roles(RH, DIRECTEUR) ; le Responsable est exclu.`,
        duration: Date.now() - start,
      }))
      console.log(`DER-004 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-004', priority: 'P2', scenario: 'Responsable ne décide pas la dérogation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== DER-005 — RH accorde la dérogation (validation RH réelle via UI) =====
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
      await navigateViaSidebar(page, '/app/rh-derogations')
      await page.waitForSelector('.rh-derogations-row--body', { timeout: 15000 })
      await page.locator('.rh-derogations-row--body', { hasText: 'Motif modifié recette DER-002.' }).first().click()
      await page.waitForSelector('.rh-derogation-button--primary', { timeout: 10000 })

      const decidePromise = page.waitForResponse((resp) => {
        if (resp.request().method() !== 'PATCH') return false
        return /\/derogations\/\d+\/decision$/.test(new URL(resp.url()).pathname)
      }, { timeout: 15000 })

      await page.locator('.rh-derogation-button--primary', { hasText: 'Valider et transmettre au Directeur' }).click()
      const decideResp = await decidePromise
      const http = decideResp.status()
      await page.waitForTimeout(700)
      await capture(page, 'CAP-DER-005.png')

      const rhView = await apiRequest(`/derogations/management/${derogationId1}`, { token: rhToken })

      // Pas de double décision RH : une seconde validation RH est refusée (le relais final est le Directeur).
      const secondRhAttempt = await apiRequest(`/derogations/${derogationId1}/decision`, {
        method: 'PATCH',
        token: rhToken,
        body: { decision: 'ACCORDER', decisionComment: 'Seconde tentative RH - recette DER-005.' },
      })

      const ok = http === 200 &&
        rhView.status === 200 &&
        Number(rhView.data?.decidedByRhId) === Number(rhId) &&
        rhView.data?.workflowStatus === 'EN_ATTENTE_DIRECTEUR' &&
        secondRhAttempt.status === 403

      results.push(result({
        id: 'DER-005',
        priority: 'P2',
        scenario: 'RH accorde la dérogation',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PATCH decision UI HTTP=${http} | statut technique=${rhView.data?.status} | workflow=${rhView.data?.workflowStatus} | acteur RH=${rhView.data?.decidedByRhId} (attendu ${rhId}) | 2e décision RH HTTP=${secondRhAttempt.status}`,
        proof: 'CAP-DER-005.png',
        error: ok ? '' : 'Validation RH non conforme.',
        comment: `derogationId=${derogationId1}. Erratum rôle/flux : l’« accord RH » est une pré-validation (EN_ATTENTE_DIRECTEUR) ; la décision finale ACCORDEE relève du Directeur (précondition DER-006).`,
        duration: Date.now() - start,
      }))
      console.log(`DER-005 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-005', priority: 'P2', scenario: 'RH accorde la dérogation', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  // ===== DER-006 — La dérogation accordée est consommée =====
  {
    const start = Date.now()
    try {
      // Décision finale réelle : Directeur (précondition pour obtenir ACCORDEE).
      const dirDecision = await apiRequest(`/derogations/${derogationId1}/decision`, {
        method: 'PATCH',
        token: dirToken,
        body: { decision: 'ACCORDER', decisionComment: 'Décision finale Directeur - recette DER-006.' },
      })

      const beforeDerogation = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })
      const beforeRequest = await apiRequest(`/leave-requests/${requestId1}`, { token: colAToken })

      // Règle réelle inspectée dans leave-requests.service.ts submit() :
      // si !notice.isNoticeCompliant → derogationsService.consumeGrantedDerogation()
      // exige une dérogation ACCORDEE correspondant exactement à la demande,
      // puis la passe en UTILISEE avec usedAt.
      const submit = await apiRequest(`/leave-requests/${requestId1}/submit`, {
        method: 'POST',
        token: colAToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })

      const afterDerogation = await apiRequest(`/derogations/my/${derogationId1}`, { token: colAToken })
      const afterRequest = await apiRequest(`/leave-requests/${requestId1}`, { token: colAToken })

      // Utilisation unique : une seconde soumission doit échouer (la demande n'est plus un brouillon).
      const secondSubmit = await apiRequest(`/leave-requests/${requestId1}/submit`, {
        method: 'POST',
        token: colAToken,
        body: { signatureType: 'INITIALS', signatureData: 'DR' },
      })

      const my = await apiRequest('/derogations/my', { token: colAToken })
      const myList = Array.isArray(my.data) ? my.data : []
      const duplicateCount = myList.filter((d) => Number(d.leaveRequestId) === Number(requestId1)).length

      const ok = dirDecision.status === 200 &&
        dirDecision.data?.status === 'ACCORDEE' &&
        beforeDerogation.data?.status === 'ACCORDEE' &&
        beforeDerogation.data?.usedAt === null &&
        beforeRequest.data?.status === 'BROUILLON' &&
        submit.status === 200 &&
        afterDerogation.data?.status === 'UTILISEE' &&
        afterDerogation.data?.usedAt !== null &&
        Number(afterDerogation.data?.leaveRequestId) === Number(requestId1) &&
        afterRequest.data?.status === 'EN_ATTENTE_VALIDATION' &&
        secondSubmit.status === 400 &&
        duplicateCount === 1

      results.push(result({
        id: 'DER-006',
        priority: 'P2',
        scenario: 'La dérogation accordée est consommée',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `Directeur ACCORDER HTTP=${dirDecision.status}→${dirDecision.data?.status} | consommation : dérogation ${beforeDerogation.data?.status}→${afterDerogation.data?.status} (usedAt=${afterDerogation.data?.usedAt ? 'défini' : 'null'}) | demande ${beforeRequest.data?.status}→${afterRequest.data?.status} | 2e soumission HTTP=${secondSubmit.status} | dérogations liées=${duplicateCount}`,
        proof: '',
        error: ok ? '' : 'Consommation de la dérogation non conforme.',
        comment: `derogationId=${derogationId1}, requestId=${requestId1}. Action déclenchante réelle = POST /leave-requests/:id/submit d’une demande hors délai avec dérogation ACCORDEE.`,
        duration: Date.now() - start,
      }))
      console.log(`DER-006 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-006', priority: 'P2', scenario: 'La dérogation accordée est consommée', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== DER-007 — Collaborateur annule la demande dérogatoire avant décision =====
  {
    const start = Date.now()
    let page
    try {
      const window2 = pickDerogationWindow(8)
      const draft2 = await apiRequest('/leave-requests', {
        method: 'POST',
        token: colAToken,
        body: { leaveTypeId, startDate: window2.start, endDate: window2.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const requestId2 = draft2.data?.id

      const create = await apiRequest('/derogations', {
        method: 'POST',
        token: colAToken,
        body: { leaveRequestId: requestId2, reason: 'Motif dérogation DER-007.' },
      })
      const derogationId2 = create.data?.id
      const submit = await apiRequest(`/derogations/${derogationId2}/submit`, {
        method: 'POST',
        token: colAToken,
      })
      const before = await apiRequest(`/derogations/my/${derogationId2}`, { token: colAToken })

      // Annulation avant décision : l'UI ne propose pas d'annulation de dérogation,
      // la règle produit réelle est DELETE /derogations/:id (suppression du brouillon EN_ATTENTE_RH).
      const cancel = await apiRequest(`/derogations/${derogationId2}`, {
        method: 'DELETE',
        token: colAToken,
      })
      const afterGet = await apiRequest(`/derogations/my/${derogationId2}`, { token: colAToken })
      const requestAfter = await apiRequest(`/leave-requests/${requestId2}`, { token: colAToken })

      page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
      await navigateViaSidebar(page, '/app/my-requests')
      await openDraftCard(page, frenchRange(window2.start, window2.end))
      await page.waitForSelector('.nr-recap__derogation-cta', { timeout: 15000 })
      await page.waitForTimeout(300)
      await capture(page, 'CAP-DER-007.png')

      const ok = create.status === 201 &&
        submit.status === 200 &&
        before.data?.status === 'EN_ATTENTE_RH' &&
        before.data?.decidedByRhId === null &&
        cancel.status === 204 &&
        afterGet.status === 404 &&
        requestAfter.data?.status === 'BROUILLON'

      results.push(result({
        id: 'DER-007',
        priority: 'P1',
        scenario: 'Collaborateur annule la demande dérogatoire avant décision',
        type: 'B - API',
        status: STATUS.NON_CONFORME,
        resultText: `create HTTP=${create.status} | submit HTTP=${submit.status} | avant annulation statut=${before.data?.status} décidéPar=${before.data?.decidedByRhId} | DELETE HTTP=${cancel.status} | GET après=${afterGet.status} | demande liée=${requestAfter.data?.status} | consommation=aucune`,
        proof: 'CAP-DER-007.png',
        error: 'ANO-012 : le backend expose DELETE /derogations/:id pour annuler avant décision, mais aucune action correspondante n’est disponible dans l’interface collaborateur.',
        comment: `derogationId=${derogationId2}, requestId=${requestId2}. Écart UI produit : annulation avant décision réalisable uniquement par API.`,
        duration: Date.now() - start,
      }))
      console.log(`DER-007 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'DER-007', priority: 'P1', scenario: 'Collaborateur annule la demande dérogatoire avant décision', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-der' })
  console.log('DER-001..007 terminés')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
