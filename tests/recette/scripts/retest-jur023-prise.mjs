// JUR-023 — période de prise 13 mois : fenêtre, statut aux dates limites, soldes non pris.
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
  const TAG = 'TP' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `TP-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `TP-${TAG}`, prenom: 'Recette', email: `tp-${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data

  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 10, reason: 'Fixture période de prise' } })
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 5, reason: 'Fixture période de prise' } })

  const ovFuture = await apiRequest('/leave-balances/take-period/2026-2027', { token: rhToken })
  rec('TP-FENETRE', 'Fenêtre 2026-2027 : 01/05/2027 → 31/05/2028 (13 mois)', ovFuture.status === 200 && ovFuture.data.takePeriod.start === '2027-05-01' && ovFuture.data.takePeriod.end === '2028-05-31', `${ovFuture.data?.takePeriod?.start} → ${ovFuture.data?.takePeriod?.end}`)
  rec('TP-STATUT', 'Statut 2026-2027 : non ouverte (aujourd’hui 29/10/2026)', ovFuture.data?.status?.status === 'NOT_OPENED', `status=${ovFuture.data?.status?.status}`)

  const empFuture = ovFuture.data?.employees?.find((x) => x.employeeId === emp.id)
  rec('TP-SOLDE', 'Solde N non pris listé (5 jours)', empFuture && num(empFuture.remainingDays) === 5, `remaining=${empFuture?.remainingDays}`)

  const ovPast = await apiRequest('/leave-balances/take-period/2025-2026', { token: rhToken })
  rec('TP-ECHEANCE', 'Statut 2025-2026 : dans la période (fin 31/05/2027)', ovPast.status === 200 && ovPast.data?.status?.status === 'WITHIN_PERIOD', `status=${ovPast.data?.status?.status}`)
  const empPast = ovPast.data?.employees?.find((x) => x.employeeId === emp.id)
  rec('TP-REPORT', 'Solde non pris conservé (10 jours) — non supprimé, reportable', empPast && num(empPast.remainingDays) === 10, `remaining=${empPast?.remainingDays}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-023 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-023 :', e); process.exit(1) })
