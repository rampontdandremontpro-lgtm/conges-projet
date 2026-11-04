// JUR-027 — Lot L4 (corrections) : tests d'intégration du moteur d'allocation.
// Fixtures synthétiques validées/rapprochées en recette uniquement.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l4.json')

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
    const col = await login('col-a.recette@gmes.fr')
    const tag = 'L4' + Date.now().toString(36)

    const [lt] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP-${tag}`])
    const ltId = lt.insertId

    const addBalance = (emp, period, counter, available) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp.id, period, counter, available, available])

    const addLot = (emp, key, days, remaining, status, expires, confirmationStatus, reconciled, targetPeriod) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', ?, '2026-06-25', 1, ?, ?, ?, 'L3141-19-1', ?, 0)`,
        [emp.id, targetPeriod, days, remaining, status, confirmationStatus, reconciled, expires, `${tag}-${emp.id}-${key}`],
      )

    const addRequest = (emp, start, end, deducted, status = 'VALIDEE') =>
      conn.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DEFINITIF')`,
        [emp.id, ltId, start, end, deducted, deducted, status],
      )

    // ---- col-a : deux lots sur le même compteur N-1 ----
    await addBalance(colA, '2025-2026', 'N-1', 10)
    await addBalance(colA, '2026-2027', 'N', 20)
    await addLot(colA, 'l1', 3, 3, 'ACTIF', '2027-03-31', 'CONFIRMEE', 1, '2025-2026')
    await addLot(colA, 'l2', 2, 2, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026')
    const [[lot1]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-${colA.id}-l1`])
    const [[lot2]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-${colA.id}-l2`])
    const [reqA] = await addRequest(colA, '2027-01-11', '2027-01-14', 4)

    // 1. Deux lots sur le même compteur.
    const cA = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqA.insertId, referencePeriod: '2026-2027' } })
    rec('L4-M1', 'Consommation sur deux lots (201)', cA.status === 201, `HTTP ${cA.status}`)
    const [[lot1After]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1.id])
    const [[lot2After]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2.id])
    rec('L4-M1b', 'Lot1 3→0, Lot2 2→1', num(lot1After.remaining_days) === 0 && num(lot2After.remaining_days) === 1, `lot1=${lot1After.remaining_days} lot2=${lot2After.remaining_days}`)
    const [allocRows] = await conn.query('SELECT movement_id FROM lot_allocations WHERE leave_request_id=? AND operation_type=?', [reqA.insertId, 'CONSUMPTION'])
    rec('L4-M1c', 'Deux allocations, deux mouvements DISTINCTS', allocRows.length === 2 && allocRows[0].movement_id !== allocRows[1].movement_id && allocRows.every((r) => r.movement_id != null), `movementIds=${allocRows.map(r=>r.movement_id).join(',')}`)
    const [[balA]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colA.id])
    rec('L4-M1d', 'Compteur débité 10→6', num(balA.available_days) === 6, `avail=${balA.available_days}`)

    const rA = await apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: reqA.insertId } })
    const [[lot1r]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1.id])
    const [[lot2r]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2.id])
    const [[balAr]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colA.id])
    rec('L4-M1e', 'Restitution des deux lots (3 et 2, compteur 10)', rA.status === 201 && num(lot1r.remaining_days) === 3 && num(lot2r.remaining_days) === 2 && num(balAr.available_days) === 10, `lot1=${lot1r.remaining_days} lot2=${lot2r.remaining_days} avail=${balAr.available_days}`)

    // 4. Restitution après expiration.
    const [reqExp] = await addRequest(colA, '2027-02-01', '2027-02-02', 2)
    await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqExp.insertId, referencePeriod: '2026-2027' } })
    await conn.query("UPDATE carryover_lots SET status='EXPIRE' WHERE id=?", [lot1.id])
    const rExp = await apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: reqExp.insertId } })
    const [[lot1e]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1.id])
    const [regRows] = await conn.query('SELECT operation_type FROM lot_allocations WHERE leave_request_id=? AND operation_type=?', [reqExp.insertId, 'REGULARISATION'])
    rec('L4-M4', 'Restitution après expiration → régularisation RH (lot non recrédité)', rExp.status === 201 && regRows.length === 1 && num(lot1e.remaining_days) < 3, `régularisation=${regRows.length} lot1=${lot1e.remaining_days}`)

    // 6. Réservation + libération (lot frais indépendant de l'expiration).
    await addLot(colA, 'l3', 2, 2, 'ACTIF', '2027-04-15', 'CONFIRMEE', 1, '2025-2026')
    const [[lot3]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-${colA.id}-l3`])
    const [reqRes] = await addRequest(colA, '2027-03-01', '2027-03-02', 2, 'EN_ATTENTE_VALIDATION')
    const rRes = await apiRequest('/carryover-lots/allocations/reserve', { method: 'POST', token: rh, body: { leaveRequestId: reqRes.insertId, referencePeriod: '2026-2027' } })
    const [[lot3res]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot3.id])
    rec('L4-M6', 'Réservation (lot décrémenté, RESERVATION)', rRes.status === 201 && num(lot3res.remaining_days) === 0, `lot3=${lot3res.remaining_days}`)
    const rRel = await apiRequest('/carryover-lots/allocations/release', { method: 'POST', token: rh, body: { leaveRequestId: reqRes.insertId } })
    const [[lot3rel]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot3.id])
    rec('L4-M6b', 'Libération (lot restitué)', rRel.status === 201 && num(lot3rel.remaining_days) === 2, `lot3=${lot3rel.remaining_days}`)

    // ---- col-b : aucune lot (jours 100 % ordinaires), dédoublement interdit ----
    await addBalance(colB, '2025-2026', 'N-1', 10)
    await addBalance(colB, '2026-2027', 'N', 20)
    const [reqB] = await addRequest(colB, '2027-01-18', '2027-01-19', 2)
    const [[balB0]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colB.id])

    const cB = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqB.insertId, referencePeriod: '2026-2027' } })
    const [[balB1]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colB.id])
    rec('L4-M2', 'Sans lot éligible → jours ordinaires débités une fois', cB.status === 201 && num(balB0.available_days) === 10 && num(balB1.available_days) === 8, `avail=${balB1.available_days}`)

    const cB2 = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqB.insertId, referencePeriod: '2026-2027' } })
    rec('L4-M2b', 'Rejeu sans lot → refusé (409)', cB2.status === 409, `HTTP ${cB2.status}`)

    const [reqB2] = await addRequest(colB, '2027-02-08', '2027-02-09', 2)
    const [cB3a, cB3b] = await Promise.all([
      apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqB2.insertId, referencePeriod: '2026-2027' } }),
      apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqB2.insertId, referencePeriod: '2026-2027' } }),
    ])
    const st = [cB3a.status, cB3b.status].sort()
    const [[balB2]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colB.id])
    rec('L4-M2c', 'Concurrence sans lot → un seul débit (1×201, 1×409)', st.join(',') === '201,409' && num(balB2.available_days) === 6, `HTTP ${st.join('/')} avail=${balB2.available_days}`)

    // ---- col-c : répartition entre plusieurs compteurs ----
    await addBalance(colC, '2024-2025', 'N-1', 2)
    await addBalance(colC, '2025-2026', 'N-1', 10)
    await addBalance(colC, '2026-2027', 'N', 20)
    await addLot(colC, 'c1', 3, 3, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026') // lot sur le SECOND N-1
    const [reqC] = await addRequest(colC, '2027-01-11', '2027-01-14', 4)
    const cC = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqC.insertId, referencePeriod: '2026-2027' } })
    const [[balC_2425]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [colC.id])
    const [[balC_2526]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colC.id])
    rec('L4-M3', 'Lot sur le 2e N-1 + ordinaire sur le 1er N-1', cC.status === 201 && num(balC_2425.available_days) === 1 && num(balC_2526.available_days) === 7, `2425=${balC_2425.available_days} 2526=${balC_2526.available_days}`)

    // 5. Incohérence DTO/demande : statut non VALIDEE + référence période inconnue.
    const [reqBad] = await addRequest(colA, '2027-04-01', '2027-04-02', 2, 'BROUILLON')
    const bad1 = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqBad.insertId, referencePeriod: '2026-2027' } })
    rec('L4-M5', 'Statut non VALIDEE refusé', bad1.status === 400, `HTTP ${bad1.status}`)
    const [reqOk] = await addRequest(colA, '2027-04-06', '2027-04-07', 2)
    const bad2 = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqOk.insertId, referencePeriod: '2099-2100' } })
    rec('L4-M5b', 'Période de référence inconnue refusée', bad2.status === 404, `HTTP ${bad2.status}`)

    // 8. Rollback : lot rattaché à un compteur épuisé → refus avant écriture.
    await addBalance(colP, '2025-2026', 'N-1', 0)
    await addBalance(colP, '2026-2027', 'N', 20)
    await addLot(colP, 'p1', 5, 5, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026')
    const [reqP] = await addRequest(colP, '2027-01-11', '2027-01-11', 1)
    const [[mvBefore]] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=?', [reqP.insertId])
    const cP = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqP.insertId, referencePeriod: '2026-2027' } })
    const [[mvAfter]] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=?', [reqP.insertId])
    rec('L4-M8', 'Incohérence compteur épuisé → refus, aucun mouvement écrit', cP.status === 400 && num(mvBefore.c) === 0 && num(mvAfter.c) === 0, `HTTP ${cP.status} mv=${mvAfter.c}`)

    // Sécurité : non-RH refusé.
    const denied = await apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: col, body: { leaveRequestId: reqA.insertId, referencePeriod: '2026-2027' } })
    rec('L4-SEC', 'Non-RH refusé (403)', denied.status === 403, `HTTP ${denied.status}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L4 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L4 :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
