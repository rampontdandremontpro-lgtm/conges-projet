// Cas A / B / C — parcours RH d'enregistrement d'absence et régularisation
// automatique de l'acquisition (base gestion_conges_gmes_test uniquement).
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const TAG = 'ABC' + Date.now().toString(36)

  const svc = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:`SVC-${TAG}`, serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false } })).data
  const mkEmp = async (suffix) => (await apiRequest('/users', { method:'POST', token:admin, body:{ nom:`ABC-${suffix}`, prenom:'Recette', email:`abc-${suffix}.${TAG}@recette.fr`, role:'COLLABORATEUR', employmentType:'INTERNE', serviceId:svc.id, hireDate:'2026-01-06' } })).data
  // Type d'absence RH « maladie » sans justificatif obligatoire (rhOnly).
  const mal = (await apiRequest('/leave-types', { method:'POST', token:admin, body:{ name:`MAL-${TAG}`, category:'DECLARATION_ABSENCE', deductsPaidLeaveBalance:false, documentRequired:false, documentCanBeAddedLater:false, employeeCanCreate:false, rhOnly:true, allowsDays:true, allowsHalfDays:false, allowsHours:false, requiresValidation:false } })).data
  await apiRequest(`/leave-types/${mal.id}/absence-kind`, { method:'PATCH', token:rh, body:{ absenceKind:'ARRET_MALADIE' } })

  const rhRegister = async (employeeId, typeId, start, end) => {
    const d = (await apiRequest('/absence-declarations', { method:'POST', token:rh, body:{ employeeId, leaveTypeId:typeId, startDate:start, endDate:end } })).data
    const sub = await apiRequest(`/absence-declarations/${d.id}/submit`, { method:'POST', token:rh, body:{ certifiedAccurate:true } })
    return { abs: sub.data ?? d, submitStatus: sub.status }
  }
  const runAccrual = (month) => apiRequest('/leave-balances/accrual/run', { method:'POST', token:rh, body:{ accrualMonth: month } })
  const netFor = async (empId, month) => {
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END),0) d
         FROM balance_movements WHERE employee_id=? AND accrual_month=? AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')`,
      [empId, month],
    )
    return num(rows[0].d)
  }
  const movementCount = async (empId, month) => {
    const [rows] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND accrual_month=?', [empId, month])
    return num(rows[0].c)
  }
  const corrNegCount = async (empId, month) => {
    const [rows] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND accrual_month=? AND movement_type='CORRECTION_NEGATIVE'", [empId, month])
    return num(rows[0].c)
  }

  // ── CAS C — déclaration RH sans justificatif obligatoire → ENREGISTREE directe + recalcul ──
  const eC = await mkEmp('C')
  await runAccrual('2026-09')
  const cBefore = await netFor(eC.id, '2026-09')
  const cReg = await rhRegister(eC.id, mal.id, '2026-09-01', '2026-09-30')
  rec('CAS-C-STATUT', 'Transmission RH sans justificatif → ENREGISTREE directe', cReg.submitStatus === 200 && cReg.abs?.status === 'ENREGISTREE', `http=${cReg.submitStatus} status=${cReg.abs?.status}`)
  const cNet = await netFor(eC.id, '2026-09')
  rec('CAS-C-RECALC', 'Enregistrement direct déclenche le recalcul (2,5 → 2)', cBefore === 2.5 && Math.abs(cNet - 2) < 0.01, `avant=${cBefore} après=${cNet}`)

  // ── CAS A — absence sur mois déjà crédité → correction + pas de double mouvement ──
  const eA = await mkEmp('A')
  await runAccrual('2026-09')
  const aBefore = await netFor(eA.id, '2026-09')
  await rhRegister(eA.id, mal.id, '2026-09-01', '2026-09-30')
  const aNet = await netFor(eA.id, '2026-09')
  const aCorr = await corrNegCount(eA.id, '2026-09')
  rec('CAS-A-CORRECTION', 'Mois crédité puis arrêt enregistré : correction -0,5', aBefore === 2.5 && Math.abs(aNet - 2) < 0.01 && aCorr === 1, `avant=${aBefore} après=${aNet} corrNeg=${aCorr}`)
  const count1 = await movementCount(eA.id, '2026-09')
  await runAccrual('2026-09')
  await apiRequest('/leave-balances/accrual/regularize', { method:'POST', token:rh, body:{ employeeId:eA.id, startDate:'2026-09-01', endDate:'2026-09-30' } })
  const count2 = await movementCount(eA.id, '2026-09')
  rec('CAS-A-NO-DOUBLE', 'Répétition (acquisition + régularisation) sans double mouvement', count1 === count2, `mouvements ${count1}→${count2}`)

  // ── CAS B — absence sur mois NON terminé → aucune anticipation + garde-fou ──
  const eB = await mkEmp('B')
  const bReg = await rhRegister(eB.id, mal.id, '2026-12-01', '2026-12-31')
  const bMoves = await movementCount(eB.id, '2026-12')
  const bFuture = await runAccrual('2026-12')
  rec('CAS-B-ENREGISTREE', 'Absence sur mois futur enregistrée (statut ENREGISTREE)', bReg.abs?.status === 'ENREGISTREE', `status=${bReg.abs?.status}`)
  rec('CAS-B-NO-EARLY', 'Aucun crédit anticipé sur le mois non terminé', bMoves === 0, `mouvements=${bMoves}`)
  rec('CAS-B-GARDE-FOU', 'L’endpoint refuse de créditer un mois non terminé (400)', bFuture.status === 400, `http=${bFuture.status}`)
  const bOct = await runAccrual('2026-10')
  const bOctNet = await netFor(eB.id, '2026-10')
  rec('CAS-B-PAS-D-INTERFERENCE', 'L’absence future n’altère pas le crédit du mois terminé', bOct.status === 201 && bOctNet === 2.5, `octobre=${bOctNet}`)

  const failed = results.filter(r=>!r.ok).length
  console.log(`\nCAS A/B/C : ${results.length-failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}
main().catch((e)=>{ console.error('ERREUR CAS A/B/C :', e); process.exit(1) })
