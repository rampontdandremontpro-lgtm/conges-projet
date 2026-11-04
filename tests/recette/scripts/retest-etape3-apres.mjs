// Test APRÈS correction — Étape 3 : la clôture bloque les demandes non imputées
// et les imputations tardives sur une période clôturée sont refusées.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'E3A' + Date.now().toString(36)

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
const directeur = await login('directeur.recette@gmes.fr')
const colA = await login('col-a.recette@gmes.fr')
if (!rh || !admin || !directeur || !colA) throw new Error('Connexion impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const msg = (r) => (r.data?.message ? String(r.data.message).slice(0, 90) : '')

async function sql(fn) {
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
  try { return await fn(c) } finally { await c.end() }
}

const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const lt = (await apiRequest('/leave-types', { method: 'POST', token: rh, body: {
  name: 'Congés payés annuels ' + TAG, category: 'DEMANDE_CONGE',
  deductsPaidLeaveBalance: true, allowsDays: true, allowsHalfDays: true,
  employeeCanCreate: true, requiresValidation: true, rhOnly: false, documentRequired: false, documentCanBeAddedLater: false,
} })).data
const colARow = await sql((c) => c.query(`SELECT id FROM users WHERE email='col-a.recette@gmes.fr'`))
const colAId = colARow[0][0].id
await sql((c) => c.query(`UPDATE users SET service_id = ? WHERE id = ?`, [svc.id, colAId]))

// --- Période 2025-2026 : demande en attente bloque la clôture ---
await sql((c) => c.query(`INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2025-2026', 'N-1', 10, 0, 0, 10)`, [colAId]))
const draft = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: lt.id, startDate: '2027-02-01', endDate: '2027-02-03', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
await apiRequest(`/leave-requests/${draft.data?.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
await sql((c) => c.query(`UPDATE leave_requests SET start_date='2026-04-10', end_date='2026-04-14', deducted_days=3 WHERE id=?`, [draft.data?.id]))

const c1 = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
rec('C1 : clôture BLOQUÉE par une demande en attente', c1.status === 400, `HTTP ${c1.status} ${msg(c1)}`)

// Refus de la demande → la clôture redevient possible.
await apiRequest(`/leave-requests/${draft.data?.id}/refuse`, { method: 'POST', token: rh, body: { comment: 'refus test' } })
const c2 = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
rec('C2 : clôture OK après refus de la demande', c2.status === 201 || c2.status === 200, `HTTP ${c2.status} ${msg(c2)}`)

// Imputation tardive sur la période clôturée → refusée.
const late = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: lt.id, startDate: '2027-03-01', endDate: '2027-03-03', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
await apiRequest(`/leave-requests/${late.data?.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
await sql((c) => c.query(`UPDATE leave_requests SET start_date='2026-04-20', end_date='2026-04-22', deducted_days=3 WHERE id=?`, [late.data?.id]))
await apiRequest(`/leave-requests/${late.data?.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
const vLate = await apiRequest(`/leave-requests/${late.data?.id}/validate`, { method: 'POST', token: directeur, body: { signatureType: 'INITIALS', signatureData: 'DI' } })
rec('C3 : validation finale sur période clôturée REFUSÉE', vLate.status === 400 || vLate.status === 409, `HTTP ${vLate.status} ${msg(vLate)}`)
const lateStatus = await sql((c) => c.query(`SELECT status FROM leave_requests WHERE id=?`, [late.data?.id]))
rec('C3 : la demande reste en attente (non validée)', lateStatus[0][0]?.status === 'EN_ATTENTE_VALIDATION', `status=${lateStatus[0][0]?.status}`)

// --- Période 2024-2025 : demande validée non imputée bloque la clôture ---
await sql((c) => c.query(`INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2024-2025', 'N-1', 8, 0, 0, 8)`, [colAId]))
const directB = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: { employeeId: colAId, leaveTypeId: lt.id, startDate: '2026-12-21', endDate: '2026-12-22', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
rec('C4 : création congé direct (non imputé)', directB.status === 201 || directB.status === 200, `HTTP ${directB.status} id=${directB.data?.id} ${msg(directB)}`)
await sql((c) => c.query(`UPDATE leave_requests SET start_date='2025-04-15', end_date='2025-04-16', balance_processing_status='DEMANDE_ACTUELLE' WHERE id=?`, [directB.data?.id]))
const c4 = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2024-2025', confirm: true } })
rec('C4 : clôture BLOQUÉE par une demande validée non imputée', c4.status === 400, `HTTP ${c4.status} ${msg(c4)}`)

// Passage en DEFINITIF (déjà imputée) → la clôture redevient possible.
await sql((c) => c.query(`UPDATE leave_requests SET balance_processing_status='DEFINITIF' WHERE id=?`, [directB.data?.id]))
const c5 = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2024-2025', confirm: true } })
rec('C5 : clôture OK après imputation définitive', c5.status === 201 || c5.status === 200, `HTTP ${c5.status} ${msg(c5)}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
