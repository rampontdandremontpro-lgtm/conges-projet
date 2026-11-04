// JUR-023 correction + JUR-021/022 : rattachement, reports réellement appliqués,
// résolution déterministe des demandes mixtes N/N-1, reclassification/recalcul.
import { apiRequest, login, dbConn, config } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function uploadPdf(token, name) {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from('%PDF-1.4\nrecette', 'utf8')], { type: 'application/pdf' }), name)
  const response = await fetch(`${config.API_URL}/documents/report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return response.json()
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'RP' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `RP-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `RP-${suffix}`, prenom: 'Recette', email: `rp-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId, period, counter, days) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: period, counterType: counter, acquiredDays: days, reason: 'Fixture reports' } })
  const leave = (empId, start, end, classification) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: lt.data.id, startDate: start, endDate: end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification } })

  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })

  // ── 1. Rattachement des périodes (année de fin) ────────────────────────────
  const tp1 = await apiRequest('/leave-balances/take-period/2025-2026', { token: rhToken })
  rec('PER-RATTACH', 'Période 2025-2026 → prise 01/05/2026 → 31/05/2027', tp1.data?.takePeriod?.start === '2026-05-01' && tp1.data?.takePeriod?.end === '2027-05-31', `${tp1.data?.takePeriod?.start} → ${tp1.data?.takePeriod?.end}`)
  const tp0 = await apiRequest('/leave-balances/take-period/2024-2025', { token: rhToken })
  rec('PER-ECHEANCE', '2024-2025 : échéance dépassée (fin 31/05/2026)', tp0.data?.takePeriod?.end === '2026-05-31' && tp0.data?.status?.status === 'DEADLINE_EXCEEDED', `status=${tp0.data?.status?.status}`)

  // ── 2. Report réellement appliqué (nouvelle échéance utilisée) ─────────────
  const emp = await mkEmp('R')
  await initBal(emp.id, '2025-2026', 'N', 10)
  const proof = await uploadPdf(rhToken, `report-${TAG}.pdf`)
  const rep = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Demande écrite de l’employeur — contraintes de service', documentId: proof.id, newDeadline: '2027-09-30' } })
  rec('REP-CREATE', 'Report enregistré (nouvelle échéance 30/09/2027)', rep.status === 201 && rep.data.newDeadline?.slice(0, 10) === '2027-09-30', `http=${rep.status}`)

  // La nouvelle échéance est réellement utilisée dans le suivi.
  const ovAfter = await apiRequest('/leave-balances/take-period/2025-2026', { token: rhToken })
  const empAfter = ovAfter.data.employees.find((x) => x.employeeId === emp.id)
  rec('REP-APPLIQUE', 'Nouvelle échéance prise en compte dans le suivi (statut recalé)', empAfter?.effectiveDeadline === '2027-09-30' && empAfter?.hasReport === true && empAfter?.status?.status === 'WITHIN_PERIOD', `deadline=${empAfter?.effectiveDeadline} status=${empAfter?.status?.status}`)

  const rep2 = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Doublon', newDeadline: '2027-12-31' } })
  rec('REP-DOUBLE', 'Double report refusé (409)', rep2.status === 409, `http=${rep2.status}`)

  const repBad = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: (await mkEmp('BAD')).id, referencePeriod: '2025-2026', justification: 'Échéance incohérente', newDeadline: '2027-01-01' } })
  rec('REP-ECH-INCOH', 'Report incohérent refusé (échéance avant la fin de prise)', repBad.status === 400, `http=${repBad.status}`)

  const upd = await apiRequest(`/leave-balances/take-period/report/${rep.data.id}`, { method: 'PATCH', token: rhToken, body: { newDeadline: '2027-11-30', justification: 'Report ajusté après accord' } })
  const [updAudit] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE action='TAKE_PERIOD_REPORT_UPDATED' AND resource_id=?", [rep.data.id])
  rec('REP-UPDATE', 'Modification du report avec historique (nouvelle échéance + audit)', upd.status === 200 && upd.data.newDeadline?.slice(0, 10) === '2027-11-30' && num(updAudit[0].c) === 1, `http=${upd.status} audit=${updAudit[0].c}`)

  const list = await apiRequest('/leave-balances/take-period/2025-2026/reports', { token: rhToken })
  rec('REP-LIST', 'Consultation des reports (1 report listé)', list.status === 200 && Array.isArray(list.data) && list.data.length === 1, `n=${list.data?.length}`)

  // ── 3. Demande mixte N/N-1 : résolution déterministe ───────────────────────
  const mx = await mkEmp('MX')
  await initBal(mx.id, '2025-2026', 'N-1', 3)
  await initBal(mx.id, '2025-2026', 'N', 25)
  await leave(mx.id, '2026-02-02', '2026-02-06', 'MAIN') // 5 ouvrés + samedi GMES = 6 débités : 3 N-1 + 3 N
  const fp = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const mxItem = fp.data.find((x) => x.employeeId === mx.id)
  // 3 derniers jours débités sur N (jeu 05/02, ven 06/02, sam 07/02) → ouvrés = jeu + ven = 2 → 0 bonus, aucune incertitude.
  rec('MIXTE', 'Demande mixte N-1/N résolue déterministiquement (2 j ouvrés N → 0 bonus, 0 incertaine)', mxItem?.bonusDays === 0 && mxItem?.uncertainRequests === 0 && mxItem?.outsidePeriodDays === 2, `bonus=${mxItem?.bonusDays} horsP=${mxItem?.outsidePeriodDays} incert=${mxItem?.uncertainRequests}`)

  // ── 4. Reclassification → recalcul transactionnel ──────────────────────────
  const rc = await mkEmp('RC')
  await initBal(rc.id, '2025-2026', 'N', 25)
  const rcLeave = await leave(rc.id, '2026-02-02', '2026-02-06', 'MAIN') // 5 ouvrés → +2
  await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026' } })
  const before = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const rcBefore = before.data.find((x) => x.employeeId === rc.id)
  await apiRequest(`/leave-requests/${rcLeave.data.id}/classification`, { method: 'PATCH', token: rhToken, body: { classification: 'FIFTH_WEEK' } })
  const after = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const rcAfter = after.data.find((x) => x.employeeId === rc.id)
  const [rcMv] = await conn.query("SELECT SUM(days) s, COUNT(*) n FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [rc.id])
  rec('RECLASS-RECALC', 'MAIN → FIFTH_WEEK : bonus remis à zéro (ajustement -2 tracé)', rcBefore?.bonusDays === 2 && rcAfter?.bonusDays === 0 && num(rcMv[0].s) === 0 && num(rcMv[0].n) === 2, `avant=${rcBefore?.bonusDays} après=${rcAfter?.bonusDays} mvts=${rcMv[0].n}(${rcMv[0].s})`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT REPORTS/CORRECTIONS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR REPORTS :', e); process.exit(1) })
