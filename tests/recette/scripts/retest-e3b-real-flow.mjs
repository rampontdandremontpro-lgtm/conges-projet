// JUR-027 — E3-B : raccordement fonctionnel réel (flag CARRYOVER_LOTS_REAL_FLOW_ENABLED).
// Cible impérative : gestion_conges_gmes_test (API sur 3001).
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'E3B' + Date.now().toString(36)
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const p = (t) => parts.find((e) => e.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function nextWeekday(iso) { let s = iso; for (let i = 0; i < 20; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = addDays(s, 1) } return s }

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const dirToken = await login('directeur.recette@gmes.fr')

  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const ltId = lt.data.id

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `E3B-SANS-RESP-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const svcId = svc.data.id

  // Crée un collaborateur isolé avec ses compteurs + un lot maladie.
  const setupEmployee = async (suffix, lotRemaining) => {
    const col = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `COL${suffix}`, prenom: 'E3B', email: `col${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, hireDate: '2026-01-06' } })).data
    const colToken = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })
    await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [col.id, '2025-2026', 'N-1', 10, 10])
    await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [col.id, '2026-2027', 'N', 20, 20])
    if (lotRemaining > 0) {
      await conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version) VALUES (?, '2024-2025', '2025-2026', 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-12-31', 'L3141-19-1', ?, 0)`, [col.id, lotRemaining, lotRemaining, `${TAG}-${suffix}-lot`])
    }
    const [[lot]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-${suffix}-lot`])
    return { col, colToken, lotId: lot?.id ?? null }
  }

  const today = martiniqueToday()
  const futureStart = nextWeekday(addDays(today, 5))
  const futureEnd = nextWeekday(addDays(futureStart, 1))
  const pastStart = nextWeekday(addDays(today, -4))
  const pastEnd = nextWeekday(addDays(pastStart, 1))

  // ── A : congé futur validé → aucun débit (circuit RH → Directeur) ──
  const A = await setupEmployee('A', 4)
  const draftA = await apiRequest('/leave-requests', { method: 'POST', token: A.colToken, body: { leaveTypeId: ltId, startDate: futureStart, endDate: futureEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const reqA = draftA.data.id
  await apiRequest(`/leave-requests/${reqA}/submit`, { method: 'POST', token: A.colToken, body: { signatureType: 'INITIALS', signatureData: 'CF' } })
  await apiRequest(`/leave-requests/${reqA}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  const valA = await apiRequest(`/leave-requests/${reqA}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DIR' } })
  const [[lotA]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [A.lotId])
  const [mvA] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=?', [reqA])
  const [[reqArow]] = await conn.query('SELECT status, balance_processing_status FROM leave_requests WHERE id=?', [reqA])
  rec('A1', 'C1 futur validé (RH→Directeur) sans débit', valA.status === 200 && reqArow.status === 'VALIDEE' && num(lotA.remaining_days) === 4 && num(mvA[0].c) === 0, `lot=${lotA.remaining_days} mv=${mvA[0].c} bp=${reqArow.balance_processing_status}`)

  // ── B : congé déjà commencé → débit immédiat lots (RH direct) ──
  const B = await setupEmployee('B', 2)
  const directB = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: B.col.id, leaveTypeId: ltId, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const directBId = directB.data?.id
  const [[lotB]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [B.lotId])
  const [[balB]] = await conn.query("SELECT consumed_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [B.col.id])
  const [allocsB] = await conn.query("SELECT operation_type, days FROM lot_allocations WHERE leave_request_id=? AND operation_type='CONSUMPTION'", [directBId])
  rec('B1', 'RH direct (congé commencé) consomme le lot', directB.status === 201 && num(lotB.remaining_days) === 0 && num(balB.consumed_days) === 2 && allocsB.length === 1 && num(allocsB[0].days) === 2, `http=${directB.status} lot=${lotB.remaining_days} consumed=${balB.consumed_days} allocs=${allocsB.length}`)

  // ── C : consolidation scheduler (futur → début effectif) ──
  const C = await setupEmployee('C', 3)
  const draftC = await apiRequest('/leave-requests', { method: 'POST', token: C.colToken, body: { leaveTypeId: ltId, startDate: futureStart, endDate: futureEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const reqC = draftC.data.id
  await apiRequest(`/leave-requests/${reqC}/submit`, { method: 'POST', token: C.colToken, body: { signatureType: 'INITIALS', signatureData: 'CS' } })
  await apiRequest(`/leave-requests/${reqC}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  await apiRequest(`/leave-requests/${reqC}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DIR' } })
  await conn.query('UPDATE leave_requests SET start_date=?, end_date=?, balance_processing_status=? WHERE id=?', [pastStart, pastEnd, 'A_CONSOLIDER', reqC])
  await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
  const [[lotC]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [C.lotId])
  const [[reqCrow]] = await conn.query('SELECT balance_processing_status FROM leave_requests WHERE id=?', [reqC])
  const [allocsC] = await conn.query("SELECT operation_type, days FROM lot_allocations WHERE leave_request_id=? AND operation_type='CONSUMPTION'", [reqC])
  rec('C1', 'Consolidation scheduler consomme le lot au début effectif', num(lotC.remaining_days) === 1 && reqCrow.balance_processing_status === 'DEFINITIF' && allocsC.length === 1 && num(allocsC[0].days) === 2, `lot=${lotC.remaining_days} bp=${reqCrow.balance_processing_status} allocs=${allocsC.length}`)

  // ── D : annulation après consommation → restitution lots ──
  const D = await setupEmployee('D', 2)
  const directD = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: D.col.id, leaveTypeId: ltId, startDate: pastStart, endDate: pastEnd, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const directDId = directD.data?.id
  await apiRequest(`/leave-requests/${directDId}/cancellation-request`, { method: 'POST', token: rhToken, body: { reason: 'annulation test' } })
  const cancel = await apiRequest(`/leave-requests/${directDId}/cancellation-complete`, { method: 'POST', token: rhToken })
  const [[lotD]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE id=?', [D.lotId])
  const [[balD]] = await conn.query("SELECT consumed_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [D.col.id])
  const [recrD] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [directDId])
  rec('D1', 'Annulation après consommation restitue lot + recrédite', cancel.status === 200 && num(lotD.remaining_days) === 2 && num(balD.consumed_days) === 0 && num(recrD[0].c) >= 1, `http=${cancel.status} lot=${lotD.remaining_days} consumed=${balD.consumed_days} recredit=${recrD[0].c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT E3B-REAL-FLOW : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR E3B :', e); process.exit(1) })
