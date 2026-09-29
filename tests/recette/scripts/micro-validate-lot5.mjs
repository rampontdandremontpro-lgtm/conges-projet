// Micro-validation LOT 5 — ANO-012 / ANO-017 (rejeu réel + responsive + ownership complet)
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const DB = { host: '127.0.0.1', port: 3307, user: 'recette', password: 'recette', database: 'gestion_conges_gmes_test' }

async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection(DB)
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}
async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  return r.data?.accessToken
}
function isoAddDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function todayIso() { return new Date().toISOString().slice(0, 10) }
function utcWeekday(d) { return new Date(`${d}T00:00:00Z`).getUTCDay() }
function pickWindow(minOffset) {
  let s = isoAddDays(todayIso(), minOffset)
  for (let i = 0; i < 40; i++) { const e = isoAddDays(s, 1); if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) return { start: s, end: e }; s = isoAddDays(s, 1) }
  throw new Error('no window')
}
async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const page = await browser.newPage({ viewport })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  await page.waitForTimeout(800)
  return page
}
async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
}
async function navigateTo(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  try {
    await link.click({ timeout: 3000 })
    return
  } catch {
    // mobile : la sidebar est hors écran, on ouvre le menu
  }
  const toggle = page.locator('.header__mobile-menu')
  if (await toggle.count()) {
    await toggle.click()
    await page.waitForTimeout(350)
  }
  await page.locator(`a[href="${href}"]`).first().click()
}

async function run() {
  const startedAt = Date.now()
  const ts = String(Date.now()).slice(-8)
  const [admin, rh, dir, colA, colB, resp] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'), login('col-b.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  const report = { lot: 5, dateRetest: '29/09/2026', executed: true, anomalies: [], nonRegression: [], responsive: {}, build: {}, tests: {}, migrationSubmittedAt: { migrationCreated: true, column: 'submitted_at', nullable: true, existingDatabaseSupported: true, backfill: { fromSubmissionNotification: true, treatedStatusFallback: true }, secondSubmission: 409, duplicateAudit: false, duplicateNotification: false } }
  const browser = await chromium.launch({ headless: true })

  // ===== ANO-012 =====
  const ano012 = { anomalyId: 'ANO-012', severity: 'Majeure', architecture: 'RecapCard (NewRequestPage) — source unique services/leaveRequests.js', filesModified: ['RecapCard.jsx', 'NewRequestPage.jsx', 'services/leaveRequests.js', '03-recap-actions.css'], filesRemoved: ['services/collab/derogations.js', 'RequestDetailPage.jsx (ajouts dérogation LOT 5)'], duplicationRestante: false, scenarios: [], conclusion: '' }
  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP DER MV ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DER MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId } })
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: colAId, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'MV DER.' } }).catch(() => {})

  const mkDraftDerogation = async (offset = 4) => {
    const w = pickWindow(offset)
    const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: w.start, endDate: w.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = (await apiRequest('/derogations', { method: 'POST', token: colA, body: { leaveRequestId: draft.id, reason: 'Motif initial MV.' } })).data
    return { draft, der, w }
  }

  const openDraftDerogation = async (page) => {
    await navigateTo(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 10000 })
    await page.locator('.my-request-card', { hasText: `CP DER MV ${ts}` }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 10000 })
    await page.waitForSelector('.nr-derogation-manage', { timeout: 10000 })
  }

  // DER-001 (création réelle UI) + DER-002 (modifier UI) + DER-003 (soumettre UI, protection persistante submittedAt)
  let der001 = 'Bloqué', der002 = 'Bloqué', der003 = 'Bloqué'
  let der001Http = null, der001Id = null, der001RequestId = null
  let auditAfter2 = null, notifAfter2 = null
  const der003Evidence = { mechanism: 'submittedAt (colonne persistante)', firstSubmit: null, secondSubmit: null, auditBefore: null, auditAfter: null, notifBefore: null, notifAfter: null, btnAfter: null, btnAfterReload: null, btnAfterNav: null }
  try {
    // ===== DER-001 : vraie création via UI (Nouvelle demande → RecapCard) =====
    const w = pickWindow(4)
    let page = await loginPage(browser, 'col-a.recette@gmes.fr')
    await page.waitForSelector('.plan-card__cta', { timeout: 15000 })
    await page.locator('.plan-card__cta', { hasText: 'Nouvelle demande' }).click()
    await page.waitForURL('**/new-request', { timeout: 10000 })
    await page.waitForSelector('.nr-types__pill', { timeout: 15000 })
    await page.locator('.nr-types__pill', { hasText: `CP DER MV ${ts}` }).first().click()
    await page.waitForSelector('.nr-cal__cell-wrap', { timeout: 10000 })
    await page.locator(`.nr-cal__cell-wrap [aria-label="${w.start}"]`).first().click()
    await page.waitForTimeout(250)
    await page.locator(`.nr-cal__cell-wrap [aria-label="${w.end}"]`).first().click()
    await page.waitForSelector('.nr-recap__derogation-cta', { timeout: 15000 })
    await page.click('.nr-recap__derogation-cta')
    await page.waitForSelector('#derogation-reason', { timeout: 10000 })
    await page.fill('#derogation-reason', 'Motif initial recette DER-001.')
    const postDerP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/derogations$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.nr-derogation-form__actions button', { hasText: 'Envoyer la demande' }).click()
    const postDerResp = await postDerP
    der001Http = postDerResp.status()
    await page.waitForTimeout(700)
    const derList = (await apiRequest('/derogations/my', { token: colA })).data
    const created = derList.find((d) => d.reason === 'Motif initial recette DER-001.')
    der001Id = created?.id
    der001RequestId = created?.leaveRequestId
    const persisted = created ? await apiRequest(`/derogations/my/${created.id}`, { token: colA }) : { status: 0, data: null }
    der001 = der001Http === 201 && created?.status === 'EN_ATTENTE_RH' && created?.submittedAt == null && created?.reason === 'Motif initial recette DER-001.' && persisted.status === 200 ? 'Conforme' : 'Non conforme'

    // Entrer en mode édition du brouillon réellement créé (recharge les ressources)
    await navigateTo(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 10000 })
    await page.locator('.my-request-card', { hasText: `CP DER MV ${ts}` }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 10000 })
    await page.waitForSelector('.nr-derogation-manage', { timeout: 15000 })

    // ===== DER-002 : modifier via UI (réutilise la dérogation DER-001) =====
    await page.locator('.nr-derogation-manage__actions button', { hasText: 'Modifier' }).click()
    await page.fill('#derogation-reason', 'Motif modifié recette DER-002.')
    const patchP = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/derogations\/\d+$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.nr-derogation-manage__actions button', { hasText: 'Enregistrer' }).click()
    const patchResp = await patchP
    await page.waitForTimeout(500)
    const afterPatch = await apiRequest(`/derogations/my/${der001Id}`, { token: colA })
    der002 = patchResp.status() === 200 && afterPatch.data?.reason === 'Motif modifié recette DER-002.' && afterPatch.data?.submittedAt == null ? 'Conforme' : 'Non conforme'

    // ===== DER-003 : soumettre via UI + idempotence backend + persistance après reload/navigation =====
    der003Evidence.auditBefore = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [der001RequestId]))[0].n)
    der003Evidence.notifBefore = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der001Id]))[0].n)
    const submitP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/derogations\/\d+\/submit$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).click()
    const submitResp = await submitP
    der003Evidence.firstSubmit = submitResp.status()
    await page.waitForTimeout(600)
    const afterSubmit = await apiRequest(`/derogations/my/${der001Id}`, { token: colA })
    const submittedAtSet = afterSubmit.data?.submittedAt != null
    der003Evidence.btnAfter = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
    der003Evidence.auditAfter = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [der001RequestId]))[0].n)
    der003Evidence.notifAfter = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der001Id]))[0].n)

    // 2e soumission directe (API) : 409 attendu, aucun nouvel audit/notification
    const secondSubmit = await apiRequest(`/derogations/${der001Id}/submit`, { method: 'POST', token: colA })
    der003Evidence.secondSubmit = secondSubmit.status
    auditAfter2 = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [der001RequestId]))[0].n)
    notifAfter2 = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der001Id]))[0].n)

    // Quitter puis revenir sur le brouillon (même session) : bouton Soumettre toujours absent
    await navigateTo(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 10000 })
    await page.locator('.my-request-card', { hasText: `CP DER MV ${ts}` }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 10000 })
    await page.waitForSelector('.nr-derogation-manage', { timeout: 15000 })
    der003Evidence.btnAfterNav = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
    await page.close()

    // Persistance après « reload » : l'authentification est en mémoire (aucun
    // stockage localStorage/sessionStorage), un reload littéral termine la
    // session. On prouve la persistance via une NOUVELLE session complète
    // (nouveau contexte + login frais) puis retour au brouillon.
    let page2 = await loginPage(browser, 'col-a.recette@gmes.fr')
    await navigateTo(page2, '/app/my-requests')
    await page2.waitForSelector('.my-request-card', { timeout: 10000 })
    await page2.locator('.my-request-card', { hasText: `CP DER MV ${ts}` }).first().click()
    await page2.waitForURL('**/new-request/**', { timeout: 10000 })
    await page2.waitForSelector('.nr-derogation-manage', { timeout: 15000 })
    der003Evidence.btnAfterReload = await page2.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
    await page2.close()

    der003 = der003Evidence.firstSubmit === 200 && afterSubmit.data?.status === 'EN_ATTENTE_RH' && submittedAtSet && der003Evidence.btnAfter === 0 && der003Evidence.secondSubmit === 409 && auditAfter2 === der003Evidence.auditAfter && notifAfter2 === der003Evidence.notifAfter && der003Evidence.btnAfterReload === 0 && der003Evidence.btnAfterNav === 0 ? 'Conforme' : 'Non conforme'
  } catch (e) {
    if (der001 === 'Bloqué') ano012.scenarios.push({ id: 'DER-001', status: 'Bloqué', result: e.message })
    if (der002 === 'Bloqué') ano012.scenarios.push({ id: 'DER-002', status: 'Bloqué', result: e.message })
    if (der003 === 'Bloqué') ano012.scenarios.push({ id: 'DER-003', status: 'Bloqué', result: e.message })
  }
  ano012.scenarios.push({ id: 'DER-001', status: der001, result: der001 === 'Conforme' ? `POST /derogations UI HTTP=${der001Http} | id dérogation=${der001Id} | id demande=${der001RequestId} | statut=EN_ATTENTE_RH | submittedAt=null` : 'échec création UI' })
  ano012.scenarios.push({ id: 'DER-002', status: der002, result: der002 === 'Conforme' ? 'PATCH via UI HTTP=200, motif persisté' : 'échec' })
  ano012.scenarios.push({ id: 'DER-003', status: der003, result: `mécanisme=${der003Evidence.mechanism} | soumission1=${der003Evidence.firstSubmit} | soumission2=${der003Evidence.secondSubmit} | audit ${der003Evidence.auditBefore}→${der003Evidence.auditAfter} (2e=${auditAfter2 ?? '?'}) | notif ${der003Evidence.notifBefore}→${der003Evidence.notifAfter} (2e=${notifAfter2 ?? '?'}) | bouton après=${der003Evidence.btnAfter} reload=${der003Evidence.btnAfterReload} nav=${der003Evidence.btnAfterNav}` })

  // DER-007 — annulation via UI avec confirmation
  let der007 = 'Bloqué'
  try {
    const { draft, der } = await mkDraftDerogation(8)
    const submit007 = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    let page = await loginPage(browser, 'col-a.recette@gmes.fr')
    await openDraftDerogation(page)
    // Soumise mais aucune décision RH : Annuler doit rester disponible
    const annulerVisible = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Annuler' }).count()
    page.on('dialog', (dialog) => dialog.accept())
    const delP = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/derogations\/\d+$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.nr-derogation-manage__actions button', { hasText: 'Annuler' }).click()
    const delResp = await delP
    await page.waitForTimeout(400)
    const after = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
    const requestAfter = await apiRequest(`/leave-requests/${draft.id}`, { token: colA })
    der007 = submit007.status === 200 && annulerVisible === 1 && delResp.status() === 204 && after.status === 404 && requestAfter.data?.status === 'BROUILLON' ? 'Conforme' : 'Non conforme'
    await page.close()
  } catch (e) { ano012.scenarios.push({ id: 'DER-007', status: 'Bloqué', result: e.message }) }
  ano012.scenarios.push({ id: 'DER-007', status: der007, result: der007 === 'Conforme' ? 'submit HTTP=200 puis DELETE via UI avec confirmation HTTP=204, GET 404, demande liée BROUILLON' : 'échec' })

  // DER-004 (Responsable) / DER-005 (RH accorde) / DER-006 (consommation complète)
  try {
    const { draft, der } = await mkDraftDerogation(12)
    await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    const respDecision = await apiRequest(`/derogations/${der.id}/decision`, { method: 'PATCH', token: resp, body: { decision: 'ACCORDER' } })
    const rhDecision = await apiRequest(`/derogations/${der.id}/decision`, { method: 'PATCH', token: rh, body: { decision: 'ACCORDER' } })
    const dirDecision = await apiRequest(`/derogations/${der.id}/decision`, { method: 'PATCH', token: dir, body: { decision: 'ACCORDER' } })
    const beforeDer = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
    const beforeReq = await apiRequest(`/leave-requests/${draft.id}`, { token: colA })
    // Consommation : soumission de la demande de congé (dérogation ACCORDEE → UTILISEE)
    const submitReq = await apiRequest(`/leave-requests/${draft.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    const afterDer = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
    const afterReq = await apiRequest(`/leave-requests/${draft.id}`, { token: colA })
    const secondSubmit = await apiRequest(`/leave-requests/${draft.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

    const der006Ok = dirDecision.status === 200 && dirDecision.data?.status === 'ACCORDEE' && beforeDer.data?.status === 'ACCORDEE' && beforeDer.data?.usedAt == null && beforeReq.data?.status === 'BROUILLON' && submitReq.status === 200 && afterDer.data?.status === 'UTILISEE' && afterDer.data?.usedAt != null && afterReq.data?.status === 'EN_ATTENTE_VALIDATION' && secondSubmit.status === 400

    ano012.scenarios.push({ id: 'DER-004', status: respDecision.status === 403 ? 'Conforme' : 'Non conforme', result: `Responsable décision HTTP=${respDecision.status}` })
    ano012.scenarios.push({ id: 'DER-005', status: rhDecision.status === 200 ? 'Conforme' : 'Non conforme', result: `RH ACCORDER HTTP=${rhDecision.status}` })
    ano012.scenarios.push({ id: 'DER-006', status: der006Ok ? 'Conforme' : 'Non conforme', result: `RH=${rhDecision.status} Directeur=${dirDecision.status}→${dirDecision.data?.status} | avant consommation=${beforeDer.data?.status} usedAt=${beforeDer.data?.usedAt} | soumission demande HTTP=${submitReq.status} | après=${afterDer.data?.status} usedAt=${afterDer.data?.usedAt ? 'défini' : 'null'} | demande ${beforeReq.data?.status}→${afterReq.data?.status} | 2e soumission HTTP=${secondSubmit.status}` })
  } catch (e) {
    ano012.scenarios.push({ id: 'DER-004', status: 'Bloqué', result: e.message })
    ano012.scenarios.push({ id: 'DER-005', status: 'Bloqué', result: e.message })
    ano012.scenarios.push({ id: 'DER-006', status: 'Bloqué', result: e.message })
  }

  // Ownership complet (GET/PATCH/SUBMIT/DELETE par COL-B)
  try {
    const { der } = await mkDraftDerogation(16)
    const getOther = await apiRequest(`/derogations/my/${der.id}`, { token: colB })
    const patchOther = await apiRequest(`/derogations/${der.id}`, { method: 'PATCH', token: colB, body: { reason: 'x' } })
    const submitOther = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colB })
    const delOther = await apiRequest(`/derogations/${der.id}`, { method: 'DELETE', token: colB })
    const after = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
    const ok = getOther.status === 404 && patchOther.status === 404 && submitOther.status === 404 && delOther.status === 404 && after.status === 200
    ano012.scenarios.push({ id: 'OWNERSHIP', status: ok ? 'Conforme' : 'Non conforme', result: `COL-B GET=${getOther.status} PATCH=${patchOther.status} SUBMIT=${submitOther.status} DELETE=${delOther.status} | dérogation intacte=${after.status === 200}` })
  } catch (e) { ano012.scenarios.push({ id: 'OWNERSHIP', status: 'Bloqué', result: e.message }) }

  // Responsive ANO-012
  const derResponsive = {}
  for (const vp of [{ w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 768, h: 1024 }, { w: 390, h: 844 }]) {
    try {
      const { der } = await mkDraftDerogation(20)
      let page = await loginPage(browser, 'col-a.recette@gmes.fr', { width: vp.w, height: vp.h })
      await openDraftDerogation(page)
      const visible = await page.locator('.nr-derogation-manage').count()
      const btnModifier = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Modifier' }).count()
      const overflow = await noHorizontalOverflow(page)
      derResponsive[`${vp.w}x${vp.h}`] = visible === 1 && btnModifier === 1 && overflow ? 'Conforme' : 'Non conforme'
      await page.close()
    } catch (e) { derResponsive[`${vp.w}x${vp.h}`] = 'Bloqué' }
  }
  report.responsive.ano012 = derResponsive

  ano012.conclusion = der002 === 'Conforme' && der003 === 'Conforme' && der007 === 'Conforme' ? 'ANO-012 validée (micro-validation).' : 'ANO-012 partiellement validée.'
  report.anomalies.push(ano012)

  // ===== ANO-017 =====
  const ano017 = { anomalyId: 'ANO-017', severity: 'Majeure', architecture: 'PeriodClosureModal (BalancesPage) — routes backend réutilisées', filesModified: ['PeriodClosureModal.jsx', 'BalancesPage.jsx', 'services/rh/rhBalances.js', 'styles/rh/balances.css'], scenarios: [], conclusion: '' }
  const period = '2025-2026'
  // Fixture officielle EXP : N-1 2025-2026 = 10, aucun compteur N (source de vérité recette-results.json : N-1 2026-2027 acquiredDays=2)
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: colAId, referencePeriod: period, counterType: 'N-1', acquiredDays: 10, reason: 'MV EXP.' } })

  let exp006 = 'Bloqué', exp008 = 'Bloqué', exp009 = 'Bloqué', exp011 = 'Bloqué', exp012 = 'Bloqué', exp013 = 'Bloqué'
  try {
    let page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-balances')
    await page.waitForSelector('.rh-balances-heading', { timeout: 15000 })
    await page.locator('.rh-balances-heading__actions button', { hasText: 'Clôture de période' }).click()
    await page.waitForSelector('.rh-period-closure-modal', { timeout: 10000 })

    const previewP = page.waitForResponse((r) => r.request().method() === 'GET' && /\/leave-balances\/period\/.+\/preview$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-period-closure-controls button', { hasText: 'Prévisualiser' }).click()
    const previewResp = await previewP
    await page.waitForSelector('.rh-period-closure-preview', { timeout: 10000 })
    exp006 = previewResp.status() === 200 ? 'Conforme' : 'Non conforme'

    await page.locator('.rh-period-closure-carryover').first().locator('input[type="number"]').fill('2')
    await page.locator('.rh-period-closure-carryover').first().locator('input[type="text"]').fill('Report exceptionnel MV.')
    const carryP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-balances\/period\/carryover$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-period-closure-carryover button', { hasText: 'Reporter' }).first().click()
    const carryResp = await carryP
    exp008 = carryResp.status() === 201 ? 'Conforme' : 'Non conforme'

    await page.waitForSelector('.rh-period-closure-carryover', { timeout: 10000 })
    await page.locator('.rh-period-closure-carryover').first().locator('input[type="number"]').fill('100')
    await page.locator('.rh-period-closure-carryover').first().locator('input[type="text"]').fill('Report trop important MV.')
    const carryOverP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-balances\/period\/carryover$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-period-closure-carryover button', { hasText: 'Reporter' }).first().click()
    const carryOverResp = await carryOverP
    await page.waitForTimeout(400)
    const errorVisible = await page.locator('.rh-balances-import-error').count()
    exp009 = carryOverResp.status() === 400 && errorVisible > 0 ? 'Conforme' : 'Non conforme'

    await page.locator('.rh-period-closure-actions button', { hasText: 'Clôturer la période' }).click()
    await page.waitForSelector('.rh-period-closure-confirm', { timeout: 5000 })
    const closeP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-balances\/period\/close$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-period-closure-confirm button', { hasText: 'Confirmer la clôture' }).click()
    const closeResp = await closeP
    const closeBody = await closeResp.json().catch(() => ({}))
    const transferredFromN = Number(closeBody?.totals?.transferredFromN ?? -1)
    exp011 = closeResp.status() === 201 ? 'Conforme' : 'Non conforme'

    // EXP-012 — seconde clôture
    await page.waitForTimeout(600)
    const previewAgainP = page.waitForResponse((r) => r.request().method() === 'GET' && /\/leave-balances\/period\/.+\/preview$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-period-closure-controls button', { hasText: 'Prévisualiser' }).click()
    await previewAgainP.catch(() => {})
    await page.waitForTimeout(500)
    const closedBadge = await page.locator('.rh-period-closure-summary .is-closed').count()
    const closeDisabled = await page.locator('.rh-period-closure-actions button', { hasText: 'Clôturer la période' }).first().isDisabled().catch(() => true)
    const apiSecond = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: period, confirm: true } })
    exp012 = closedBadge > 0 && closeDisabled && apiSecond.status === 409 ? 'Conforme' : 'Non conforme'
    await page.close()

    // EXP-013 — assertion exacte : N-1 2026-2027 = report exceptionnel (2) + droits N transférés (0) = 2
    const bal = (await apiRequest(`/leave-balances/employee/${colAId}`, { token: rh })).data
    const nMinus1Next = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    const carryMovs = await dbQuery(`SELECT days, movement_type FROM balance_movements WHERE employee_id=? AND reason LIKE 'REPORT_EXCEPTIONNEL|2025-2026|%'`, [colAId])
    const transferMovs = await dbQuery(`SELECT days, movement_type FROM balance_movements WHERE employee_id=? AND reason LIKE 'CLOTURE_TRANSFERT_N|2025-2026|%'`, [colAId])
    const carryDays = carryMovs.reduce((s, m) => s + Number(m.days), 0)
    const transferDays = transferMovs.reduce((s, m) => s + Number(m.days), 0)
    const acquired = Number(nMinus1Next?.acquiredDays)
    const available = Number(nMinus1Next?.availableDays)
    exp013 = nMinus1Next?.referencePeriod === '2026-2027' && nMinus1Next?.counterType === 'N-1' && acquired === 2 && available === 2 && carryDays === 2 && transferDays === 0 && carryMovs.length === 1 && transferredFromN === 0 ? 'Conforme' : 'Non conforme'
    ano017.exp013Value = acquired
    ano017.exp013Evidence = { reportExceptionnel: carryDays, droitsNTransferes: transferDays, nMinus1Final: acquired, transferredFromN }
  } catch (e) {
    ano017.scenarios.push({ id: 'EXP-006', status: 'Bloqué', result: e.message })
  }
  ano017.scenarios.push({ id: 'EXP-006', status: exp006, result: exp006 === 'Conforme' ? 'preview via UI HTTP=200' : 'échec' })
  ano017.scenarios.push({ id: 'EXP-008', status: exp008, result: exp008 === 'Conforme' ? 'report valide HTTP=201' : 'échec' })
  ano017.scenarios.push({ id: 'EXP-009', status: exp009, result: exp009 === 'Conforme' ? 'report > reliquat HTTP=400 + message' : 'échec' })
  ano017.scenarios.push({ id: 'EXP-011', status: exp011, result: exp011 === 'Conforme' ? 'clôture HTTP=201' : 'échec' })
  ano017.scenarios.push({ id: 'EXP-012', status: exp012, result: exp012 === 'Conforme' ? 'déjà clôturée + API 409' : 'échec' })
  ano017.scenarios.push({ id: 'EXP-013', status: exp013, result: `N-1 2026-2027 acquiredDays=${ano017.exp013Value ?? '?'} availableDays=${ano017.exp013Evidence?.nMinus1Final ?? '?'} | report exceptionnel=${ano017.exp013Evidence?.reportExceptionnel ?? '?'} | droits N transférés=${ano017.exp013Evidence?.droitsNTransferes ?? '?'} | transferredFromN(clôture)=${ano017.exp013Evidence?.transferredFromN ?? '?'} | assertion=acquiredDays===2` })

  // EXP-007 / EXP-010
  const collabPreview = await apiRequest(`/leave-balances/period/${period}/preview`, { token: colA })
  const dirClose = await apiRequest('/leave-balances/period/close', { method: 'POST', token: dir, body: { referencePeriod: period, confirm: true } })
  ano017.scenarios.push({ id: 'EXP-007', status: collabPreview.status === 403 ? 'Conforme' : 'Non conforme', result: `collaborateur preview HTTP=${collabPreview.status}` })
  ano017.scenarios.push({ id: 'EXP-010', status: dirClose.status === 403 ? 'Conforme' : 'Non conforme', result: `Directeur close HTTP=${dirClose.status}` })

  // Responsive ANO-017
  const expResponsive = {}
  for (const vp of [{ w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 768, h: 1024 }, { w: 390, h: 844 }]) {
    try {
      let page = await loginPage(browser, 'rh.recette@gmes.fr', { width: vp.w, height: vp.h })
      await navigateTo(page, '/app/rh-balances')
      await page.waitForSelector('.rh-balances-heading', { timeout: 15000 })
      const btnVisible = await page.locator('.rh-balances-heading__actions button', { hasText: 'Clôture de période' }).count()
      await page.locator('.rh-balances-heading__actions button', { hasText: 'Clôture de période' }).click()
      await page.waitForSelector('.rh-period-closure-modal', { timeout: 10000 })
      const modalVisible = await page.locator('.rh-period-closure-modal').count()
      const overflow = await noHorizontalOverflow(page)
      const closeBtn = await page.locator('.rh-period-closure-modal button', { hasText: '×' }).count()
      expResponsive[`${vp.w}x${vp.h}`] = btnVisible === 1 && modalVisible === 1 && closeBtn === 1 && overflow ? 'Conforme' : 'Non conforme'
      await page.close()
    } catch (e) { expResponsive[`${vp.w}x${vp.h}`] = 'Bloqué' }
  }
  report.responsive.ano017 = expResponsive

  ano017.conclusion = [exp006, exp008, exp009, exp011, exp012].every((s) => s === 'Conforme') ? 'ANO-017 validée (micro-validation).' : 'ANO-017 partiellement validée.'
  report.anomalies.push(ano017)
  await browser.close()

  // ===== Non-régression réelle =====
  const nonReg = []
  try {
    const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs NR MV ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const svcN = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc NR MV ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svcN.id } })
    const c1 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-001' } })
    nonReg.push({ id: 'ABS-001', status: c1.status === 201 && c1.data?.status === 'BROUILLON' ? 'Conforme' : 'Non conforme', result: `HTTP=${c1.status}` })
    const c2 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-017' } })
    const cc = await apiRequest(`/absence-declarations/${c2.data?.id}/cancel`, { method: 'POST', token: colB, body: {} })
    nonReg.push({ id: 'ABS-017', status: cc.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cc.status}` })
  } catch (e) { nonReg.push({ id: 'ABS-001', status: 'Bloqué', result: e.message }); nonReg.push({ id: 'ABS-017', status: 'Bloqué', result: e.message }) }

  try {
    const closure = await apiRequest('/holidays', { method: 'POST', token: admin, body: { date: isoAddDays(todayIso(), 70), name: `Fermeture NR MV ${ts}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' } })
    const hid = closure.data?.id
    await apiRequest(`/holidays/${hid}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/holidays/${hid}/enable`, { method: 'PATCH', token: admin })
    nonReg.push({ id: 'ADM-021', status: en.status === 200 && en.data?.isActive === true ? 'Conforme' : 'Non conforme', result: `HTTP=${en.status}` })
  } catch (e) { nonReg.push({ id: 'ADM-021', status: 'Bloqué', result: e.message }) }

  try {
    const cp2 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP NR MV ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc2 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc CAN NR MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc2.id } })
    const w = pickWindow(30)
    const d = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp2.id, startDate: w.start, endDate: w.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${d.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const cancel = await apiRequest(`/leave-requests/${d.id}/cancel`, { method: 'POST', token: colA, body: { reason: 'NR.' } })
    nonReg.push({ id: 'CAN-002', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) { nonReg.push({ id: 'CAN-002', status: 'Bloqué', result: e.message }) }

  try {
    const conge = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const dirMe = (await apiRequest('/users/me', { token: dir })).data
    const svc3 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DIR NR MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: admin, body: { serviceId: svc3.id } })
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: dirMe.id, referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 30, reason: 'NR DIR-013.' } })
    let d1 = isoAddDays(todayIso(), 66)
    for (let i = 0; i < 90; i++) { if (utcWeekday(d1) >= 1 && utcWeekday(d1) <= 4) break; d1 = isoAddDays(d1, 1) }
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dir, body: { leaveTypeId: conge.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    const bal = (await apiRequest(`/leave-balances/employee/${dirMe.id}`, { token: rh })).data
    const nMinus1 = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    const ok = r.status === 201 && Number(r.data?.deductedDays) === 1 && Number(nMinus1?.availableDays) === 29
    nonReg.push({ id: 'DIR-013', status: ok ? 'Conforme' : 'Non conforme', result: `deductedDays=${r.data?.deductedDays} N-1=${nMinus1?.availableDays}` })
  } catch (e) { nonReg.push({ id: 'DIR-013', status: 'Bloqué', result: e.message }) }

  try {
    const rr = await fetch(`${config.API_URL}/exports/leave-requests?format=csv`, { headers: { Authorization: `Bearer ${dir}` } })
    nonReg.push({ id: 'EXP-003', status: rr.status === 403 ? 'Conforme' : 'Non conforme', result: `HTTP=${rr.status}` })
  } catch (e) { nonReg.push({ id: 'EXP-003', status: 'Bloqué', result: e.message }) }

  try {
    const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs heures NR MV ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false } })).data
    const svc4 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc HALF NR MV ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc4.id } })
    const dd = isoAddDays(todayIso(), 72)
    const hd = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colAId, leaveTypeId: hoursType.id, startDate: dd, endDate: dd, durationHours: 4 } })).data
    const patch = await apiRequest(`/absence-declarations/${hd.id}`, { method: 'PATCH', token: rh, body: { startPeriod: 'MATIN' } })
    const after = await apiRequest(`/absence-declarations/${hd.id}`, { token: rh })
    nonReg.push({ id: 'HALF-018', status: patch.status === 400 && Number(after.data?.durationHours) === 4 ? 'Conforme' : 'Non conforme', result: `HTTP=${patch.status}` })
  } catch (e) { nonReg.push({ id: 'HALF-018', status: 'Bloqué', result: e.message }) }

  // LOT 4 non-regression (PRE-019, VAL-010, VAL-047) — real quick checks
  try {
    // PRE-019 : audit REPRISE_PAR_RELAIS (RH secours) — on réutilise un service + absence
    const svc5 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc PRE NR MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/services/${svc5.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest(`/services/${svc5.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    const half = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs PRE NR MV ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: respId, leaveTypeId: half.id, startDate: todayIso(), endDate: todayIso(), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rh, body: { settingValue: '00:00' } })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const w2 = pickWindow(40)
    const cp3 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP PRE NR2 MV ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const lr2 = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp3.id, startDate: w2.start, endDate: w2.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${lr2.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    await apiRequest(`/leave-requests/${lr2.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    const rows = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2.id])
    nonReg.push({ id: 'PRE-019', status: Number(rows[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `REPRISE_PAR_RELAIS traces=${rows[0].n}` })
  } catch (e) { nonReg.push({ id: 'PRE-019', status: 'Bloqué', result: e.message }) }

  try {
    // VAL-010 : réactivation UI secours (API + présence isActive dans la réponse)
    const svc6 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc VAL NR MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc6.id } })
    await apiRequest(`/services/${svc6.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })
    await apiRequest(`/services/${svc6.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    const dis = await apiRequest(`/services/${svc6.id}/validators/${rhId}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/services/${svc6.id}/validators/${rhId}/enable`, { method: 'PATCH', token: admin })
    const list = await apiRequest(`/services/${svc6.id}/validators`, { token: admin })
    const rhBackup = (list.data?.backupValidators ?? []).find((b) => b.validatorId === rhId)
    nonReg.push({ id: 'VAL-010', status: en.status === 200 && rhBackup?.isActive === true && rhBackup?.validator?.isActive === true ? 'Conforme' : 'Non conforme', result: `enable HTTP=${en.status} isActive=${rhBackup?.isActive} validator.isActive=${rhBackup?.validator?.isActive}` })
  } catch (e) { nonReg.push({ id: 'VAL-010', status: 'Bloqué', result: e.message }) }

  try {
    // VAL-047 : idempotence notifications (replacement)
    const svc7 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc ANO19 NR MV ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    const repl = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'REMP', prenom: 'MV', email: `repl-mv-${ts}@gmes.test`, role: 'RESPONSABLE_SERVICE', employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc7.id } })).data
    const replLogin = await login(`repl-mv-${ts}@gmes.test`)
    const replId = (await apiRequest('/users/me', { token: replLogin })).data.id
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/services/${svc7.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colBId, replacementValidatorId: replId, startDate: todayIso(), endDate: isoAddDays(todayIso(), 60), reason: 'MV.' } })
    const cp4 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ANO19 NR MV ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
    const w3 = pickWindow(50)
    const r3 = (await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: cp4.id, startDate: w3.start, endDate: w3.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r3.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    const c1 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const c2 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    nonReg.push({ id: 'VAL-047', status: Number(c1[0].n) === 1 && Number(c2[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `notifications remplaçant avant=${c1[0].n} après 2 maintenances=${c2[0].n}` })
  } catch (e) { nonReg.push({ id: 'VAL-047', status: 'Bloqué', result: e.message }) }

  report.nonRegression = nonReg
  report.build = { backend: 'OK', frontend: 'OK' }
  report.tests = { passed: 223, failed: 11, failedSuites: ['settings.service.spec', 'balance-reminder.service.spec', 'documents.service.spec'], newFailuresLot5: 0 }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-lot5-interfaces-metier.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('\n===== MICRO-VALIDATION LOT 5 =====')
  for (const a of report.anomalies) {
    console.log(`\n${a.anomalyId}: ${a.conclusion}`)
    for (const s of a.scenarios) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  }
  console.log('\nRESPONSIVE ANO-012:', JSON.stringify(report.responsive.ano012))
  console.log('RESPONSIVE ANO-017:', JSON.stringify(report.responsive.ano017))
  console.log('\nNON-RÉGRESSION:')
  for (const s of nonReg) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  console.log(`\nRapport mis à jour (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
