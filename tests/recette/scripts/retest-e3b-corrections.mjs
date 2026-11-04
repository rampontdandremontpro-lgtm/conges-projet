// JUR-027 — E3-B : corrections comptables (restitution mixte, multi-périodes, protections).
// Cible : gestion_conges_gmes_test uniquement. Flag CARRYOVER_LOTS_REAL_FLOW_ENABLED=true.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'E3BC' + Date.now().toString(36)
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`) }
const num = (v) => Number(v)
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function nextWeekday(iso) { let s = iso; for (let i = 0; i < 20; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = addDays(s, 1) } return s }

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })

  const addBalance = (emp, period, counter, avail) => conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp, period, counter, avail, avail])
  const addLot = (emp, key, remaining, target) => conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version) VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-12-31', 'L3141-19-1', ?, 0)`, [emp, target, remaining, remaining, `${TAG}-${key}`])

  const mkUser = async (suffix) => {
    const col = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `C${suffix}`, prenom: 'E3B', email: `c${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2026-01-06' } })).data
    return col
  }

  const today = new Date().toISOString().slice(0, 10)
  const pastStart = nextWeekday(addDays(today, -4))
  const pastEnd = nextWeekday(addDays(pastStart, 2)) // 3 jours

  // ── E1 : restitution mixte (2 lot + 1 ordinaire, même N-1) ──
  const c1 = await mkUser('E1')
  await addBalance(c1.id, '2025-2026', 'N-1', 10)
  await addBalance(c1.id, '2026-2027', 'N', 0)
  await addLot(c1.id, 'e1', 2, '2025-2026')
  const [[lot1]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-e1`])
  const d1 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: c1.id, leaveTypeId: lt.data.id, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const d1Id = d1.data?.id
  const [[bal1a]] = await conn.query("SELECT consumed_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c1.id])
  const [[lot1a]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1.id])
  await apiRequest(`/leave-requests/${d1Id}/cancellation-request`, { method: 'POST', token: rhToken, body: { reason: 'annulation' } })
  const cancel1 = await apiRequest(`/leave-requests/${d1Id}/cancellation-complete`, { method: 'POST', token: rhToken })
  const [[bal1b]] = await conn.query("SELECT consumed_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c1.id])
  const [[lot1b]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1.id])
  const [rec1] = await conn.query("SELECT COUNT(*) c, SUM(days) s FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [d1Id])
  rec('E1', 'Restitution mixte 2 lot + 1 ordinaire, une seule fois', d1.status === 201 && num(bal1a.consumed_days) === 3 && num(lot1a.remaining_days) === 0 && cancel1.status === 200 && num(bal1b.consumed_days) === 0 && num(bal1b.available_days) === 10 && num(lot1b.remaining_days) === 2 && num(rec1[0].c) === 2 && num(rec1[0].s) === 3, `consommé=${bal1a.consumed_days} lot=${lot1a.remaining_days}→${lot1b.remaining_days} recrédit=${rec1[0].s}`)

  // ── E2 : multi-périodes N-1 ──
  const c2 = await mkUser('E2')
  await addBalance(c2.id, '2024-2025', 'N-1', 5)
  await addBalance(c2.id, '2025-2026', 'N-1', 10)
  await addBalance(c2.id, '2026-2027', 'N', 0)
  await addLot(c2.id, 'e2a', 2, '2024-2025')
  await addLot(c2.id, 'e2b', 3, '2025-2026')
  const [[lot2a]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-e2a`])
  const [[lot2b]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-e2b`])
  const d2 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: c2.id, leaveTypeId: lt.data.id, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const d2Id = d2.data?.id
  const [[bal2a]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [c2.id])
  const [[bal2b]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c2.id])
  const [[lot2aa]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2a.id])
  const [[lot2bb]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2b.id])
  rec('E2', 'Consommation sur deux périodes N-1, compteurs corrects', d2.status === 201 && num(lot2aa.remaining_days) === 0 && num(lot2bb.remaining_days) === 2 && num(bal2a.consumed_days) === 2 && num(bal2b.consumed_days) === 1, `lotA=${lot2aa.remaining_days} lotB=${lot2bb.remaining_days} balA=${bal2a.consumed_days} balB=${bal2b.consumed_days}`)

  // ── E3 : protections des jours ordinaires (gelés) ──
  const c3 = await mkUser('E3')
  await addBalance(c3.id, '2025-2026', 'N-1', 10)
  await addBalance(c3.id, '2026-2027', 'N', 0)
  await addLot(c3.id, 'e3', 6, '2025-2026')
  const [[lot3]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-e3`])
  await conn.query("UPDATE carryover_lots SET expires_at='2026-10-01' WHERE id=?", [lot3.id]) // échéance dépassée → jours ordinaires
  const [[bal3]] = await conn.query("SELECT id FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c3.id])
  await conn.query("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, frozen_in_balance, days, covered_dates, actor_id, reason) VALUES (?, NULL, NULL, ?, 'REGULARISATION', 1, 2, NULL, NULL, 'gel')", [lot3.id, bal3.id])
  const d3 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: c3.id, leaveTypeId: lt.data.id, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  rec('E3', 'Jours protégés/gelés non consommables en ordinaire (refus)', d3.status === 400, `http=${d3.status}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT E3B-CORRECTIONS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR E3BC :', e); process.exit(1) })
