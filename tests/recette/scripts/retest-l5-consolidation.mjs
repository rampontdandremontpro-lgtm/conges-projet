// JUR-027 — L5 consolidation (clôture unifiée) : lots confirmés transférés,
// dossiers incomplets/frozen bloqués, allocation concurrente conservée.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l5-consolidation.json')
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
    const rh = await login('rh.recette@gmes.fr')
    const tag = 'CONS' + Date.now().toString(36)

    const [lt] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP-${tag}`])
    const ltId = lt.insertId
    const addBalance = (emp, period, counter, available, reserved = 0) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, available, available, reserved])
    const addLot = (emp, key, days, remaining, status, infoDate, certain, confirmation, reconciled, expires, target, regime = 'GENERAL') =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', ?, ?, ?, ?, ?, ?, ?, 'L3141-19-1', ?, 0, '2025-05-31')`,
        [emp.id, target, days, remaining, regime, status, infoDate, certain, confirmation, reconciled, expires, `${tag}-${key}`],
      )
    const close = (p) => apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: p, confirm: true } })

    // 1. Clôture unifiée : lot confirmé transféré + opérations GMES.
    await addBalance(colA, '2024-2025', 'N-1', 10)
    await addLot(colA, 'act', 3, 3, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2024-2025')
    const e1 = await close('2024-2025')
    const [[lot1]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-act`])
    rec('CONS-1', 'Clôture unifiée : lot confirmé transféré', e1.status === 201 && lot1.target_reference_period === '2025-2026' && lot1.status === 'ACTIF', `HTTP ${e1.status} target=${lot1.target_reference_period}`)

    // 2. Deux clôtures simultanées → une seule.
    await addBalance(colB, '2025-2026', 'N-1', 10)
    await addLot(colB, 'sim', 4, 4, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2025-2026')
    const [s1, s2] = await Promise.all([close('2025-2026'), close('2025-2026')])
    const st = [s1.status, s2.status].sort()
    rec('CONS-2', 'Deux clôtures simultanées → une seule', st.join(',') === '201,409', `HTTP ${st.join('/')}`)

    // 3. Lot A_VERIFIER (dossier incomplet) → blocage sans remise à zéro.
    await addBalance(colA, '2023-2024', 'N-1', 8)
    await addLot(colA, 'avr', 3, 3, 'A_VERIFIER', null, null, null, 1, null, '2023-2024')
    const [[balAvr]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2023-2024' AND counter_type='N-1'", [colA.id])
    const eAvr = await close('2023-2024')
    const [[balAvrAfter]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2023-2024' AND counter_type='N-1'", [colA.id])
    rec('CONS-3', 'Lot A_VERIFIER → blocage sans remise à zéro', eAvr.status === 400 && num(balAvr.available_days) === num(balAvrAfter.available_days), `HTTP ${eAvr.status} avail=${balAvr.available_days}→${balAvrAfter.available_days}`)

    // 4. Échéance incertaine → blocage.
    await addBalance(colA, '2022-2023', 'N-1', 8)
    await addLot(colA, 'unkexp', 3, 3, 'ACTIF', '2026-06-25', null, 'CONFIRMEE', 1, null, '2022-2023')
    const eUnk = await close('2022-2023')
    rec('CONS-4', 'Échéance incertaine → clôture bloquée', eUnk.status === 400, `HTTP ${eUnk.status}`)

    // 5. frozen_in_balance → blocage.
    await addBalance(colA, '2021-2022', 'N-1', 8)
    await addLot(colA, 'frz', 3, 3, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2021-2022')
    const [[lotFrz]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-frz`])
    await conn.query("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, days, covered_dates, actor_id, frozen_in_balance) VALUES (?, NULL, NULL, (SELECT id FROM leave_balances WHERE employee_id=? AND reference_period='2021-2022' AND counter_type='N-1'), 'REGULARISATION', 2, NULL, NULL, 1)", [lotFrz.id, colA.id])
    const eFrz = await close('2021-2022')
    rec('CONS-5', 'Gel frozen_in_balance → clôture bloquée', eFrz.status === 400, `HTTP ${eFrz.status}`)

    // 6. Restitution concurrente multi-lots.
    await addBalance(colA, '2020-2021', 'N-1', 10)
    await addBalance(colA, '2021-2022', 'N', 20)
    await addLot(colA, 'm1', 2, 2, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2020-2021')
    await addLot(colA, 'm2', 2, 2, 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', '2020-2021')
    const [rm] = await conn.query("INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, '2027-01-11', '2027-01-14', 4, 4, 'VALIDEE', 'DEFINITIF')", [colA.id, ltId])
    const rmId = rm.insertId
    const rmConsume = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: rmId, referencePeriod: '2021-2022' } })
    rec('CONS-6', 'Consommation multi-lots', rmConsume.status === 201, `HTTP ${rmConsume.status}`)
    const [rr1, rr2] = await Promise.all([
      apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: rmId } }),
      apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: rmId } }),
    ])
    const rst = [rr1.status, rr2.status].sort()
    const [[recr]] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [rmId])
    rec('CONS-7', 'Restitution concurrente multi-lots → une seule', rst.join(',') === '201,409' && num(recr.c) === 2, `HTTP ${rst.join('/')} recr=${recr.c}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L5-CONS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L5-CONS :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
