// Consolidation JUR-019 → JUR-022 : cohérence des unités, 5e semaine fiable,
// annulations/consommation, recalcul concurrent, changement de configuration.
// Cible : gestion_conges_gmes_test uniquement.
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
  const TAG = 'CS' + Date.now().toString(36)
  const REF = '2025-2026'

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `CS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })

  const mkEmp = async (suffix, hireDate = '2015-05-01') => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `CS-${suffix}`, prenom: 'Recette', email: `cs-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate, legalEntityId: gmesId } })).data
  const initBal = (empId, days = 25) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: REF, counterType: 'N', acquiredDays: days, reason: 'Fixture consolidation' } })
  const directLeave = (empId, start, end, extra = {}) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: lt.data.id, startDate: start, endDate: end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN', ...extra } })

  // Configurations
  await apiRequest('/leave-balances/seniority-extra/config', { method: 'PUT', token: rhToken, body: { enabled: true, referenceMonthDay: '05-01', thresholds: [{ minYears: 5, extraDays: 1 }, { minYears: 10, extraDays: 2 }, { minYears: 15, extraDays: 3 }, { minYears: 20, extraDays: 4 }], legalEntityCodes: ['GMES'] } })
  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })

  // ── A. Cohérence des unités : acquisition → affichage → déduction → solde ──
  const ua = await mkEmp('UA', '2021-05-01') // 5 ans au 2026-05-01 → +1 ancienneté
  await initBal(ua.id, 25)
  // 3 jours ouvrés hors période (février 2026) → fractionnement +1.
  await directLeave(ua.id, '2026-02-02', '2026-02-04')
  await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  const [[uaBal]] = await conn.query('SELECT acquired_days a, available_days v, consumed_days c FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [ua.id, REF, 'N'])
  // 25 base + 1 ancienneté + 1 fractionnement = 27 acquis ; 27 - 3 (congé hors période) = 24 dispo.
  rec('UNIT-ACQ', 'Compteur : base 25 + 1 ancienneté + 1 fractionnement = 27 acquis', num(uaBal.a) === 27, `acq=${uaBal.a}`)
  rec('UNIT-DISP', 'Disponible = 27 - 3 jours consommés = 24 (congé déduit 1:1)', num(uaBal.v) === 24 && num(uaBal.c) === 3, `disp=${uaBal.v} cons=${uaBal.c}`)
  // Prendre 1 jour (lundi) : le bonus est consommé 1:1.
  await directLeave(ua.id, '2026-03-02', '2026-03-02')
  const [[uaBal2]] = await conn.query('SELECT available_days v, consumed_days c FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [ua.id, REF, 'N'])
  rec('UNIT-CONS', 'Un jour pris → -1 (consommation 1:1 du bonus, pas de conversion)', num(uaBal2.v) === 23 && num(uaBal2.c) === 4, `disp=${uaBal2.v} cons=${uaBal2.c}`)
  const [uaMv] = await conn.query("SELECT movement_type, SUM(days) s FROM balance_movements WHERE employee_id=? GROUP BY movement_type ORDER BY movement_type", [ua.id])
  const mvMap = Object.fromEntries(uaMv.map((r) => [r.movement_type, Number(r.s)]))
  rec('UNIT-MVT', 'Historique cohérent (SENIORITY_EXTRA +1, FRACTIONNEMENT +1, DEDUCTION -4)', mvMap.SENIORITY_EXTRA === 1 && mvMap.FRACTIONNEMENT === 1 && mvMap.DEDUCTION === 4, `mv=${JSON.stringify(mvMap)}`)

  // ── B. Cinquième semaine fiable ───────────────────────────────────────────
  const b1 = await mkEmp('B1')
  await initBal(b1.id, 25)
  await directLeave(b1.id, '2026-02-02', '2026-02-06') // 5 ouvrés hors période (congé principal)
  const b2 = await mkEmp('B2')
  await initBal(b2.id, 25)
  await directLeave(b2.id, '2026-02-02', '2026-02-06', { classification: 'FIFTH_WEEK' }) // 5 ouvrés 5e semaine
  const fp = await apiRequest(`/leave-balances/fractionnement/preview/${REF}`, { token: rhToken })
  const fpMap = new Map(fp.data.map((x) => [x.employeeId, x]))
  rec('5S-PRINCIPAL', '5 jours ouvrés hors période (congé principal) → +2', fpMap.get(b1.id)?.bonusDays === 2, `bonus=${fpMap.get(b1.id)?.bonusDays}`)
  rec('5S-FLAG', '5 jours ouvrés hors période marqués « 5e semaine » → 0 (exclus)', fpMap.get(b2.id)?.bonusDays === 0 && fpMap.get(b2.id)?.fifthWeekDays === 5, `bonus=${fpMap.get(b2.id)?.bonusDays} 5e=${fpMap.get(b2.id)?.fifthWeekDays}`)

  // ── C. Annulation après attribution + consommation du bonus ───────────────
  const c1 = await mkEmp('C1')
  await initBal(c1.id, 25)
  const cLeave = await directLeave(c1.id, '2026-02-02', '2026-02-04') // 3 ouvrés → +1
  await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  await directLeave(c1.id, '2026-03-02', '2026-03-02') // consomme 1 jour (partie du bonus)
  await apiRequest(`/leave-requests/${cLeave.data.id}/cancellation-request`, { method: 'POST', token: rhToken, body: { reason: 'Consolidation' } })
  const cc = await apiRequest(`/leave-requests/${cLeave.data.id}/cancellation-complete`, { method: 'POST', token: rhToken })
  const [[c1Bal]] = await conn.query('SELECT acquired_days a, available_days v, consumed_days c FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [c1.id, REF, 'N'])
  const [c1Fr] = await conn.query("SELECT SUM(days) s, COUNT(*) n FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [c1.id])
  // 25 +1 bonus = 26 ; -3 (congé) -1 (congé) = 22 ; annulation du congé de 3 j → +3 → 25 ; recalcul bonus 1→0 → -1 → 24. Consommé = 1.
  rec('CANC-CONS', 'Annulation après consommation : recalcul tracé, solde cohérent, conso préservée', cc.status === 200 && num(c1Bal.a) === 25 && num(c1Bal.v) === 24 && num(c1Bal.c) === 1 && num(c1Fr[0].s) === 0 && num(c1Fr[0].n) === 2, `acq=${c1Bal.a} disp=${c1Bal.v} cons=${c1Bal.c} frMvt=${c1Fr[0].n}(${c1Fr[0].s})`)

  // ── D. Demande validée mais pas encore prise ──────────────────────────────
  const d1 = await mkEmp('D1')
  await initBal(d1.id, 25)
  await directLeave(d1.id, '2027-02-01', '2027-02-05') // futur → CONGE_PREVISIONNEL, non débité
  const fp2 = await apiRequest(`/leave-balances/fractionnement/preview/${REF}`, { token: rhToken })
  const fp2Map = new Map(fp2.data.map((x) => [x.employeeId, x]))
  rec('FUTUR', 'Congé validé mais non pris (futur) → non compté dans le fractionnement', fp2Map.get(d1.id)?.bonusDays === 0 && fp2Map.get(d1.id)?.outsidePeriodDays === 0, `bonus=${fp2Map.get(d1.id)?.bonusDays}`)

  // ── E. Deux recalculs simultanés → une seule écriture ─────────────────────
  const e1 = await mkEmp('E1')
  await initBal(e1.id, 25)
  await directLeave(e1.id, '2026-02-02', '2026-02-04') // 3 ouvrés → +1
  await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  await directLeave(e1.id, '2026-02-09', '2026-02-10') // +2 ouvrés → 5 au total → bonus +2
  const [r1, r2] = await Promise.all([
    apiRequest('/leave-balances/fractionnement/recompute', { method: 'POST', token: rhToken, body: { referencePeriod: REF } }),
    apiRequest('/leave-balances/fractionnement/recompute', { method: 'POST', token: rhToken, body: { referencePeriod: REF } }),
  ])
  const [e1Fr] = await conn.query("SELECT SUM(days) s, COUNT(*) n FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [e1.id])
  rec('CONC-RECALC', 'Deux recalculs simultanés → un seul ajustement (+1 → +2)', r1.status === 201 && r2.status === 201 && num(e1Fr[0].s) === 2 && num(e1Fr[0].n) === 2, `somme=${e1Fr[0].s} mvts=${e1Fr[0].n}`)

  // ── F. Recalcul après changement de configuration ─────────────────────────
  const f1 = await mkEmp('F1')
  await initBal(f1.id, 25)
  await directLeave(f1.id, '2026-02-02', '2026-02-04') // 3 ouvrés
  await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } }) // +1
  // Change le seuil : 3 jours → 0 (oneDayMin = 5) ; recalcul → bonus 1 → 0.
  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC', oneDayMin: 5, twoDaysMin: 8 }] } })
  const fr = await apiRequest('/leave-balances/fractionnement/recompute', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  const [f1Fr] = await conn.query("SELECT SUM(days) s FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [f1.id])
  rec('CFG-RECALC', 'Recalcul après changement de seuils (3 j → 0, ajustement -1)', fr.status === 201 && num(f1Fr[0].s) === 0, `somme=${f1Fr[0].s}`)
  // Restaure la config Syntec standard.
  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT CONSOLIDATION : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR CONSOLIDATION :', e); process.exit(1) })
