// JUR-027 — Lot L4 : corrections finales (ordinaire, régularisation expirée,
// finalisation unique).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l4-final.json')

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
    const rh = await login('rh.recette@gmes.fr')
    const tag = 'FIN' + Date.now().toString(36)

    const [lt] = await conn.query("INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)", [`CP-${tag}`])
    const ltId = lt.insertId
    const addBalance = (emp, period, counter, available) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp.id, period, counter, available, available])
    const addLot = (emp, key, days, remaining, status, expires) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version)
         VALUES (?, '2024-2025', '2025-2026', 'N-1', ?, ?, 'MALADIE', 'GENERAL', ?, '2026-06-25', 1, 'CONFIRMEE', 1, ?, 'L3141-19-1', ?, 0)`,
        [emp.id, days, remaining, status, expires, `${tag}-${key}`],
      )
    const addReq = (emp, start, end, deducted, status) =>
      conn.query('INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [emp.id, ltId, start, end, deducted, deducted, status, status === 'VALIDEE' ? 'DEFINITIF' : 'DEMANDE_ACTUELLE'])

    const reserve = (id) => apiRequest('/carryover-lots/allocations/reserve', { method: 'POST', token: rh, body: { leaveRequestId: id, referencePeriod: '2026-2027' } })
    const finalize = (id, decision) => apiRequest('/carryover-lots/allocations/finalize', { method: 'POST', token: rh, body: { leaveRequestId: id, decision } })
    const release = (id) => apiRequest('/carryover-lots/allocations/release', { method: 'POST', token: rh, body: { leaveRequestId: id } })
    const restore = (id) => apiRequest('/carryover-lots/allocations/restore', { method: 'POST', token: rh, body: { leaveRequestId: id } })
    const consume = (id) => apiRequest('/carryover-lots/allocations/consume', { method: 'POST', token: rh, body: { leaveRequestId: id, referencePeriod: '2026-2027' } })
    const bal = (emp) => conn.query("SELECT available_days, reserved_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [emp.id])

    // ===== 1. Demande 100 % ordinaire =====
    await addBalance(colA, '2025-2026', 'N-1', 10)
    await addBalance(colA, '2026-2027', 'N', 20)
    const [o1] = await addReq(colA, '2027-01-11', '2027-01-12', 2, 'EN_ATTENTE_VALIDATION')
    const resO1 = await reserve(o1.insertId)
    const [[bO1]] = await bal(colA)
    rec('FIN-1a', 'Réservation ordinaire (reserved=2)', resO1.status === 201 && num(bO1.reserved_days) === 2, `res=${bO1.reserved_days}`)
    const finO1 = await finalize(o1.insertId, 'VALIDATE')
    const [[bO2]] = await bal(colA)
    rec('FIN-1b', 'Finalisation ordinaire (réservé 0, consommé 2, disponible 8)', finO1.status === 201 && num(bO2.reserved_days) === 0 && num(bO2.consumed_days) === 2 && num(bO2.available_days) === 8, `res=${bO2.reserved_days} cons=${bO2.consumed_days} avail=${bO2.available_days}`)
    await conn.query("UPDATE leave_requests SET status='ANNULEE' WHERE id=?", [o1.insertId])
    const restO1 = await restore(o1.insertId)
    const [[bO3]] = await bal(colA)
    rec('FIN-1c', 'Restitution ordinaire exacte (disponible 10)', restO1.status === 201 && num(bO3.available_days) === 10 && num(bO3.consumed_days) === 0, `avail=${bO3.available_days}`)
    const restO1b = await restore(o1.insertId)
    rec('FIN-1d', 'Double restitution refusée', restO1b.status === 409, `HTTP ${restO1b.status}`)

    const [o2] = await addReq(colA, '2027-01-18', '2027-01-19', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(o2.insertId)
    const finO2 = await finalize(o2.insertId, 'REFUSE')
    const [[bO4]] = await bal(colA)
    rec('FIN-1e', 'Refus ordinaire → libération exacte (réservé 0, disponible 10)', finO2.status === 201 && num(bO4.reserved_days) === 0 && num(bO4.available_days) === 10, `res=${bO4.reserved_days} avail=${bO4.available_days}`)

    // ===== 2. Régularisation d'un lot expiré pendant une réservation =====
    await addBalance(colB, '2025-2026', 'N-1', 10)
    await addBalance(colB, '2026-2027', 'N', 0)
    await addLot(colB, 'x', 5, 5, 'ACTIF', '2027-06-30')
    const [[lotX]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-x`])
    const ordinaryUsable = async () => {
      const [[b]] = await bal(colB)
      const [[l]] = await conn.query("SELECT COALESCE(SUM(remaining_days),0) s FROM carryover_lots WHERE employee_id=? AND target_reference_period='2025-2026' AND target_counter_type='N-1' AND remaining_days IS NOT NULL", [colB.id])
      const [[f]] = await conn.query("SELECT COALESCE(SUM(la.days),0) s FROM lot_allocations la JOIN carryover_lots cl ON cl.id=la.lot_id WHERE cl.employee_id=? AND cl.target_reference_period='2025-2026' AND la.operation_type='REGULARISATION' AND la.frozen_in_balance=1", [colB.id])
      return num(b.available_days) - num(b.reserved_days) - num(l.s) - num(f.s)
    }
    const beforeOrd = await ordinaryUsable()
    const [x1] = await addReq(colB, '2027-02-01', '2027-02-02', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(x1.insertId)
    await conn.query("UPDATE carryover_lots SET status='EXPIRE' WHERE id=?", [lotX.id])
    const finX = await finalize(x1.insertId, 'REFUSE')
    const afterOrd = await ordinaryUsable()
    const [[lotXAfter]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotX.id])
    rec('FIN-2a', 'Régularisation : ordinaire utilisable inchangé (5 avant/après)', finX.status === 201 && beforeOrd === 5 && afterOrd === 5, `avant=${beforeOrd} après=${afterOrd}`)
    rec('FIN-2b', 'Lot expiré non recrédité', num(lotXAfter.remaining_days) === 3, `lot=${lotXAfter.remaining_days}`)

    const [x2] = await addReq(colB, '2027-02-08', '2027-02-11', 4, 'VALIDEE')
    const c5 = await consume(x2.insertId)
    rec('FIN-2c', '4 jours ordinaires consommables après régularisation', c5.status === 201, `HTTP ${c5.status}`)
    const [x3] = await addReq(colB, '2027-02-08', '2027-02-13', 6, 'VALIDEE')
    const c6 = await consume(x3.insertId)
    rec('FIN-2d', '6 jours refusés (pas de jours expirés rendus ordinaires)', c6.status === 400, `HTTP ${c6.status}`)

    // ===== 3. Finalisation unique et décisions contradictoires =====
    await addBalance(colC, '2025-2026', 'N-1', 10)
    await addBalance(colC, '2026-2027', 'N', 20)
    await addLot(colC, 'y', 3, 3, 'ACTIF', '2027-06-30')

    const [s1] = await addReq(colC, '2027-03-01', '2027-03-02', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(s1.insertId)
    const f1 = await finalize(s1.insertId, 'VALIDATE')
    const f1b = await finalize(s1.insertId, 'VALIDATE')
    const f1c = await finalize(s1.insertId, 'REFUSE')
    const r1 = await release(s1.insertId)
    rec('FIN-3a', 'VALIDATE une seule fois (2e VALIDATE, REFUSE, release → 409)', f1.status === 201 && f1b.status === 409 && f1c.status === 409 && r1.status === 409, `HTTP ${f1.status}/${f1b.status}/${f1c.status}/${r1.status}`)

    const [s2] = await addReq(colC, '2027-03-08', '2027-03-09', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(s2.insertId)
    const [cv1, cv2] = await Promise.all([finalize(s2.insertId, 'VALIDATE'), finalize(s2.insertId, 'VALIDATE')])
    rec('FIN-3b', 'Deux VALIDATE simultanés → un seul', [cv1.status, cv2.status].sort().join(',') === '201,409', `HTTP ${cv1.status}/${cv2.status}`)

    const [s3] = await addReq(colC, '2027-03-15', '2027-03-16', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(s3.insertId)
    const [cv3, cr3] = await Promise.all([finalize(s3.insertId, 'VALIDATE'), finalize(s3.insertId, 'REFUSE')])
    rec('FIN-3c', 'VALIDATE + REFUSE simultanés → un seul gagnant', [cv3.status, cr3.status].sort().join(',') === '201,409', `HTTP ${cv3.status}/${cr3.status}`)

    const [s4] = await addReq(colC, '2027-03-22', '2027-03-23', 2, 'EN_ATTENTE_VALIDATION')
    await reserve(s4.insertId)
    const f4 = await finalize(s4.insertId, 'REFUSE')
    const f4b = await finalize(s4.insertId, 'VALIDATE')
    rec('FIN-3d', 'REFUSE puis VALIDATE → refusé', f4.status === 201 && f4b.status === 409, `HTTP ${f4.status}/${f4b.status}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L4-FINAL : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L4-FINAL :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
