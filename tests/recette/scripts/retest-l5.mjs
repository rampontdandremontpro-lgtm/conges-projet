// JUR-027 — Lot L5 (clôture unifiée) : prévisualisation + clôture de période
// GMES avec traitement des lots maladie dans la même transaction.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l5.json')

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  try {
    const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
    const colA = await get('col-a.recette@gmes.fr')
    const colB = await get('col-b.recette@gmes.fr')
    const colC = await get('col-c.recette@gmes.fr')
    const colP = await get('col-prorata.recette@gmes.fr')
    const rh = await login('rh.recette@gmes.fr')
    const tag = 'L5' + Date.now().toString(36)

    const [lt] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP-${tag}`])
    const ltId = lt.insertId
    const addBalance = (emp, period, counter, available, reserved = 0) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, available, available, reserved])
    const addLot = (emp, key, days, remaining, status, infoDate, certain, confirmation, reconciled, expires, target) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', ?, ?, ?, ?, ?, ?, 'L3141-19-1', ?, 0, '2025-05-31')`,
        [emp.id, target, days, remaining, status, infoDate, certain, confirmation, reconciled, expires, `${tag}-${key}`],
      )

    const preview = (p) => apiRequest(`/carryover-lots/closure/${p}/preview`, { token: rh })
    const close = (p) => apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: p, confirm: true } })

    // 1. Clôture sans lot (ordinaire).
    await addBalance(colA, '2025-2026', 'N-1', 10)
    const pA = await preview('2025-2026')
    rec('L5-01', 'Prévisualisation sans lot (ordinaire=10)', pA.status === 200 && num(pA.data?.counters?.[0]?.ordinaryDays) === 10, `ord=${pA.data?.counters?.[0]?.ordinaryDays}`)
    const eA = await close('2025-2026')
    const [[bA]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colA.id])
    rec('L5-02', 'Clôture sans lot : remise à zéro', eA.status === 201 && num(bA.available_days) === 0, `avail=${bA.available_days}`)

    // 2. Lot actif non expiré → préservé (transfert). Période terminée.
    await addBalance(colB, '2020-2021', 'N-1', 10)
    await addLot(colB, 'act', 4, 4, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2020-2021')
    const pB = await preview('2020-2021')
    rec('L5-03', 'Prévisualisation lot actif (protégé=4)', pB.status === 200 && num(pB.data?.counters?.[0]?.protectedDays) === 4 && num(pB.data?.counters?.[0]?.ordinaryDays) === 6, `prot=${pB.data?.counters?.[0]?.protectedDays}`)
    const eB = await close('2020-2021')
    const [[bB]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2020-2021' AND counter_type='N-1'", [colB.id])
    const [[bBnext]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2021-2022' AND counter_type='N-1'", [colB.id])
    const [[lotB]] = await conn.query('SELECT target_reference_period FROM carryover_lots WHERE idempotency_key=?', [`${tag}-act`])
    rec('L5-04', 'Lot actif transféré sans double crédit (0 + 4)', eB.status === 201 && num(bB.available_days) === 0 && num(bBnext?.available_days ?? 0) === 4 && lotB.target_reference_period === '2021-2022', `cur=${bB.available_days} next=${bBnext?.available_days}`)

    // 3. Lot expiré → expiré, non transféré.
    await addBalance(colC, '2024-2025', 'N-1', 8)
    await addLot(colC, 'exp', 3, 3, 'ACTIF', '2024-01-15', 1, 'CONFIRMEE', 1, '2025-04-15', '2024-2025')
    const eC = await close('2024-2025')
    const [[bC]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [colC.id])
    const [[lotC]] = await conn.query('SELECT status, target_reference_period FROM carryover_lots WHERE idempotency_key=?', [`${tag}-exp`])
    rec('L5-05', 'Lot expiré : non transféré, statut EXPIRE', eC.status === 201 && num(bC.available_days) === 0 && lotC.status === 'EXPIRE' && lotC.target_reference_period === '2024-2025', `avail=${bC.available_days} status=${lotC.status}`)

    // 4. Reliquat inconnu → blocage.
    await addBalance(colP, '2023-2024', 'N-1', 5)
    await addLot(colP, 'unk', 2, null, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2023-2024')
    const eP = await close('2023-2024')
    rec('L5-06', 'Reliquat inconnu → clôture bloquée', eP.status === 400, `HTTP ${eP.status}`)

    // 5. Jours réservés → blocage.
    await addBalance(colA, '2021-2022', 'N-1', 10, 2)
    const eRes = await close('2021-2022')
    rec('L5-07', 'Jours réservés → clôture bloquée', eRes.status === 400, `HTTP ${eRes.status}`)

    // 6. Rejeu de clôture.
    const eA2 = await close('2025-2026')
    rec('L5-08', 'Clôture rejouée refusée (409)', eA2.status === 409, `HTTP ${eA2.status}`)

    // 7. Prévisualisation en lecture seule (aucune écriture).
    const [[mvBefore]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
    await preview('2020-2021')
    const [[mvAfter]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
    rec('L5-09', 'Prévisualisation sans écriture', num(mvBefore.c) === num(mvAfter.c), `mv=${mvAfter.c}`)

    // 8. Pré-contrôle : restore simultanés (ordinaire).
    await addBalance(colA, '2022-2023', 'N-1', 10)
    await addBalance(colA, '2023-2024', 'N', 20)
    const [rr] = await conn.query("INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, '2027-01-11', '2027-01-12', 2, 2, 'VALIDEE', 'DEFINITIF')", [colA.id, ltId])
    const rrId = rr.insertId
    await conn.query("INSERT INTO balance_movements (employee_id, leave_balance_id, leave_request_id, actor_id, movement_type, days, balance_before, balance_after) SELECT ?, id, ?, NULL, 'DEDUCTION', 2, 10, 8 FROM leave_balances WHERE employee_id=? AND reference_period='2022-2023' AND counter_type='N-1'", [colA.id, rrId, colA.id])
    const [r1, r2] = await Promise.all([
      apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: rrId } }),
      apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: rrId } }),
    ])
    const st = [r1.status, r2.status].sort()
    const [[recreditCount]] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [rrId])
    rec('L5-10', 'Deux restore simultanés → un seul recrédit', st.join(',') === '201,409' && num(recreditCount.c) === 1, `HTTP ${st.join('/')} recr=${recreditCount.c}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L5 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L5 :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
