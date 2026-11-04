// JUR-027 — E3-B : concurrence réelle sur les mêmes lots (consommation).
// Cible : gestion_conges_gmes_test. Flag CARRYOVER_LOTS_REAL_FLOW_ENABLED=true.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'CC' + Date.now().toString(36)
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`) }
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
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `CC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const addBalance = (emp, period, counter, avail) => conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp, period, counter, avail, avail])
  const addLot = (emp, key, remaining) => conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version) VALUES (?, '2024-2025', '2025-2026', 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-12-31', 'L3141-19-1', ?, 0)`, [emp, remaining, remaining, `${TAG}-${key}`])
  const mkUser = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `CC${suffix}`, prenom: 'CC', email: `cc${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2026-01-06' } })).data
  const rhDirect = (empId, s, e) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: lt.data.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  const today = martiniqueToday()
  const pastStart = nextWeekday(addDays(today, -4))

  // ── C1 : deux consommations simultanées, lot 1 j, aucun ordinaire → un seul gagnant ──
  {
    const c = await mkUser('A')
    await addBalance(c.id, '2025-2026', 'N-1', 1)
    await addBalance(c.id, '2026-2027', 'N', 0)
    await addLot(c.id, 'A', 1)
    const [r1, r2] = await Promise.allSettled([
      rhDirect(c.id, pastStart, pastStart),
      rhDirect(c.id, pastStart, pastStart),
    ])
    const s1 = r1.status === 'fulfilled' ? r1.value.status : 'ERR'; const b1 = r1.status === 'fulfilled' ? JSON.stringify(r1.value.data).slice(0, 160) : 'ERR'
    const s2 = r2.status === 'fulfilled' ? r2.value.status : 'ERR'; const b2 = r2.status === 'fulfilled' ? JSON.stringify(r2.value.data).slice(0, 160) : 'ERR'
    const [[lot]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-A`])
    const [ded] = await conn.query("SELECT COUNT(*) c, SUM(m.days) s FROM balance_movements m JOIN lot_allocations a ON a.movement_id=m.id WHERE m.movement_type='DEDUCTION' AND a.operation_type='CONSUMPTION' AND m.employee_id=?", [c.id])
    const one201 = [s1, s2].filter((s) => s === 201).length === 1
    const other409 = [s1, s2].filter((s) => s === 409).length === 1
    rec('C1', 'Deux consommations simultanées (mêmes dates) → un seul gagnant, aucun deadlock, aucune écriture double', one201 && other409 && num(lot.remaining_days) === 0 && num(ded[0].c) === 1 && num(ded[0].s) === 1, `http=${s1}/${s2} lot=${lot.remaining_days} ded=${ded[0].c} (${ded[0].s}j)`)
  }

  // ── C2 : deux consommations simultanées sur dates distinctes → sérialisation sans deadlock ──
  {
    const c = await mkUser('B')
    await addBalance(c.id, '2025-2026', 'N-1', 5)
    await addBalance(c.id, '2026-2027', 'N', 10)
    await addLot(c.id, 'B', 3)
    const day1 = pastStart
    const day2 = nextWeekday(addDays(pastStart, 1))
    const [r1, r2] = await Promise.allSettled([
      rhDirect(c.id, day1, day1),
      rhDirect(c.id, day2, day2),
    ])
    const s1 = r1.status === 'fulfilled' ? r1.value.status : 'ERR'
    const s2 = r2.status === 'fulfilled' ? r2.value.status : 'ERR'
    const [[lot]] = await conn.query('SELECT remaining_days FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-B`])
    const [ded] = await conn.query("SELECT COUNT(*) c, SUM(m.days) s FROM balance_movements m JOIN lot_allocations a ON a.movement_id=m.id WHERE m.movement_type='DEDUCTION' AND a.operation_type='CONSUMPTION' AND m.employee_id=?", [c.id])
    // Deux demandes distinctes × 1 jour = 2 jours couverts par le lot (3 j).
    rec('C2', 'Deux consommations simultanées (dates distinctes) → sérialisation sans deadlock', s1 === 201 && s2 === 201 && num(lot.remaining_days) === 1 && num(ded[0].s) === 2, `http=${s1}/${s2} lot=${lot.remaining_days} lotDed=${ded[0].c} (${ded[0].s}j)`)
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT CONCURRENCE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR CONCURRENCE :', e); process.exit(1) })
