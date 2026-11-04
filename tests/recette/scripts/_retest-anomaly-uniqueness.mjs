// Vérifie l'unicité SQL RÉELLE des anomalies (index sur colonnes générées
// COALESCE(NULL → '')) : un index UNIQUE sur colonnes NULL autoriserait des
// doublons. On teste ici le niveau SQL, y compris avec NULL.
import { dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const TAG = 'UQ' + Date.now().toString(36)

  // Utilise un salarié existant (compte RH recette) uniquement comme clé FK.
  const [[rh]] = await conn.query("SELECT id FROM users WHERE email='rh.recette@gmes.fr'")
  const employeeId = rh.id
  const period = '2020-2021'
  const month = '2020-09'

  const clean = () => conn.query(
    "DELETE FROM accrual_anomalies WHERE employee_id=? AND reference_period=? AND accrual_month=? AND (type='HISTORICAL_PENDING' OR type='ABSENCE_OVERLAP_CONFLICT')",
    [employeeId, period, month],
  )
  await clean()

  // 1. Deux anomalies SANS conflict_key, même (salarié, type, période, mois) :
  //    la seconde doit être rejetée (unicité garantie malgré NULL).
  const insertNonConflict = () => conn.query(
    "INSERT INTO accrual_anomalies (employee_id, type, reference_period, accrual_month, conflict_key, days, status) VALUES (?, 'HISTORICAL_PENDING', ?, ?, NULL, 1, 'OPEN')",
    [employeeId, period, month],
  )
  await insertNonConflict()
  let dupNonConflict = false
  try {
    await insertNonConflict()
  } catch (e) {
    dupNonConflict = e.code === 'ER_DUP_ENTRY'
  }
  rec('UQ-NON-CONFLICT-DOUBLON', 'Doublon sans conflict_key refusé par la base', dupNonConflict)

  // 2. Deux anomalies AVEC conflict_key DIFFÉRENTES : toutes deux acceptées.
  const insertConflict = (key) => conn.query(
    "INSERT INTO accrual_anomalies (employee_id, type, reference_period, accrual_month, conflict_key, days, status) VALUES (?, 'ABSENCE_OVERLAP_CONFLICT', ?, ?, ?, 1, 'OPEN')",
    [employeeId, period, month, key],
  )
  await insertConflict(`${TAG}-1,${TAG}-2`)
  let twoConflictsOk = true
  try {
    await insertConflict(`${TAG}-3,${TAG}-4`)
  } catch {
    twoConflictsOk = false
  }
  rec('UQ-CONFLICTS-DISTINCTS', 'Deux conflict_key distincts acceptés (anomalies indépendantes)', twoConflictsOk)

  // 3. Même conflict_key deux fois : doublon refusé.
  let dupSameConflict = false
  try {
    await insertConflict(`${TAG}-1,${TAG}-2`)
  } catch (e) {
    dupSameConflict = e.code === 'ER_DUP_ENTRY'
  }
  rec('UQ-CONFLICT-DOUBLON', 'Même conflict_key deux fois refusé', dupSameConflict)

  // 4. Anomalies sans mois (accrual_month NULL) : unicité aussi.
  await conn.query(
    "INSERT INTO accrual_anomalies (employee_id, type, reference_period, accrual_month, conflict_key, days, status) VALUES (?, 'AMBIGUOUS_LEGACY', ?, NULL, NULL, 1, 'OPEN')",
    [employeeId, period],
  )
  let dupNullMonth = false
  try {
    await conn.query(
      "INSERT INTO accrual_anomalies (employee_id, type, reference_period, accrual_month, conflict_key, days, status) VALUES (?, 'AMBIGUOUS_LEGACY', ?, NULL, NULL, 1, 'OPEN')",
      [employeeId, period],
    )
  } catch (e) {
    dupNullMonth = e.code === 'ER_DUP_ENTRY'
  }
  rec('UQ-MOIS-NULL-DOUBLON', 'Doublon sans mois (accrual_month NULL) refusé', dupNullMonth)

  await clean()
  await conn.query(
    "DELETE FROM accrual_anomalies WHERE employee_id=? AND reference_period=? AND type='AMBIGUOUS_LEGACY' AND accrual_month IS NULL",
    [employeeId, period],
  )
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUNICITÉ ANOMALIES : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UNICITÉ :', e); process.exit(1) })
