// JUR-027 — Lot L4 : vérifications finales (isolation des droits protégés +
// cycle réservation → validation → consommation).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l4-isolation.json')

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
    const tag = 'ISO' + Date.now().toString(36)

    const [lt] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP-${tag}`])
    const ltId = lt.insertId

    const addBalance = (emp, period, counter, available) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp.id, period, counter, available, available])
    const addLot = (emp, key, days, remaining, status, expires, confirmation, reconciled, target, idemKey) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', ?, '2026-06-25', 1, ?, ?, ?, 'L3141-19-1', ?, 0)`,
        [emp.id, target, days, remaining, status, confirmation, reconciled, expires, `${tag}-${idemKey}`],
      )
    const addRequest = (emp, start, end, deducted, status = 'VALIDEE') =>
      conn.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DEFINITIF')`,
        [emp.id, ltId, start, end, deducted, deducted, status],
      )

    const consume = (reqId) => apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: reqId, referencePeriod: '2026-2027' } })

    // ===== 1. Isolation des droits protégés =====
    // 1a. Compteur 6j = 2 ordinaires + 4 protégés (A_VERIFIER, reliquat connu).
    await addBalance(colC, '2025-2026', 'N-1', 6)
    await addBalance(colC, '2026-2027', 'N', 0)
    await addLot(colC, 'p', 4, 4, 'A_VERIFIER', null, null, 1, '2025-2026', 'p')
    const [r2] = await addRequest(colC, '2027-01-11', '2027-01-12', 2)
    const c2 = await consume(r2.insertId)
    rec('ISO-1a', 'Compteur 6j (2 ord + 4 protégés) : demande 2j OK', c2.status === 201, `HTTP ${c2.status}`)
    const [r3] = await addRequest(colC, '2027-01-18', '2027-01-20', 3)
    const c3 = await consume(r3.insertId)
    rec('ISO-1b', 'Demande 3j refusée (2 ordinaires seulement)', c3.status === 400, `HTTP ${c3.status}`)

    // 1b. Lot expiré toujours présent (reliquat connu 4) → non consommable en ordinaire.
    await addBalance(colB, '2025-2026', 'N-1', 6)
    await addBalance(colB, '2026-2027', 'N', 0)
    await addLot(colB, 'e', 4, 4, 'EXPIRE', '2026-10-01', 'CONFIRMEE', 1, '2025-2026', 'e')
    const [re2] = await addRequest(colB, '2027-01-11', '2027-01-12', 2)
    const ce2 = await consume(re2.insertId)
    rec('ISO-1c', 'Lot expiré présent : 2 ordinaires utilisables', ce2.status === 201, `HTTP ${ce2.status}`)
    await conn.query('DELETE FROM carryover_lots WHERE idempotency_key=?', [`${tag}-e`])

    // 1c. Lot reliquat inconnu → refus (origine indémontrable).
    await addBalance(colP, '2025-2026', 'N-1', 5)
    await addBalance(colP, '2026-2027', 'N', 0)
    await addLot(colP, 'u', 2, null, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026', 'u')
    const [ru] = await addRequest(colP, '2027-01-11', '2027-01-11', 1)
    const cu = await consume(ru.insertId)
    rec('ISO-1d', 'Reliquat inconnu → refus (vérification RH)', cu.status === 400, `HTTP ${cu.status}`)

    // 1d. Reliquat 20j > compteur 10j → incohérence signalée même pour 1j.
    await addBalance(colA, '2025-2026', 'N-1', 10)
    await addBalance(colA, '2026-2027', 'N', 20)
    await addLot(colA, 'big', 20, 20, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026', 'big')
    const [rb] = await addRequest(colA, '2027-02-01', '2027-02-01', 1)
    const cb = await consume(rb.insertId)
    rec('ISO-1e', 'Reliquat 20j > compteur 10j → incohérence signalée (1j)', cb.status === 400, `HTTP ${cb.status}`)

    // 1e. Compteur exclusivement ordinaire (sans lot) → fonctionne.
    const [rc] = await addRequest(colA, '2027-02-08', '2027-02-10', 3)
    // colA a un lot incohérent (20j) → supprime-le pour ce scénario.
    await conn.query("DELETE FROM carryover_lots WHERE idempotency_key=?", [`${tag}-big`])
    const cc = await consume(rc.insertId)
    rec('ISO-1f', 'Compteur sans lot → jours ordinaires fonctionnent', cc.status === 201, `HTTP ${cc.status}`)

    // ===== 2. Cycle réservation → validation → consommation =====
    const [lt2] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP2-${tag}`])
    const lt2Id = lt2.insertId
    await addLot(colA, 'r1', 5, 5, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026', 'r1')
    const [[lotR]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-r1`])
    const addRequest2 = (start, end, status) =>
      conn.query('INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [colA.id, lt2Id, start, end, 2, 2, status, status === 'VALIDEE' ? 'DEFINITIF' : 'DEMANDE_ACTUELLE'])

    const [rq1] = await addRequest2('2027-03-01', '2027-03-02', 'EN_ATTENTE_VALIDATION')
    const reserve1 = await apiRequest('/carryover-lots/allocations/reserve', { method: 'POST', token: rh, body: { leaveRequestId: rq1.insertId, referencePeriod: '2026-2027' } })
    const [[lotR1]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotR.id])
    rec('ISO-2a', 'Réservation (soumise) : lot 5→3', reserve1.status === 201 && num(lotR1.remaining_days) === 3, `lot=${lotR1.remaining_days}`)

    const finVal = await apiRequest('/carryover-lots/allocations/finalize', { method: 'POST', token: rh, body: { leaveRequestId: rq1.insertId, decision: 'VALIDATE' } })
    const [[lotR2]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotR.id])
    const [[balR]] = await conn.query("SELECT available_days, reserved_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [colA.id])
    rec('ISO-2b', 'Validation : transformation sans double décrément (lot=3)', finVal.status === 201 && num(lotR2.remaining_days) === 3, `lot=${lotR2.remaining_days}`)
    rec('ISO-2c', 'Compteur : réservé 0, disponible 5 (consommé 5 cumulé)', num(balR.reserved_days) === 0 && num(balR.available_days) === 5, `res=${balR.reserved_days} cons=${balR.consumed_days} avail=${balR.available_days}`)

    const [rq2] = await addRequest2('2027-03-08', '2027-03-09', 'EN_ATTENTE_VALIDATION')
    await apiRequest('/carryover-lots/allocations/reserve', { method: 'POST', token: rh, body: { leaveRequestId: rq2.insertId, referencePeriod: '2026-2027' } })
    const finRef = await apiRequest('/carryover-lots/allocations/finalize', { method: 'POST', token: rh, body: { leaveRequestId: rq2.insertId, decision: 'REFUSE' } })
    const [[lotR3]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotR.id])
    rec('ISO-2d', 'Refus : libération exacte (lot 3→1 puis 1→3)', finRef.status === 201 && num(lotR3.remaining_days) === 3, `lot=${lotR3.remaining_days}`)

    // ===== 3. Panne injectée (rollback intégral) =====
    await addLot(colB, 'f1', 2, 2, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026', 'f1')
    await addLot(colB, 'f2', 2, 2, 'ACTIF', '2027-06-30', 'CONFIRMEE', 1, '2025-2026', 'f2')
    const [[lf1]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-f1`])
    const [[lf2]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-f2`])
    const [rf] = await addRequest(colB, '2027-04-05', '2027-04-07', 3)
    // Pré-insère un doublon CONSUMPTION pour lot2 afin de faire échouer la 2e écriture.
    await conn.query("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, days, covered_dates, actor_id) VALUES (?, ?, NULL, NULL, 'CONSUMPTION', 1, NULL, NULL)", [lf2.id, rf.insertId])
    const [[l1before]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lf1.id])
    const cf = await consume(rf.insertId)
    const [[l1after]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lf1.id])
    const [[mvCount]] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=?', [rf.insertId])
    const [allocL1] = await conn.query('SELECT COUNT(*) c FROM lot_allocations WHERE leave_request_id=? AND lot_id=? AND operation_type=?', [rf.insertId, lf1.id, 'CONSUMPTION'])
    rec('ISO-3', 'Panne après 1re écriture → rollback intégral (409, lot1 intact, 0 mouvement)', cf.status === 409 && num(l1after.remaining_days) === num(l1before.remaining_days) && num(mvCount.c) === 0 && num(allocL1[0].c) === 0, `HTTP ${cf.status} lot1=${l1after.remaining_days} mv=${mvCount.c}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L4-ISO : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L4-ISO :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
