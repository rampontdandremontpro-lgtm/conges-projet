// Retest LOT 4 — ANO-016 (audit reprise), ANO-018 (réactivation secours UI), ANO-019 (idempotence notifications)
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
function openDate(off) { let s = isoAddDays(todayIso(), off); for (let i = 0; i < 60; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }
function openNonFridayDate(off) { let s = isoAddDays(todayIso(), off); for (let i = 0; i < 90; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 4) return s; s = isoAddDays(s, 1) } return s }

function writeReport(payload) {
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-lot4-relais-validation.json'), JSON.stringify(payload, null, 2), 'utf8')
}

async function run() {
  const startedAt = Date.now()
  const ts = String(Date.now()).slice(-8)
  const [admin, rh, dir, resp, colA, colB] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('col-b.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const rhMe = (await apiRequest('/users/me', { token: rh })).data
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id

  const report = []

  // =====================================================================
  // ANO-016 — audit REPRISE_PAR_RELAIS sur la reprise (secours/relais)
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-016', severity: 'Majeure',
      cause: "saveDecisionAccessHistory n'enregistrait REPRISE_PAR_RELAIS que pour le kind 'RELAIS' (Directeur), pas pour 'SECOURS' (valideur de secours RH/Responsable qui reprend un premier niveau absent).",
      filesModified: ['backend/src/leave-requests/leave-requests.service.ts'],
      scenarios: [], nonRegressions: [], negativeControl: null, conclusion: '',
    }
    const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP PRE L4 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const half = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs PRE L4 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc PRE L4 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
    await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhMe.id } })

    // PRE-016 — absence Responsable
    const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: respId, leaveTypeId: half.id, startDate: todayIso(), endDate: todayIso(), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    anomaly.nonRegressions.push({ id: 'PRE-016', status: abs?.id ? 'Conforme' : 'Non conforme', result: `absence=${abs?.id}` })
    // PRE-017 — soumission absence
    const absSub = await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    anomaly.nonRegressions.push({ id: 'PRE-017', status: absSub.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${absSub.status}` })
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rh, body: { settingValue: '00:00' } })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const p = (await apiRequest(`/users/${respId}`, { token: rh })).data?.presenceStatus

    // PRE-018 — RH (secours) reprend quand Responsable ABSENT
    const s1 = openDate(40)
    const lr = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: s1, endDate: s1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${lr.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const v = await apiRequest(`/leave-requests/${lr.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    anomaly.nonRegressions.push({ id: 'PRE-018', status: v.status === 200 && p === 'ABSENT' ? 'Conforme' : 'Non conforme', result: `RESP=${p} HTTP=${v.status} status=${v.data?.status}` })

    // PRE-019 — audit REPRISE_PAR_RELAIS
    const rows = await dbQuery(`SELECT action, actor_id AS aid FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr.id])
    const trace = rows[0]
    const ok019 = trace && Number(trace.aid) === Number(rhMe.id)
    anomaly.scenarios.push({ id: 'PRE-019', status: ok019 ? 'Conforme' : 'Non conforme', result: `traces=${rows.length} actor=${trace?.aid} rh=${rhMe.id}`, http: v.status })

    // PRE-020 — annulation absence
    const cancel = await apiRequest(`/absence-declarations/${abs.id}/cancel`, { method: 'POST', token: rh, body: {} })
    anomaly.nonRegressions.push({ id: 'PRE-020', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })

    // Contrôle négatif — validation RH normale (RH_FINALISATION) sans reprise
    const s2 = openDate(44)
    const lr2 = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: s2, endDate: s2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${lr2.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    await apiRequest(`/leave-requests/${lr2.id}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'RE' } })
    const negBefore = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2.id])
    await apiRequest(`/leave-requests/${lr2.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
    const negAfter = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2.id])
    anomaly.negativeControl = { status: Number(negAfter[0].n) === 0 ? 'Conforme' : 'Non conforme', result: `validation RH normale → traces REPRISE_PAR_RELAIS=${negAfter[0].n}` }

    anomaly.conclusion = ok019 && anomaly.negativeControl.status === 'Conforme'
      ? 'ANO-016 corrigée : REPRISE_PAR_RELAIS tracée pour la reprise (secours), acteur correct, aucune trace pour la validation RH normale.'
      : 'ANO-016 partiellement corrigée.'
    report.push(anomaly)
  }

  // =====================================================================
  // ANO-018 — réactivation UI du valideur de secours
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-018', severity: 'Majeure',
      cause: "Le backend enableBackupValidator fonctionnait, mais la réponse getServiceValidators n'exposait pas validator.isActive : le bouton UI « Réactiver » était donc désactivé (disabled) pour les secours inactifs.",
      filesModified: ['backend/src/validators/validators.service.ts'],
      scenarios: [], conclusion: '',
    }
    const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc VAL L4 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
    await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })
    // deux secours : RH et DIRECTEUR
    await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhMe.id } })
    const dirMe = (await apiRequest('/users/me', { token: dir })).data
    await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: dirMe.id } })

    // VAL-009 — désactiver secours 1 (RH)
    const dis = await apiRequest(`/services/${svc.id}/validators/${rhMe.id}/disable`, { method: 'PATCH', token: admin })
    anomaly.nonRegressions = anomaly.nonRegressions ?? []
    anomaly.nonRegressions.push({ id: 'VAL-009', status: dis.status === 200 && dis.data?.isActive === false ? 'Conforme' : 'Non conforme', result: `HTTP=${dis.status} isActive=${dis.data?.isActive}` })

    // VAL-010 — réactivation UI (Playwright)
    let val010 = 'Bloqué'
    let val010Http = null
    try {
      const browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
      await page.fill('#login-email', 'admin.recette@gmes.fr')
      await page.fill('#login-password', 'RecetteGMES@2026!')
      await page.click('.login-submit')
      await page.waitForURL('**/app/**', { timeout: 10000 })
      await page.click('a[href="/app/admin-validators"]')
      await page.waitForSelector('.rh-validator-service-card', { timeout: 15000 })
      const card = page.locator('.rh-validator-service-card', { hasText: `Svc VAL L4 ${ts}` }).first()
      await card.locator('.rh-validator-service-card__summary').click()
      await page.waitForSelector('.rh-validator-backup-list', { timeout: 10000 })
      const btn = card.locator('button', { hasText: 'Réactiver' }).first()
      const btnPresent = await btn.count()
      const btnDisabled = btnPresent ? await btn.isDisabled() : null
      const enablePromise = page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && /\/services\/\d+\/validators\/\d+\/enable$/.test(new URL(r.url()).pathname),
        { timeout: 15000 },
      )
      await btn.click()
      const en = await enablePromise
      val010Http = en.status()
      await page.waitForTimeout(400)
      await page.close()
      await browser.close()
      const after = await apiRequest(`/services/${svc.id}/validators`, { token: admin })
      const backups = after.data?.backupValidators ?? []
      const rhBackup = backups.find((b) => b.validatorId === rhMe.id)
      const sameId = Number(rhBackup?.id) === Number(dis.data?.id)
      const ok = btnPresent === 1 && btnDisabled === false && val010Http === 200 && rhBackup?.isActive === true && sameId
      val010 = ok ? 'Conforme' : 'Non conforme'
      anomaly.scenarios.push({ id: 'VAL-010', status: val010, result: `UI bouton Réactiver présent=${btnPresent} enabled=${btnDisabled === false} | PATCH HTTP=${val010Http} | isActive=false→${rhBackup?.isActive} | même id=${sameId}`, http: val010Http })
    } catch (e) {
      anomaly.scenarios.push({ id: 'VAL-010', status: 'Bloqué', result: e.message })
    }

    // VAL-011 — deux secours exposés
    const list = await apiRequest(`/services/${svc.id}/validators`, { token: admin })
    const backups = list.data?.backupValidators ?? []
    anomaly.scenarios.push({ id: 'VAL-011', status: backups.length === 2 ? 'Conforme' : 'Non conforme', result: `backupValidators=${JSON.stringify(backups.map((b) => b.validatorId))}` })

    anomaly.conclusion = val010 === 'Conforme' && backups.length === 2
      ? 'ANO-018 corrigée : bouton Réactiver utilisable, même ressource réactivée (isActive=true), deux secours exposés sans doublon.'
      : 'ANO-018 partiellement corrigée.'
    report.push(anomaly)
  }

  // =====================================================================
  // ANO-019 — idempotence des notifications de soumission au remplaçant
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-019', severity: 'Majeure',
      cause: "La réévaluation de destinataires (maintenance) doit être idempotente : un second passage ne doit pas recréer la notification de soumission déjà envoyée au remplaçant.",
      filesModified: [],
      scenarios: [], conclusion: '',
    }
    const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc ANO19 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    const repl = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'REMPL', prenom: 'L4', email: `repl-l4-${ts}@gmes.test`, role: 'RESPONSABLE_SERVICE', employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc.id } })).data
    const replLogin = await login(`repl-l4-${ts}@gmes.test`)
    const replId = (await apiRequest('/users/me', { token: replLogin })).data.id
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
    await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colBId, replacementValidatorId: replId, startDate: todayIso(), endDate: isoAddDays(todayIso(), 60), reason: 'L4 idempotence.' } })
    const cp = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ANO19 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

    const countNotif = async (lrId) => {
      const r = await dbQuery(`SELECT user_id AS uid FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED'`, [lrId])
      return r.map((x) => Number(x.uid))
    }
    // r2
    const s = openDate(50)
    const r2 = (await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: cp.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r2.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    const pass1 = await countNotif(r2.id)
    const replP1 = pass1.filter((id) => id === replId).length
    const respP1 = pass1.filter((id) => id === respId).length
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const pass2 = await countNotif(r2.id)
    const replP2 = pass2.filter((id) => id === replId).length
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const pass3 = await countNotif(r2.id)
    const replP3 = pass3.filter((id) => id === replId).length
    const noDup = replP1 === 1 && replP2 === 1 && replP3 === 1 && respP1 === 0

    // demande distincte → nouvelle notification
    const s3 = openDate(55)
    const r3 = (await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: cp.id, startDate: s3, endDate: s3, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r3.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    const passDistinct = await countNotif(r3.id)
    const distinctNotified = passDistinct.filter((id) => id === replId).length === 1

    anomaly.scenarios.push({
      id: 'VAL-047', status: noDup && distinctNotified ? 'Conforme' : 'Non conforme',
      result: `passage1 remplaçant=${replP1} Responsable=${respP1} | passage2 remplaçant=${replP2} | passage3 remplaçant=${replP3} | demande distincte notifiée=${distinctNotified}`,
    })
    anomaly.conclusion = noDup && distinctNotified
      ? 'ANO-019 corrigée : idempotence de la réévaluation (aucun doublon), et nouvelle demande distincte toujours notifiée.'
      : 'ANO-019 partiellement corrigée.'
    report.push(anomaly)
  }

  // =====================================================================
  // Non-régression LOT 1 / 2 / 3
  // =====================================================================
  const nonReg = []
  try {
    const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs NR L4 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const svcN = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc NR L4 ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svcN.id } })
    const c1 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR L4 ABS-001` } })
    nonReg.push({ id: 'ABS-001', status: c1.status === 201 && c1.data?.status === 'BROUILLON' ? 'Conforme' : 'Non conforme', result: `HTTP=${c1.status}` })
    const c2 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR L4 ABS-017` } })
    const cc = await apiRequest(`/absence-declarations/${c2.data?.id}/cancel`, { method: 'POST', token: colB, body: {} })
    nonReg.push({ id: 'ABS-017', status: cc.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cc.status}` })
  } catch (e) { nonReg.push({ id: 'ABS-001', status: 'Bloqué', result: e.message }); nonReg.push({ id: 'ABS-017', status: 'Bloqué', result: e.message }) }

  try {
    const closure = await apiRequest('/holidays', { method: 'POST', token: admin, body: { date: isoAddDays(todayIso(), 70), name: `Fermeture NR L4 ${ts}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' } })
    const hid = closure.data?.id
    await apiRequest(`/holidays/${hid}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/holidays/${hid}/enable`, { method: 'PATCH', token: admin })
    nonReg.push({ id: 'ADM-021', status: en.status === 200 && en.data?.isActive === true ? 'Conforme' : 'Non conforme', result: `HTTP=${en.status}` })
  } catch (e) { nonReg.push({ id: 'ADM-021', status: 'Bloqué', result: e.message }) }

  try {
    const cp2 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP NR L4 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc2 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc CAN NR L4 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc2.id } })
    const s = openDate(60)
    const d = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp2.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${d.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const cancel = await apiRequest(`/leave-requests/${d.id}/cancel`, { method: 'POST', token: colA, body: { reason: 'NR L4.' } })
    nonReg.push({ id: 'CAN-002', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) { nonReg.push({ id: 'CAN-002', status: 'Bloqué', result: e.message }) }

  // LOT 3 : DIR-013 exact 1 jour
  try {
    const conge = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const dirMe = (await apiRequest('/users/me', { token: dir })).data
    const svc3 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DIR NR L4 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: admin, body: { serviceId: svc3.id } })
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: dirMe.id, referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 30, reason: 'NR L4 DIR-013.' } })
    const d1 = openNonFridayDate(66)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dir, body: { leaveTypeId: conge.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    const bal = (await apiRequest(`/leave-balances/employee/${dirMe.id}`, { token: rh })).data
    const nMinus1 = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    const ok = r.status === 201 && Number(r.data?.deductedDays) === 1 && Number(nMinus1?.availableDays) === 29
    nonReg.push({ id: 'DIR-013', status: ok ? 'Conforme' : 'Non conforme', result: `HTTP=${r.status} deductedDays=${r.data?.deductedDays} N-1=${nMinus1?.availableDays} (delta=${30 - Number(nMinus1?.availableDays)})` })
  } catch (e) { nonReg.push({ id: 'DIR-013', status: 'Bloqué', result: e.message }) }

  // LOT 3 : EXP-003 (Directeur export nominatif → 403)
  try {
    const r = await fetch(`${config.API_URL}/exports/leave-requests?format=csv`, { headers: { Authorization: `Bearer ${dir}` } })
    nonReg.push({ id: 'EXP-003', status: r.status === 403 ? 'Conforme' : 'Non conforme', result: `HTTP=${r.status}` })
  } catch (e) { nonReg.push({ id: 'EXP-003', status: 'Bloqué', result: e.message }) }

  // LOT 3 : HALF-018 (heures + startPeriod → 400)
  try {
    const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs heures NR L4 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false } })).data
    const svc4 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc HALF NR L4 ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc4.id } })
    const dd = openDate(70)
    const hd = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colAId, leaveTypeId: hoursType.id, startDate: dd, endDate: dd, durationHours: 4 } })).data
    const patch = await apiRequest(`/absence-declarations/${hd.id}`, { method: 'PATCH', token: rh, body: { startPeriod: 'MATIN' } })
    const after = await apiRequest(`/absence-declarations/${hd.id}`, { token: rh })
    const unchanged = Number(after.data?.durationHours) === 4
    nonReg.push({ id: 'HALF-018', status: patch.status === 400 && unchanged ? 'Conforme' : 'Non conforme', result: `HTTP=${patch.status} durationHours conservé=${unchanged}` })
  } catch (e) { nonReg.push({ id: 'HALF-018', status: 'Bloqué', result: e.message }) }

  const payload = {
    lot: 4,
    dateRetest: '29/09/2026',
    executed: true,
    anomalies: report,
    nonRegression: nonReg,
  }
  writeReport(payload)

  console.log('\n===== SYNTHÈSE RETEST LOT 4 =====')
  for (const a of report) {
    console.log(`\n${a.anomalyId} (${a.severity}) : ${a.conclusion}`)
    for (const s of a.scenarios) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
    for (const s of a.nonRegressions ?? []) console.log(`  [NR] ${s.id}: ${s.status} | ${s.result}`)
    if (a.negativeControl) console.log(`  [NEG] ${a.negativeControl.status} | ${a.negativeControl.result}`)
  }
  console.log('\nNON-RÉGRESSION:')
  for (const s of nonReg) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  console.log(`\nRapport écrit dans tests/recette/reports/retest-lot4-relais-validation.json (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
