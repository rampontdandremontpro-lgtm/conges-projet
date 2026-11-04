// Vérification flag OFF : CARRYOVER_LOTS_REAL_FLOW_ENABLED absent → comportement ordinaire inchangé.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'E3BOFF' + Date.now().toString(36)
const num = (v) => Number(v)
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function nextWeekday(iso) { let s = iso; for (let i = 0; i < 20; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = addDays(s, 1) } return s }

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `OFF-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const col = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: 'COLOFF', prenom: 'E3B', email: `coloff.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2026-01-06' } })).data
  await conn.query("INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, '2026-2027', 'N-1', 10, 10, 0, 0)", [col.id])
  await conn.query("INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, '2026-2027', 'N', 20, 20, 0, 0)", [col.id])
  await conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version) VALUES (?, '2024-2025', '2026-2027', 'N-1', 2, 2, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-12-31', 'L3141-19-1', ?, 0)`, [col.id, `${TAG}-lot`])
  const [[lot]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-lot`])

  const today = new Date().toISOString().slice(0, 10)
  const pastStart = nextWeekday(addDays(today, -4))
  const pastEnd = nextWeekday(addDays(pastStart, 1))
  const direct = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: col.id, leaveTypeId: lt.data.id, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  const [[lotAfter]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot.id])
  const [allocs] = await conn.query("SELECT COUNT(*) c FROM lot_allocations WHERE leave_request_id=?", [direct.data?.id])
  const [[bal]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2026-2027' AND counter_type='N-1'", [col.id])

  const lotUntouched = num(lotAfter.remaining_days) === 2
  const ordinaryDebited = num(bal.consumed_days) === 2
  const noLotAlloc = num(allocs[0].c) === 0
  console.log(`${lotUntouched && ordinaryDebited && noLotAlloc ? 'OK ' : 'KO '} FLAG OFF → ordinaire uniquement (lot intact=${lotAfter.remaining_days}, ordinaire consommé=${bal.consumed_days}, allocations lot=${allocs[0].c})`)
  await conn.end()
  process.exitCode = lotUntouched && ordinaryDebited && noLotAlloc ? 0 : 1
}

main().catch((e) => { console.error('ERREUR FLAG OFF :', e); process.exit(1) })
