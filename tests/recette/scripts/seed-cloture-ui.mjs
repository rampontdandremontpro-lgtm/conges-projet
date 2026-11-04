// Seed isolé pour le test navigateur de la fenêtre « Clôture de période ».
// Base : gestion_conges_gmes_test (API 3001). Aucun effet sur la base réelle.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const TAG = 'UI' + Date.now().toString(36)

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
const colA = await login('col-a.recette@gmes.fr')
const colB = await login('col-b.recette@gmes.fr')
const colC = await login('col-c.recette@gmes.fr')
if (!rh || !admin || !colA || !colB || !colC) throw new Error('Connexion impossible')

const db = await dbConn()
const userId = async (email) => (await db.query(`SELECT id FROM users WHERE email=?`, [email]))[0][0].id
const colAId = await userId('col-a.recette@gmes.fr')
const colBId = await userId('col-b.recette@gmes.fr')
const colCId = await userId('col-c.recette@gmes.fr')

const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
await db.query(`UPDATE users SET service_id=? WHERE id IN (?, ?, ?)`, [svc.id, colAId, colBId, colCId])

const lt = (await apiRequest('/leave-types', { method: 'POST', token: rh, body: {
  name: 'Congés payés annuels ' + TAG, category: 'DEMANDE_CONGE',
  deductsPaidLeaveBalance: true, allowsDays: true, allowsHalfDays: true,
  employeeCanCreate: true, requiresValidation: true, rhOnly: false, documentRequired: false, documentCanBeAddedLater: false,
} })).data

// Soldes 2025-2026 (période N-1 par défaut) :
// col-a : reliquat N-1 7 j (report possible) + N 12 j.
// col-b : N-1 0 + N 10 j + une demande bloquante (en attente de validation).
// col-c : N-1 négatif (-3) pour tester le filtre « soldes négatifs ».
const bal = (employeeId, period, counter, acquired, reserved, consumed, available) =>
  db.query(
    `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [employeeId, period, counter, acquired, reserved, consumed, available],
  )

await bal(colAId, '2025-2026', 'N-1', 10, 0, 3, 7)
await bal(colAId, '2025-2026', 'N', 12, 0, 0, 12)
await bal(colBId, '2025-2026', 'N-1', 10, 0, 10, 0)
await bal(colBId, '2025-2026', 'N', 10, 0, 0, 10)
await bal(colCId, '2025-2026', 'N-1', 4, 0, 7, -3)

// Demande bloquante de col-b (en attente de validation) ramenée sur 2025-2026.
const draft = await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: lt.id, startDate: '2027-02-01', endDate: '2027-02-03', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
await apiRequest(`/leave-requests/${draft.data?.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
await db.query(`UPDATE leave_requests SET start_date='2026-04-10', end_date='2026-04-14', deducted_days=3 WHERE id=?`, [draft.data?.id])

// 2024-2025 : un compteur pour col-a, puis clôture réelle pour tester « Déjà clôturée ».
await bal(colAId, '2024-2025', 'N-1', 5, 0, 0, 5)
const close = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2024-2025', confirm: true } })

await db.end()

console.log('SEED OK')
console.log('leaveType:', lt.id, 'service:', svc.id)
console.log('bloquante:', draft.data?.id, 'status', close.status, '(', close.data?.message ?? 'clôturée', ')')
console.log('périodes : 2025-2026 = 3 collab (reliquat + bloquante + négatif), 2024-2025 = clôturée, 2023-2024 = vide, 2026-2027 = future')
