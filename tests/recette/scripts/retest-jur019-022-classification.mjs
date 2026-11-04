// JUR-021/022 — classification fiable (MAIN / FIFTH_WEEK / UNDETERMINED),
// reclassification RH tracée + permissions, période d'origine des droits N vs N-1.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const colToken = await login('col-a.recette@gmes.fr')
  const TAG = 'CL' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `CL-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `CL-${suffix}`, prenom: 'Recette', email: `cl-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId, period, counter, days) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: period, counterType: counter, acquiredDays: days, reason: 'Fixture classification' } })
  const leave = (empId, start, end, classification) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: lt.data.id, startDate: start, endDate: end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification } })

  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })

  const e1 = await mkEmp('U') // UNDETERMINED
  const e2 = await mkEmp('M') // MAIN
  const e3 = await mkEmp('W') // FIFTH_WEEK
  for (const e of [e1, e2, e3]) await initBal(e.id, '2025-2026', 'N', 25)
  const lr1 = await leave(e1.id, '2026-02-02', '2026-02-06', 'UNDETERMINED')
  const lr2 = await leave(e2.id, '2026-02-02', '2026-02-06', 'MAIN')
  const lr3 = await leave(e3.id, '2026-02-02', '2026-02-06', 'FIFTH_WEEK')

  const fp = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const m = new Map(fp.data.map((x) => [x.employeeId, x]))
  rec('CLS-UNDET', 'Demande non classifiée (UNDETERMINED) → 0 bonus', m.get(e1.id)?.bonusDays === 0, `bonus=${m.get(e1.id)?.bonusDays}`)
  rec('CLS-MAIN', 'Congé principal confirmé (MAIN) → +2', m.get(e2.id)?.bonusDays === 2, `bonus=${m.get(e2.id)?.bonusDays}`)
  rec('CLS-FIFTH', 'Cinquième semaine confirmée (FIFTH_WEEK) → 0', m.get(e3.id)?.bonusDays === 0 && m.get(e3.id)?.fifthWeekDays === 5, `bonus=${m.get(e3.id)?.bonusDays} 5e=${m.get(e3.id)?.fifthWeekDays}`)

  // Reclassification RH : UNDETERMINED → MAIN, puis recalcul → +2.
  const reclass = await apiRequest(`/leave-requests/${lr1.data.id}/classification`, { method: 'PATCH', token: rhToken, body: { classification: 'MAIN' } })
  const [audit] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE action='LEAVE_REQUEST_CLASSIFIED' AND resource_id=?", [lr1.data.id])
  await apiRequest('/leave-balances/fractionnement/recompute', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026' } })
  const fp2 = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const m2 = new Map(fp2.data.map((x) => [x.employeeId, x]))
  rec('CLS-RECLASS', 'Reclassification RH (UNDETERMINED → MAIN) + recalcul → +2, audit tracé', reclass.status === 200 && reclass.data.classification === 'MAIN' && num(audit[0].c) === 1 && m2.get(e1.id)?.bonusDays === 2, `http=${reclass.status} audit=${audit[0].c} bonus=${m2.get(e1.id)?.bonusDays}`)

  // Permissions : non-RH → 403.
  const forbidden = await apiRequest(`/leave-requests/${lr2.data.id}/classification`, { method: 'PATCH', token: colToken, body: { classification: 'FIFTH_WEEK' } })
  rec('CLS-PERM', 'Reclassification réservée à la RH (collaborateur → 403)', forbidden.status === 403, `http=${forbidden.status}`)

  // Période d'origine : congé partiellement financé par N-1 (reporté) → seule la part N compte.
  const e4 = await mkEmp('N1')
  await initBal(e4.id, '2025-2026', 'N-1', 3) // reporté N-1
  await initBal(e4.id, '2025-2026', 'N', 25)
  await leave(e4.id, '2026-02-02', '2026-02-06', 'MAIN') // 5 ouvrés hors période, solde débité 6 (samedi GMES) : 3 N-1 + 3 N
  const fp3 = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const m3 = new Map(fp3.data.map((x) => [x.employeeId, x]))
  // Part N = 3 jours sur 6 débités → ≈ 2,5 jours ouvrés N hors période → < 3 → 0 bonus.
  // Part mixte N-1/N résolue déterministiquement : 3 derniers jours débités sur N
  // (jeu 05/02, ven 06/02, sam 07/02) → ouvrés = jeu + ven = 2 → 0 bonus, aucune incertitude.
  rec('PER-N1', 'Congé mixte N-1/N : résolu déterministiquement (2 j ouvrés N → 0 bonus)', m3.get(e4.id)?.bonusDays === 0 && m3.get(e4.id)?.uncertainRequests === 0 && m3.get(e4.id)?.outsidePeriodDays === 2, `bonus=${m3.get(e4.id)?.bonusDays} horsP=${m3.get(e4.id)?.outsidePeriodDays} incert=${m3.get(e4.id)?.uncertainRequests}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT CLASSIFICATION : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR CLASSIFICATION :', e); process.exit(1) })
