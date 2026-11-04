// L3141-7 — démonstration ISOLÉE de l'arrondi de clôture (droit acquis de base
// porté à l'entier supérieur, plafond 30) et de l'ABSENCE de clôture partielle,
// sans exécuter la clôture globale sur des centaines de comptes de recette.
// On crée un salarié dédié dans une période de référence dédiée et on appelle
// uniquement l'aperçu de clôture (lecture seule, aucun marqueur de clôture écrit).
import { apiRequest, login, dbConn, config } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'L3141' + Date.now().toString(36)
  const PERIOD = '2019-2020'

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `ARRONDI-${TAG}`, prenom: 'Recette', email: `arrondi.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2019-01-01', legalEntityId: gmes[0].id } })).data

  // Droit acquis de base : 26,29 jours ouvrables (doit être porté à 27).
  const base = 26.29
  const [bal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, ?, 'N', ?, 0, 0, ?)",
    [emp.id, PERIOD, base, base],
  )
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', ?, 0, ?, '2020-05', 'Acquisition de la période 2019-2020')",
    [emp.id, bal?.insertId, base, base],
  )

  // Aperçu de clôture (lecture seule) : aucun marqueur de clôture ne doit être
  // écrit, et l'arrondi L3141-7 doit être calculé pour CE salarié uniquement.
  const preview = await apiRequest(`/leave-balances/period/${PERIOD}/preview`, { method: 'GET', token: rhToken })
  const rows = preview.data?.employees ?? []
  const mine = rows.find((r) => Number(r.employeeId) === Number(emp.id))

  const supplementOk = mine && Math.abs(Number(mine.roundingSupplement) - (27 - base)) < 0.005
  const transferOk = mine && Number(mine.nToTransfer) === 27
  rec('L3141-ISO-ARRONDI', 'Aperçu de clôture isolé : 26,29 → supplément 0,71 et transfert 27', supplementOk && transferOk, `supp=${mine?.roundingSupplement} transfer=${mine?.nToTransfer}`)

  const [marker] = await conn.query(
    "SELECT setting_value FROM settings WHERE setting_key = 'REFERENCE_PERIOD_CLOSED_2019_2020'",
  )
  rec('L3141-ISO-PAS-DE-CLOTURE', 'Aucune clôture partielle écrite (marqueur absent)', marker?.length === 0, `marker=${marker?.length ?? '?'}`)

  const [corruptBalances] = await conn.query(
    "SELECT COUNT(*) AS c FROM leave_balances WHERE reference_period='2019-2020' AND employee_id=? AND available_days <> acquired_days",
    [emp.id],
  )
  rec('L3141-ISO-COHERENT', 'Solde de la période dédiée inchangé après aperçu', Number(corruptBalances?.[0]?.c ?? 0) === 0, `corrupt=${corruptBalances?.[0]?.c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT L3141-7 ISOLÉ : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR L3141-7 ISOLÉ :', e); process.exit(1) })
