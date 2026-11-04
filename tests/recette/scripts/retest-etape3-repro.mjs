// Reproduction AVANT correction — Étape 3.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'E3R' + Date.now().toString(36)

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
const err = (r) => (r.data?.message ? JSON.stringify(r.data.message) : JSON.stringify(r.data ?? ''))

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
// Compteur N-1 2025-2026 pour rendre la période clôturable.
await sql((c) => c.query(
  `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
   VALUES (?, '2025-2026', 'N-1', 10, 0, 0, 10)`, [colAId]))

// --- Scénario A ---
const draftA = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: {
  leaveTypeId: lt.id, startDate: '2027-02-01', endDate: '2027-02-03', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
} })
rec('A : brouillon créé', draftA.status === 201 || draftA.status === 200, `HTTP ${draftA.status} ${err(draftA)}`)
const subA = await apiRequest(`/leave-requests/${draftA.data?.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
rec('A : soumission', subA.status === 200, `HTTP ${subA.status} ${err(subA)}`)

await sql((c) => c.query(
  `UPDATE leave_requests SET start_date='2026-04-10', end_date='2026-04-14', deducted_days=3 WHERE id=?`, [draftA.data?.id]))

const closeA = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
rec('A : clôture 2025-2026 acceptée malgré demande en attente', closeA.status === 201 || closeA.status === 200, `HTTP ${closeA.status} ${err(closeA)}`)

const v1 = await apiRequest(`/leave-requests/${draftA.data?.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
rec('A : validation RH (1er niveau) après clôture', v1.status === 200, `HTTP ${v1.status} ${err(v1)}`)
const v2 = await apiRequest(`/leave-requests/${draftA.data?.id}/validate`, { method: 'POST', token: directeur, body: { signatureType: 'INITIALS', signatureData: 'DI' } })
rec('A : validation Directeur (finale) après clôture', v2.status === 200, `HTTP ${v2.status} ${err(v2)}`)

const balA = await sql((c) => c.query(
  `SELECT counter_type, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' ORDER BY counter_type`, [colAId]))
const nA = balA[0].find((b) => b.counter_type === 'N')
rec('A : BUG — compteur N de la période clôturée modifié (négatif)', Number(nA?.available_days) < 0, JSON.stringify(balA[0]))

// --- Scénario B ---
const directB = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: {
  employeeId: colAId, leaveTypeId: lt.id, startDate: '2026-12-15', endDate: '2026-12-16', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
} })
rec('B : congé direct RH (validé, non imputé)', directB.status === 201 || directB.status === 200, `HTTP ${directB.status} ${err(directB)}`)
if (directB.data?.id) {
  await sql((c) => c.query(
    `UPDATE leave_requests SET start_date='2026-04-15', end_date='2026-04-16', balance_processing_status='DEMANDE_ACTUELLE' WHERE id=?`, [directB.data?.id]))
  const maint = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
  rec('B : maintenance de consolidation exécutée', maint.status === 200, `HTTP ${maint.status}`)
  const balB = await sql((c) => c.query(
    `SELECT counter_type, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' ORDER BY counter_type`, [colAId]))
  const nB = balB[0].find((b) => b.counter_type === 'N')
  rec('B : BUG — consolidation sur la période clôturée', Number(nB?.available_days) < 0, JSON.stringify(balB[0]))
}

// --- Scénario C ---
const directC = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: {
  employeeId: colAId, leaveTypeId: lt.id, startDate: '2025-04-01', endDate: '2025-04-02', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
} })
rec('C : congé direct imputé (début passé)', directC.status === 201 || directC.status === 200, `HTTP ${directC.status} deducted=${directC.data?.deductedDays} ${err(directC)}`)
const closeC = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2024-2025', confirm: true } })
rec('C : clôture 2024-2025 acceptée (normal)', closeC.status === 201 || closeC.status === 200, `HTTP ${closeC.status} ${err(closeC)}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
