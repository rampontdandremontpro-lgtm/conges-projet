// Droits supplémentaires — parcours RÉELS des endpoints d'attribution
// (seniority-extra / fractionnement) sur gestion_conges_gmes_test.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '}${name}${detail ? ' — ' + detail : ''}`) }
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const TAG = 'ED' + Date.now().toString(36)
  const GMES_ID = 19 // entité SYNTEC (vérifiée)

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const emp = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: `DROITS-${TAG}`, prenom: 'Recette', email: `droits.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2021-05-01', legalEntityId: GMES_ID } })).data

  // Compteur initialisé AVANT les attributions : base 20 j.
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: emp.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 20, reason: 'Fixture droits supplémentaires' } })

  // ── 1. ANCIENNETÉ : config → prévisualisation → attribution → relance ──
  const senConfig = await apiRequest('/leave-balances/seniority-extra/config', { method: 'PUT', token: rh, body: { enabled: true, referenceMonthDay: '05-01', thresholds: [{ minYears: 5, extraDays: 1 }, { minYears: 10, extraDays: 2 }, { minYears: 15, extraDays: 3 }, { minYears: 20, extraDays: 4 }], legalEntityCodes: ['GMES'] } })
  rec('ANC-CONFIG', 'Configuration ancienneté activée (Syntec)', senConfig.status === 200 && senConfig.data?.enabled === true, `http=${senConfig.status}`)

  const senPreview = await apiRequest('/leave-balances/seniority-extra/preview/2026-2027', { token: rh })
  const mySen = (senPreview.data ?? []).find((x) => x.employeeId === emp.id)
  rec('ANC-PREVIEW', 'Prévisualisation : +1 j pour 6 ans révolus au 01/05/2027', mySen?.applicable === true && num(mySen?.extraDays) === 1 && num(mySen?.fullYears) === 6, `extra=${mySen?.extraDays} years=${mySen?.fullYears}`)

  const senApply1 = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const allocatedMe = (senApply1.data?.allocated ?? []).find((x) => x.employeeId === emp.id)
  rec('ANC-APPLY', 'Attribution : +1 j enregistré pour le salarié', allocatedMe?.extraDays === 1, `allocated=${JSON.stringify(allocatedMe)}`)

  const [senBal] = await conn.query("SELECT acquired_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2026-2027' AND counter_type='N'", [emp.id])
  const [senMov] = await conn.query("SELECT COUNT(*) c, COALESCE(SUM(days),0) s FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [emp.id])
  rec('ANC-MOUVEMENT', 'Mouvement SENIORITY_EXTRA + solde correct (20 → 21)', num(senMov[0].c) === 1 && num(senMov[0].s) === 1 && num(senBal[0].acquired_days) === 21 && num(senBal[0].available_days) === 21, `mv=${senMov[0].c}(${senMov[0].s}j) acquired=${senBal[0].acquired_days}`)

  const senApply2 = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const skippedMe = (senApply2.data?.skipped ?? []).find((x) => x.employeeId === emp.id)
  const [senMov2] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [emp.id])
  rec('ANC-RELANCE', 'Relance : aucun double crédit (DEJA_ATTRIBUE)', skippedMe?.reason === 'DEJA_ATTRIBUE' && num(senMov2[0].c) === 1, `skip=${skippedMe?.reason} mv=${senMov2[0].c}`)

  // ── 2. FRACTIONNEMENT : config → congé hors période → prévisualisation → attribution → relance → annulation ──
  const fraConfig = await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rh, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })
  rec('FRA-CONFIG', 'Configuration fractionnement (GMES = Syntec)', fraConfig.status === 200 && (fraConfig.data?.entities ?? []).some((e) => e.code === 'GMES'), `http=${fraConfig.status}`)

  const cpType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP-FRA-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data

  // Congé hors période (novembre 2026, passé → DEFINITIF), classé congé principal.
  const lv = (await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: { employeeId: emp.id, leaveTypeId: cpType.id, startDate: '2026-11-02', endDate: '2026-11-04', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })).data
  rec('FRA-CONGE', 'Congé principal hors période créé (3 j, DEFINITIF)', lv?.balanceProcessingStatus === 'DEFINITIF' && num(lv?.deductedDays) === 3, `status=${lv?.balanceProcessingStatus} ded=${lv?.deductedDays}`)

  const fraPreview = await apiRequest('/leave-balances/fractionnement/preview/2026-2027', { token: rh })
  const myFra = (fraPreview.data ?? []).find((x) => x.employeeId === emp.id)
  rec('FRA-PREVIEW', 'Prévisualisation : +1 j (3 jours ouvrés hors période Syntec)', myFra?.applicable === true && num(myFra?.bonusDays) === 1 && num(myFra?.outsidePeriodDays) === 3, `bonus=${myFra?.bonusDays} outside=${myFra?.outsidePeriodDays}`)

  const fraApply1 = await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const fraAllocated = (fraApply1.data?.allocated ?? []).find((x) => x.employeeId === emp.id)
  rec('FRA-APPLY', 'Attribution fractionnement : +1 j', fraAllocated?.bonusDays === 1, `allocated=${JSON.stringify(fraAllocated)}`)

  const [fraMov] = await conn.query("SELECT COUNT(*) c, COALESCE(SUM(days),0) s FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [emp.id])
  const [fraBal] = await conn.query("SELECT acquired_days FROM leave_balances WHERE employee_id=? AND reference_period='2026-2027' AND counter_type='N'", [emp.id])
  rec('FRA-MOUVEMENT', 'Mouvement FRACTIONNEMENT + solde (21 → 22)', num(fraMov[0].c) === 1 && num(fraMov[0].s) === 1 && num(fraBal[0].acquired_days) === 22, `mv=${fraMov[0].c}(${fraMov[0].s}j) acquired=${fraBal[0].acquired_days}`)

  const fraApply2 = await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const fraSkipped = (fraApply2.data?.skipped ?? []).find((x) => x.employeeId === emp.id)
  const [fraMov2] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [emp.id])
  rec('FRA-RELANCE', 'Relance fractionnement : aucun double crédit (DEJA_ATTRIBUE)', fraSkipped?.reason === 'DEJA_ATTRIBUE' && num(fraMov2[0].c) === 1, `skip=${fraSkipped?.reason} mv=${fraMov2[0].c}`)

  // Annulation du congé → recalcul automatique du fractionnement (delta -1).
  const cancelReq = await apiRequest(`/leave-requests/${lv.id}/cancellation-request`, { method: 'POST', token: rh, body: { reason: 'Annulation du congé hors période pour retest.' } })
  const cancelDone = await apiRequest(`/leave-requests/${lv.id}/cancellation-complete`, { method: 'POST', token: rh })
  const [fraMov3] = await conn.query("SELECT COUNT(*) c, COALESCE(SUM(days),0) s FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [emp.id])
  const [fraBal3] = await conn.query("SELECT acquired_days FROM leave_balances WHERE employee_id=? AND reference_period='2026-2027' AND counter_type='N'", [emp.id])
  rec('FRA-ANNULATION-RECALC', 'Annulation du congé → recalcul automatique (fractionnement 1 → 0)', cancelReq.status === 200 && cancelDone.status === 200 && num(fraMov3[0].s) === 0 && num(fraBal3[0].acquired_days) === 21, `req=${cancelReq.status} done=${cancelDone.status} net=${fraMov3[0].s} acquired=${fraBal3[0].acquired_days}`)

  const failed = results.filter(r => !r.ok).length
  console.log(`\nDROITS SUPPLÉMENTAIRES : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}
main().catch(e => { console.error('ERREUR DROITS SUPPLÉMENTAIRES :', e); process.exit(1) })
