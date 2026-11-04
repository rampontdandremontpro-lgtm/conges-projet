// JUR-027 — E3-B : matrice fonctionnelle réelle (C2/C3/C4, Directeur, demi-journées,
// mixte, lot expiré, rejeu scheduler, realBalanceAfter multi-périodes).
// Cible : gestion_conges_gmes_test. Flag CARRYOVER_LOTS_REAL_FLOW_ENABLED=true.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'MX' + Date.now().toString(36)
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
  const dirToken = await login('directeur.recette@gmes.fr')
  const respToken = await login('responsable.recette@gmes.fr')

  const me = async (token) => (await apiRequest('/users/me', { token })).data
  const rhId = (await me(rhToken)).id
  const dirId = (await me(dirToken)).id
  const respId = (await me(respToken)).id

  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const ltId = lt.data.id

  const mkService = async (name, primaryManagerId) => {
    const r = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
    if (primaryManagerId != null) {
      await apiRequest(`/services/${r.data.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    }
    return r.data
  }
  const svcSans = await mkService(`MX-SANS-${TAG}`)
  const svcAvec = await mkService(`MX-AVEC-${TAG}`) // sans primaryManager pour l'instant
  const svcDir = await mkService(`MX-DIR-${TAG}`)
  // Ordre impératif : rattacher le Responsable au service AVANT de le nommer primaryManager.
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: adminToken, body: { serviceId: svcAvec.id } })
  await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  await apiRequest(`/users/${dirId}`, { method: 'PATCH', token: adminToken, body: { serviceId: svcDir.id } })
  const ltDir = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })

  const addBalance = (emp, period, counter, avail, reserved = 0) => conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp, period, counter, avail, avail, reserved])
  const addLot = (emp, key, remaining, target, expires = '2027-12-31') => conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version) VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, ?, 'L3141-19-1', ?, 0)`, [emp, target, remaining, remaining, expires, `${TAG}-${key}`])
  const getLot = async (key) => { const [[r]] = await conn.query('SELECT id, remaining_days, expires_at FROM carryover_lots WHERE idempotency_key=?', [`${TAG}-${key}`]); return r }

  const mkUser = async (suffix, serviceId) => {
    const col = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `MX${suffix}`, prenom: 'MX', email: `mx${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId, hireDate: '2026-01-06' } })).data
    return { ...col, token: signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' }) }
  }
  // Employé standard avec lot + N-1 + N.
  const std = async (suffix, serviceId, { lot = 2, target = '2025-2026', n1 = 10, n = 20, expires = '2027-12-31' } = {}) => {
    const c = await mkUser(suffix, serviceId)
    await addBalance(c.id, '2025-2026', 'N-1', n1)
    await addBalance(c.id, '2026-2027', 'N', n)
    if (lot > 0) await addLot(c.id, suffix, lot, target, expires)
    const lotId = lot > 0 ? (await getLot(suffix)).id : null
    return { ...c, lotId }
  }

  const today = martiniqueToday()
  const futureStart = nextWeekday(addDays(today, 5))
  const farStart = nextWeekday(addDays(today, 40))
  const pastStart = nextWeekday(addDays(today, -4))
  const past2 = nextWeekday(addDays(pastStart, 2)) // 3 jours (lun..mer)

  const draft = (token, s, e) => apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: ltId, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const submit = (token, id) => apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'MX' } })
  const validate = (token, id) => apiRequest(`/leave-requests/${id}/validate`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'MX' } })
  const derog = (token, id) => apiRequest('/derogations', { method: 'POST', token, body: { leaveRequestId: id, reason: 'dérogation test' } })
  const rhDirect = (empId, s, e) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: ltId, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const mvCount = async (reqId, type) => { const [r] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE leave_request_id=? AND movement_type=?', [reqId, type]); return num(r[0].c) }
  const reqRow = async (id) => { const [[r]] = await conn.query('SELECT status, balance_processing_status, real_balance_after FROM leave_requests WHERE id=?', [id]); return r }

  // ── C2 : Responsable→RH, futur validé → aucun débit ──
  {
    const c = await std('C2', svcAvec.id, { lot: 2 })
    const d = await draft(c.token, farStart, farStart)
    await submit(c.token, d.data.id)
    const v1 = await validate(respToken, d.data.id)
    const v2 = await validate(rhToken, d.data.id)
    const lot = await getLot('C2')
    const row = await reqRow(d.data.id)
    rec('C2', 'Responsable→RH futur validé sans débit', v1.status === 200 && v2.status === 200 && row.status === 'VALIDEE' && num(lot.remaining_days) === 2 && (await mvCount(d.data.id, 'DEDUCTION')) === 0, `v1=${v1.status} v2=${v2.status} lot=${lot.remaining_days} status=${row.status} bp=${row.balance_processing_status}`)
  }

  // ── C3 : dérogation, RH→Directeur, futur validé → aucun débit ──
  {
    const c = await std('C3', svcSans.id, { lot: 2 })
    const d = await draft(c.token, futureStart, futureStart)
    await derog(c.token, d.data.id)
    await submit(c.token, d.data.id)
    const v1 = await validate(rhToken, d.data.id)
    const v2 = await validate(dirToken, d.data.id)
    const lot = await getLot('C3')
    const row = await reqRow(d.data.id)
    const [[dr]] = await conn.query('SELECT status FROM derogations WHERE leave_request_id=?', [d.data.id])
    rec('C3', 'RH→Directeur avec dérogation futur sans débit', v1.status === 200 && v2.status === 200 && row.status === 'VALIDEE' && dr.status === 'ACCORDEE' && num(lot.remaining_days) === 2 && (await mvCount(d.data.id, 'DEDUCTION')) === 0, `lot=${lot.remaining_days} der=${dr.status} bp=${row.balance_processing_status}`)
  }

  // ── C4 : dérogation, RH→Responsable, futur validé → aucun débit ──
  {
    const c = await std('C4', svcAvec.id, { lot: 2 })
    const d = await draft(c.token, futureStart, futureStart)
    await derog(c.token, d.data.id)
    await submit(c.token, d.data.id)
    const v1 = await validate(rhToken, d.data.id)
    const v2 = await validate(respToken, d.data.id)
    const lot = await getLot('C4')
    const row = await reqRow(d.data.id)
    rec('C4', 'RH→Responsable avec dérogation futur sans débit', v1.status === 200 && v2.status === 200 && row.status === 'VALIDEE' && num(lot.remaining_days) === 2 && (await mvCount(d.data.id, 'DEDUCTION')) === 0, `v1=${v1.status} v2=${v2.status} lot=${lot.remaining_days} status=${row.status} bp=${row.balance_processing_status}`)
  }

  // ── Directeur : congé commencé → débit immédiat lots ──
  {
    const dir = (await me(dirToken))
    await addBalance(dir.id, '2025-2026', 'N-1', 10)
    await addBalance(dir.id, '2026-2027', 'N', 20)
    await addLot(dir.id, 'DIR', 2, '2025-2026')
    const d = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: ltDir.data.id, startDate: pastStart, endDate: pastStart, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    const lot = await getLot('DIR')
    const row = await reqRow(d.data.id)
    const [[bal]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [dir.id])
    const [allocs] = await conn.query("SELECT operation_type FROM lot_allocations WHERE leave_request_id=? AND operation_type='CONSUMPTION'", [d.data.id])
    rec('DIR', 'Directeur congé commencé → débit immédiat lots', d.status === 201 && row.status === 'VALIDEE' && row.balance_processing_status === 'DEFINITIF' && num(lot.remaining_days) === 1 && num(bal.consumed_days) === 1 && allocs.length === 1 && row.real_balance_after != null, `http=${d.status} lot=${lot.remaining_days} consumed=${bal.consumed_days} rba=${row.real_balance_after}`)
  }

  // ── Demi-journées : 1 journée répartie sur 2 lots de 0,5 ──
  {
    const c = await mkUser('HD', svcSans.id)
    await addBalance(c.id, '2025-2026', 'N-1', 10)
    await addBalance(c.id, '2026-2027', 'N', 20)
    await addLot(c.id, 'HD1', 0.5, '2025-2026', '2027-01-01')
    await addLot(c.id, 'HD2', 0.5, '2025-2026', '2027-12-31')
    const d = await rhDirect(c.id, pastStart, pastStart)
    const lot1 = await getLot('HD1'); const lot2 = await getLot('HD2')
    const [allocs] = await conn.query("SELECT lot_id, days FROM lot_allocations WHERE leave_request_id=? AND operation_type='CONSUMPTION'", [d.data.id])
    rec('HD', 'Demi-journées 0,5 + 0,5 sur deux lots', d.status === 201 && num(lot1.remaining_days) === 0 && num(lot2.remaining_days) === 0 && allocs.length === 2 && num(allocs[0].days) + num(allocs[1].days) === 1, `lot1=${lot1.remaining_days} lot2=${lot2.remaining_days} allocs=${allocs.length}`)
  }

  // ── Mixte : lot 1j + ordinaire 2j ──
  {
    const c = await std('MIX', svcSans.id, { lot: 1, n1: 5, n: 10 })
    const d = await rhDirect(c.id, pastStart, past2)
    const lot = await getLot('MIX')
    const [[balN1]] = await conn.query("SELECT consumed_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c.id])
    const [[balN]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2026-2027' AND counter_type='N'", [c.id])
    const [allocs] = await conn.query("SELECT operation_type, days FROM lot_allocations WHERE leave_request_id=?", [d.data.id])
    const dedOrd = await mvCount(d.data.id, 'DEDUCTION')
    rec('MIX', 'Lot 1j + ordinaire 2j', d.status === 201 && num(lot.remaining_days) === 0 && num(balN1.consumed_days) === 3 && num(balN1.available_days) === 2 && num(balN.consumed_days) === 0 && allocs.length === 1 && dedOrd === 2, `lot=${lot.remaining_days} n1c=${balN1.consumed_days} n1a=${balN1.available_days} ded=${dedOrd}`)
  }

  // ── Lot expiré : annulation → REGULARISATION sans recrédit ──
  {
    const c = await std('EXP', svcSans.id, { lot: 2, n1: 10 })
    const d = await rhDirect(c.id, pastStart, pastStart)
    await conn.query('UPDATE carryover_lots SET expires_at=? WHERE idempotency_key=?', ['2026-10-01', `${TAG}-EXP`])
    await apiRequest(`/leave-requests/${d.data.id}/cancellation-request`, { method: 'POST', token: rhToken, body: { reason: 'annulation lot expiré' } })
    const cancel = await apiRequest(`/leave-requests/${d.data.id}/cancellation-complete`, { method: 'POST', token: rhToken })
    const lot = await getLot('EXP')
    const [[bal]] = await conn.query("SELECT consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c.id])
    const [reg] = await conn.query("SELECT operation_type FROM lot_allocations WHERE leave_request_id=? AND operation_type='REGULARISATION'", [d.data.id])
    const recr = await mvCount(d.data.id, 'RECREDIT')
    rec('EXP', 'Annulation après expiration → REGULARISATION sans recrédit', cancel.status === 200 && num(lot.remaining_days) === 1 && num(bal.consumed_days) === 1 && reg.length >= 1 && recr === 0, `http=${cancel.status} lot=${lot.remaining_days} consumed=${bal.consumed_days} reg=${reg.length} recr=${recr}`)
  }

  // ── Rejeu scheduler : un seul débit ──
  {
    const c = await std('REJ', svcSans.id, { lot: 2 })
    const d = await draft(c.token, futureStart, futureStart)
    await submit(c.token, d.data.id)
    await validate(rhToken, d.data.id)
    await validate(dirToken, d.data.id)
    await conn.query('UPDATE leave_requests SET start_date=?, end_date=?, balance_processing_status=? WHERE id=?', [pastStart, pastStart, 'A_CONSOLIDER', d.data.id])
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const after1 = await reqRow(d.data.id)
    const lotAfter1 = await getLot('REJ')
    const allocs1 = await mvCount(d.data.id, 'DEDUCTION')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const after2 = await reqRow(d.data.id)
    const lotAfter2 = await getLot('REJ')
    const allocs2 = await mvCount(d.data.id, 'DEDUCTION')
    rec('REJ', 'Rejeu scheduler → un seul débit (idempotence)', after1.balance_processing_status === 'DEFINITIF' && num(lotAfter1.remaining_days) === 1 && num(lotAfter2.remaining_days) === 1 && allocs1 === 1 && allocs2 === 1, `bp1=${after1.balance_processing_status} lot1=${lotAfter1.remaining_days} mv1=${allocs1} mv2=${allocs2}`)
  }

  // ── realBalanceAfter multi-périodes N-1 ──
  {
    const c = await mkUser('MP', svcSans.id)
    await addBalance(c.id, '2024-2025', 'N-1', 5)
    await addBalance(c.id, '2025-2026', 'N-1', 10)
    await addBalance(c.id, '2026-2027', 'N', 20)
    await addLot(c.id, 'MP1', 2, '2024-2025', '2027-01-01')
    await addLot(c.id, 'MP2', 3, '2025-2026', '2027-12-31')
    const d = await rhDirect(c.id, pastStart, past2) // 3 jours
    const row = await reqRow(d.data.id)
    const [[bA]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [c.id])
    const [[bB]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [c.id])
    const expectedRba = num(bA.available_days) + num(bB.available_days)
    rec('MP', 'realBalanceAfter multi-périodes = somme compteurs touchés', d.status === 201 && num(row.real_balance_after) === expectedRba && expectedRba === 12, `rba=${row.real_balance_after} expected=${expectedRba} (${bA.available_days}+${bB.available_days})`)
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT MATRICE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR MATRICE :', e); process.exit(1) })
