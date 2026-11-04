// JUR-027 — L7 complément : intégration 4 circuits, arrêt long, multi-périodes,
// reports+maladie simultanés, dates contrôlées, absence d'envoi réel.
// Cible IMPÉRATIVE : gestion_conges_gmes_test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l7-complement.json')
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)
const TAG = 'L7C' + Date.now().toString(36)

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = isoAddDays(s, 1) }
  return s
}
const todayIso = () => new Date().toISOString().slice(0, 10)
let farCursor = isoAddDays(todayIso(), 40)
let nearCursor = isoAddDays(todayIso(), 3)
function nextFar() { farCursor = advanceToWeekday(farCursor); const d = farCursor; farCursor = isoAddDays(farCursor, 1); return d }
function nextNear() { nearCursor = advanceToWeekday(nearCursor); const d = nearCursor; nearCursor = isoAddDays(nearCursor, 1); return d }
function martiniqueCivilDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const p = (t) => parts.find((e) => e.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

async function main() {
  const conn = await dbConn()
  try {
    const db = async (sql, params = []) => (await conn.query(sql, params))[0]

    const adminToken = await login('admin.recette@gmes.fr')
    const rhToken = await login('rh.recette@gmes.fr')
    const dirToken = await login('directeur.recette@gmes.fr')
    const respToken = await login('responsable.recette@gmes.fr')
    const me = async (token) => (await apiRequest('/users/me', { token })).data
    const rhId = (await me(rhToken)).id
    const dirId = (await me(dirToken)).id
    const respId = (await me(respToken)).id

    const createService = async (name, extra = {}) => {
      const r = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
      if (r.status !== 201) throw new Error('service POST ' + r.status)
      if (Object.keys(extra).length > 0) {
        const patch = await apiRequest(`/services/${r.data.id}`, { method: 'PATCH', token: adminToken, body: { ...extra, takeoverDelayDays: 7 } })
        if (patch.status !== 200) throw new Error('service PATCH ' + patch.status + ' ' + JSON.stringify(patch.data))
        return patch.data
      }
      return r.data
    }
    const createUser = async (nom, prenom, role, serviceId, extra = {}) => {
      const r = await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom, prenom, email: `${nom}.${prenom}.${TAG}@recette.fr`, role, employmentType: 'INTERNE', serviceId, hireDate: '2026-01-06', ...extra } })
      if (r.status !== 201) throw new Error('user ' + r.status + ' ' + JSON.stringify(r.data))
      return r.data
    }
    const setUserService = async (userId, serviceId) => {
      const r = await apiRequest(`/users/${userId}`, { method: 'PATCH', token: adminToken, body: { serviceId } })
      if (r.status !== 200) throw new Error('setUserService ' + r.status)
      return r.data
    }
    const createLeaveType = async (label, extra = {}) => {
      const r = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, requiresValidation: true, ...extra } })
      if (r.status !== 201) throw new Error('leave-type ' + r.status)
      return r.data
    }
    const submit = (token, id) => apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
    const validate = (token, id, init) => apiRequest(`/leave-requests/${id}/validate`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: init } })

    // ── 1. Intégration des 4 circuits (VALID) avec droits maladie ──────────
    const leaveType = await createLeaveType('INTEG')
    const svcSans = await createService(`INTEG-SANS-${TAG}`)
    const svcAvec = await createService(`INTEG-AVEC-${TAG}`)
    await setUserService(respId, svcAvec.id)
    const svcAvecPatched = await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    const svcAvecFinal = svcAvecPatched.data

    const runCircuit = async (circuit, { derogation, first, second, employee, getDate }) => {
      const token = signAccessToken({ id: employee.id, email: employee.email, role: 'COLLABORATEUR' })
      const startDate = getDate()
      const [lotBefore] = await db('SELECT remaining_days FROM carryover_lots WHERE employee_id=?', [employee.id])
      const [balBefore] = await db("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [employee.id])
      const draft = await apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: leaveType.id, startDate, endDate: startDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
      let derogationStatus = null
      if (derogation) {
        const der = await apiRequest('/derogations', { method: 'POST', token, body: { leaveRequestId: draft.data.id, reason: 'dérogation test' } })
        derogationStatus = der.status
      }
      const sub = await submit(token, draft.data.id)
      const v1 = await validate(first.token, draft.data.id, first.init)
      const v2 = await validate(second.token, draft.data.id, second.init)
      const [row] = await db('SELECT status FROM leave_requests WHERE id=?', [draft.data.id])
      const [lotAfter] = await db('SELECT remaining_days FROM carryover_lots WHERE employee_id=?', [employee.id])
      const [balAfter] = await db("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2024-2025' AND counter_type='N-1'", [employee.id])
      const derOk = derogation ? derogationStatus === 201 : true
      const ok = draft.status === 201 && derOk && sub.status === 200 && v1.status === 200 && v2.status === 200 && row.status === 'VALIDEE' && num(lotAfter.remaining_days) === num(lotBefore.remaining_days) && num(balAfter.available_days) === num(balBefore.available_days)
      rec(`G${circuit}`, `Circuit ${circuit} : validation bout-en-bout VALIDEE, lot et solde intacts`, ok, `derog=${derogationStatus} sub=${sub.status} v1=${v1.status} v2=${v2.status} status=${row.status} lot=${lotBefore.remaining_days}→${lotAfter.remaining_days} bal=${balBefore.available_days}→${balAfter.available_days}`)
    }

    const empSans = await createUser('SANSR', 'Sans', 'COLLABORATEUR', svcSans.id)
    const empAvec = await createUser('AVECR', 'Avec', 'COLLABORATEUR', svcAvec.id)
    // Droits maladie (lot protégé) + ordinaire sur N-1 pour les deux salariés.
    for (const emp of [empSans, empAvec]) {
      await db('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [emp.id, '2024-2025', 'N-1', 10, 10, 0, 0])
      await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2024-2025', '2024-2025', 'N-1', 4, 4, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', ?, 0, '2025-05-31')", [emp.id, `L7C-${emp.id}`])
    }

    await runCircuit(1, { derogation: false, first: { token: rhToken, init: 'RH' }, second: { token: dirToken, init: 'DR' }, employee: empSans, getDate: nextFar })
    await runCircuit(2, { derogation: false, first: { token: respToken, init: 'RS' }, second: { token: rhToken, init: 'RH' }, employee: empAvec, getDate: nextFar })
    await runCircuit(3, { derogation: true, first: { token: rhToken, init: 'RH' }, second: { token: dirToken, init: 'DR' }, employee: empSans, getDate: nextNear })
    await runCircuit(4, { derogation: true, first: { token: rhToken, init: 'RH' }, second: { token: respToken, init: 'RS' }, employee: empAvec, getDate: nextNear })

    // ── Consommation L4 isolée (cas A) ──────────────────────────────────────
    const prevAlloc = await apiRequest(`/carryover-lots/employee/${empSans.id}/preview-allocation`, { method: 'POST', token: rhToken, body: { startDate: nextNear(), endDate: nextNear(), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    rec('G5-A', 'Consommation L4 isolée : allocation lot maladie accessible (preview)', [200, 201].includes(prevAlloc.status), `HTTP ${prevAlloc.status}`)
    // Raccordement automatique aux circuits (cas B) : NON TESTÉ / manquant.
    rec('G5-B', 'Raccordement automatique lots→circuits : NON TESTÉ (manquant)', false, 'non câblé — réserve technique')

    // ── 2. Arrêt long à la clôture ──────────────────────────────────────────
    const colA = (await db('SELECT id FROM users WHERE email=?', ['col-a.recette@gmes.fr']))[0].id
    await db('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colA, '2019-2020', 'N-1', 6, 6, 0, 0])
    await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2019-2020', '2019-2020', 'N-1', 6, 6, 'MALADIE', 'ARRET_LONG', 'A_VERIFIER', NULL, NULL, NULL, 1, NULL, 'L3141-19-2', 'L7C-AL', 0, '2020-05-31')", [colA])
    const closeAL = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rhToken, body: { referencePeriod: '2019-2020', confirm: true } })
    const [alAfter] = await db("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2019-2020' AND counter_type='N-1'", [colA])
    rec('G6', 'Arrêt long incertain → clôture bloquée sans remise à zéro', closeAL.status === 400 && num(alAfter.available_days) === 6, `HTTP ${closeAL.status} avail=${alAfter.available_days}`)

    // ── 3. Lots multi-périodes ──────────────────────────────────────────────
    const colB = (await db('SELECT id FROM users WHERE email=?', ['col-b.recette@gmes.fr']))[0].id
    await db('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colB, '2024-2025', 'N-1', 6, 6, 0, 0])
    await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2023-2024', '2024-2025', 'N-1', 3, 3, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', 'L7C-MP1', 0, '2024-05-31')", [colB])
    await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2022-2023', '2024-2025', 'N-1', 3, 3, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', 'L7C-MP2', 0, '2023-05-31')", [colB])
    const previewMP = await apiRequest('/carryover-lots/closure/2024-2025/preview', { token: rhToken })
    const countersMP = previewMP.data?.counters ?? []
    const colCounter = countersMP.find((c) => c.employeeId === colB)
    rec('G7', 'Lots multi-périodes : origines distinctes sans mélange', previewMP.status === 200 && num(colCounter?.protectedDays) === 6 && colCounter?.preservedLots?.length === 2, `prot=${colCounter?.protectedDays} lots=${colCounter?.preservedLots?.length}`)

    // ── 4. Reports exceptionnels + maladie simultanés (atomicité) ───────────
    const colC = (await db('SELECT id FROM users WHERE email=?', ['col-c.recette@gmes.fr']))[0].id
    await db('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colC, '2022-2023', 'N-1', 10, 10, 0, 0])
    await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2022-2023', '2022-2023', 'N-1', 8, 8, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', 'L7C-CR', 0, '2023-05-31')", [colC])
    const [r1, r2] = await Promise.all([
      apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rhToken, body: { employeeId: colC, closingReferencePeriod: '2022-2023', days: 3, reason: 'test' } }),
      apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rhToken, body: { employeeId: colC, closingReferencePeriod: '2022-2023', days: 2, reason: 'test' } }),
    ])
    const st = [r1.status, r2.status].sort()
    const [balCR] = await db("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2022-2023' AND counter_type='N-1'", [colC])
    rec('G8', 'Reports exceptionnels simultanés sur lot protégé → au plus un succès, sans double soustraction', (st.join(',') === '400,400') && num(balCR.available_days) === 10, `HTTP ${st.join('/')} avail=${balCR.available_days}`)

    // ── 5. Dates contrôlées (F8) ────────────────────────────────────────────
    const colP = (await db('SELECT id FROM users WHERE email=?', ['col-prorata.recette@gmes.fr']))[0].id
    await db("INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date) VALUES (?, '2024-2025', '2024-2025', 'N-1', 2, 2, 'MALADIE', 'GENERAL', 'ACTIF', NULL, 0, 'CONFIRMEE', 1, NULL, 'L3141-19-1', 'L7C-DT', 0, '2025-05-31')", [colP])
    const prepDT = await apiRequest('/carryover-notifications/prepare', { method: 'POST', token: rhToken, body: { employeeId: colP } })
    const nidDT = prepDT.data?.notificationId
    await apiRequest(`/carryover-notifications/${nidDT}/validate`, { method: 'POST', token: rhToken })
    await apiRequest(`/carryover-notifications/${nidDT}/transmit`, { method: 'POST', token: rhToken, body: { mode: 'SIMULATION' } })
    // Horaires maîtrisés : transmission fixée à T-2h (fixture), réceptions T-3h/T+1h/T-1h.
    const d = new Date(Date.now() - 2 * 3600000)
    const p = (n) => String(n).padStart(2, '0')
    await db('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, nidDT])
    const beforeDT = await apiRequest(`/carryover-notifications/${nidDT}/proofs`, { method: 'POST', token: rhToken, body: { mode: 'SIMULATION', receivedAt: new Date(Date.now() - 3 * 3600000).toISOString(), contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' } })
    const futureDT = await apiRequest(`/carryover-notifications/${nidDT}/proofs`, { method: 'POST', token: rhToken, body: { mode: 'SIMULATION', receivedAt: new Date(Date.now() + 3600000).toISOString(), contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' } })
    const okDT = await apiRequest(`/carryover-notifications/${nidDT}/proofs`, { method: 'POST', token: rhToken, body: { mode: 'SIMULATION', receivedAt: new Date(Date.now() - 3600000).toISOString(), contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' } })
    rec('G9', 'Dates contrôlées : avant=400, future=400, successif=201', beforeDT.status === 400 && futureDT.status === 400 && okDT.status === 201, `HTTP ${beforeDT.status}/${futureDT.status}/${okDT.status}`)

    // ── 6. Aucun envoi réel (code + base) ────────────────────────────────────
    const notifTypes = await db('SELECT DISTINCT type FROM notifications')
    const realSendTypes = notifTypes.filter((n) => /MAIL|SMS|EMAIL|COURRIER|SEND/i.test(n.type)).map((n) => n.type)
    rec('G10', 'Aucun envoi externe : aucune notification de type envoi réel', realSendTypes.length === 0, realSendTypes.join(',') || 'aucun')

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L7-COMPLÉMENT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L7-COMPLÉMENT :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
