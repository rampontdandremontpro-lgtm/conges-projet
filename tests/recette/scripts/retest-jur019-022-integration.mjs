// JUR-019 / JUR-020 (ancienneté) + JUR-021 / JUR-022 (fractionnement) — recette
// du fonctionnement RÉEL : configuration, attribution automatique idempotente,
// calcul sur congés effectivement pris, recalcul après annulation, traçabilité.
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
  const TAG = 'EXT' + Date.now().toString(36)
  const REF = '2025-2026' // période de référence → date d'appréciation 2026-05-01

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const effId = ents.find((e) => e.code === 'EFFICIENCE').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `EXT-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })

  const mkEmp = async (suffix, hireDate, entId) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `EXT-${suffix}`, prenom: 'Recette', email: `ext-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate, legalEntityId: entId } })).data

  // ── JUR-019 / JUR-020 — ancienneté ────────────────────────────────────────
  const putSr = await apiRequest('/leave-balances/seniority-extra/config', {
    method: 'PUT', token: rhToken,
    body: { enabled: true, referenceMonthDay: '05-01', thresholds: [{ minYears: 5, extraDays: 1 }, { minYears: 10, extraDays: 2 }, { minYears: 15, extraDays: 3 }, { minYears: 20, extraDays: 4 }], legalEntityCodes: ['GMES'] },
  })
  rec('JUR-019-CONFIG', 'Configuration ancienneté enregistrée (GMES uniquement)', putSr.status === 200 && putSr.data.enabled === true && putSr.data.legalEntityCodes.length === 1, `http=${putSr.status}`)

  const e5 = await mkEmp('E5', '2021-05-01', gmesId)
  const e10 = await mkEmp('E10', '2016-05-01', gmesId)
  const e20 = await mkEmp('E20', '2006-05-01', gmesId)
  const e4 = await mkEmp('E4', '2022-05-01', gmesId)
  const eEff = await mkEmp('EFF', '2010-05-01', effId)

  const pv = await apiRequest(`/leave-balances/seniority-extra/preview/${REF}`, { token: rhToken })
  const pvMap = new Map(pv.data.map((x) => [x.employeeId, x]))
  rec('JUR-019-PREVIEW', 'Ancienneté 5/10/20 ans → +1/+2/+4 ; 4 ans → 0 ; EFFICIENCE non applicable',
    pvMap.get(e5.id)?.extraDays === 1 && pvMap.get(e10.id)?.extraDays === 2 && pvMap.get(e20.id)?.extraDays === 4 && pvMap.get(e4.id)?.extraDays === 0 && pvMap.get(eEff.id)?.extraDays === 0 && pvMap.get(eEff.id)?.applicable === false && pvMap.get(eEff.id)?.skipReason === 'ENTITE_NON_CONCERNEE',
    `5a=${pvMap.get(e5.id)?.extraDays} 10a=${pvMap.get(e10.id)?.extraDays} 20a=${pvMap.get(e20.id)?.extraDays} 4a=${pvMap.get(e4.id)?.extraDays} eff=${pvMap.get(eEff.id)?.extraDays}`)

  const ap = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  rec('JUR-019-APPLY', 'Attribution ancienneté (3 salariés GMES, +1/+2/+4)', ap.status === 201 && ap.data.allocated.length === 3, `http=${ap.status} alloc=${ap.data.allocated.length}`)

  const [srMv] = await conn.query("SELECT employee_id, SUM(days) s, COUNT(*) c FROM balance_movements WHERE movement_type='SENIORITY_EXTRA' GROUP BY employee_id")
  const srByEmp = new Map(srMv.map((r) => [r.employee_id, Number(r.s)]))
  rec('JUR-019-MVT', 'Mouvements SENIORITY_EXTRA corrects (type dédié, solde +1/+2/+4)',
    srByEmp.get(e5.id) === 1 && srByEmp.get(e10.id) === 2 && srByEmp.get(e20.id) === 4 && !srByEmp.has(e4.id) && !srByEmp.has(eEff.id),
    `e5=${srByEmp.get(e5.id)} e10=${srByEmp.get(e10.id)} e20=${srByEmp.get(e20.id)}`)

  const [[bal20]] = await conn.query('SELECT acquired_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [e20.id, REF, 'N'])
  rec('JUR-019-BAL', 'Compteur N alimenté (acquis +4, disponible +4)', num(bal20.acquired_days) === 4 && num(bal20.available_days) === 4, `acq=${bal20.acquired_days} avail=${bal20.available_days}`)

  const ap2 = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  const [srMv2] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE movement_type='SENIORITY_EXTRA'")
  rec('JUR-019-IDEMPOT', 'Deuxième exécution → aucune double attribution', ap2.status === 201 && ap2.data.allocated.length === 0 && num(srMv2[0].c) === 3, `alloc=${ap2.data.allocated.length} mvts=${srMv2[0].c}`)

  // ── JUR-021 / JUR-022 — fractionnement ────────────────────────────────────
  const putFr = await apiRequest('/leave-balances/fractionnement/config', {
    method: 'PUT', token: rhToken,
    body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }, { code: 'EFFICIENCE', regime: 'LEGAL' }] },
  })
  rec('JUR-021-CONFIG', 'Configuration fractionnement (GMES=Syntec ouvrés, EFFICIENCE=légal ouvrables)', putFr.status === 200 && putFr.data.entities.length === 2, `http=${putFr.status}`)

  const f3 = await mkEmp('F3', '2015-05-01', gmesId)
  const f5 = await mkEmp('F5', '2015-05-01', gmesId)
  for (const f of [f3, f5]) {
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: f.id, referencePeriod: REF, counterType: 'N', acquiredDays: 25, reason: 'Fixture fractionnement' } })
  }

  // Congés effectivement pris HORS période (février 2026) → DEFINITIF.
  const lr3 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: f3.id, leaveTypeId: lt.data.id, startDate: '2026-02-02', endDate: '2026-02-04', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const lr5 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: f5.id, leaveTypeId: lt.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  // NB : le débit « solde » de l'application compte 6 jours ouvrables (règle GMES
  // samedi après un vendredi après-midi), mais le fractionnement Syntec compte
  // bien 5 jours OUVRÉS (lundi→vendredi) — deux unités distinctes.
  rec('JUR-021-PRISE', 'Congés hors période enregistrés (DEFINITIF ; solde 3/6 j, fractionnement 3/5 j ouvrés)', lr3.status === 201 && lr5.status === 201 && num(lr3.data.deductedDays) === 3 && num(lr5.data.deductedDays) === 6, `d3=${lr3.data?.deductedDays} d5(solde)=${lr5.data?.deductedDays}`)

  const fp = await apiRequest(`/leave-balances/fractionnement/preview/${REF}`, { token: rhToken })
  const fpMap = new Map(fp.data.map((x) => [x.employeeId, x]))
  rec('JUR-021-PREVIEW', 'Fractionnement : 3 j ouvrés hors période → +1 ; 5 j → +2',
    fpMap.get(f3.id)?.bonusDays === 1 && fpMap.get(f5.id)?.bonusDays === 2 && fpMap.get(f3.id)?.outsidePeriodDays === 3 && fpMap.get(f5.id)?.outsidePeriodDays === 5,
    `f3 bonus=${fpMap.get(f3.id)?.bonusDays} f5 bonus=${fpMap.get(f5.id)?.bonusDays}`)

  const fa = await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  rec('JUR-021-APPLY', 'Attribution fractionnement (f3 +1, f5 +2)', fa.status === 201 && fa.data.allocated.length === 2, `http=${fa.status} alloc=${fa.data.allocated.length}`)

  const [frMv] = await conn.query("SELECT employee_id, SUM(days) s FROM balance_movements WHERE movement_type='FRACTIONNEMENT' GROUP BY employee_id")
  const frByEmp = new Map(frMv.map((r) => [r.employee_id, Number(r.s)]))
  rec('JUR-021-MVT', 'Mouvements FRACTIONNEMENT corrects (f3=1, f5=2)', frByEmp.get(f3.id) === 1 && frByEmp.get(f5.id) === 2, `f3=${frByEmp.get(f3.id)} f5=${frByEmp.get(f5.id)}`)

  const fa2 = await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: REF } })
  rec('JUR-021-IDEMPOT', 'Deuxième exécution fractionnement → aucune double attribution', fa2.status === 201 && fa2.data.allocated.length === 0, `alloc=${fa2.data.allocated.length}`)

  // ── Recalcul après annulation ─────────────────────────────────────────────
  const cr = await apiRequest(`/leave-requests/${lr3.data.id}/cancellation-request`, { method: 'POST', token: rhToken, body: { reason: 'Recette fractionnement' } })
  const cc = await apiRequest(`/leave-requests/${lr3.data.id}/cancellation-complete`, { method: 'POST', token: rhToken })
  const [frMv3] = await conn.query("SELECT SUM(days) s, COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [f3.id])
  rec('JUR-022-RECALC', 'Annulation d’un congé hors période → recalcul (f3 : 1 → 0, ajustement -1 tracé)',
    cr.status === 200 && cc.status === 200 && num(frMv3[0].s) === 0 && num(frMv3[0].c) === 2,
    `cancel=${cc.status} somme=${frMv3[0].s} mvts=${frMv3[0].c}`)

  const [frAud] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE action IN ('FRACTIONNEMENT_ALLOCATED','FRACTIONNEMENT_RECALCULATED','SENIORITY_EXTRA_ALLOCATED')")
  rec('JUR-AUDIT', 'Traçabilité : audits ancienneté + fractionnement présents', num(frAud[0].c) >= 5, `audits=${frAud[0].c}`)

  // ── Concurrence : deux attributions simultanées → une seule écriture ──────
  const c1 = await mkEmp('C1', '2010-05-01', gmesId)
  const [cc1, cc2] = await Promise.all([
    apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rhToken, body: { referencePeriod: '2026-2027' } }),
    apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rhToken, body: { referencePeriod: '2026-2027' } }),
  ])
  const [c1mv] = await conn.query("SELECT COUNT(*) c, SUM(days) s FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [c1.id])
  rec('JUR-019-CONC', 'Deux attributions concurrentes → une seule écriture (16 ans → +3)', (cc1.status === 201 && cc2.status === 201) && num(c1mv[0].c) === 1 && num(c1mv[0].s) === 3, `mvts=${c1mv[0].c} somme=${c1mv[0].s}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-019..022 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-019..022 :', e); process.exit(1) })
