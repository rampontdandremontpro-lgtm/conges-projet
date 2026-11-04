// Vérifications techniques JUR-027 (report exceptionnel RH) et
// JUR-031 (absence déclarative « Congé d'adoption » sans déduction).
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR027' + Date.now().toString(36)

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
if (!rh || !admin) throw new Error('Connexion impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function sql(fn) {
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes_test' })
  try { return await fn(c) } finally { await c.end() }
}

// --- Préparation : service + collaborateur ---
const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const emp = (await apiRequest('/users', { method: 'POST', token: rh, body: {
  nom: 'REPORT', prenom: 'Maladie', email: `report.${TAG}@recette.fr`,
  role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-06', serviceId: svc.id,
} })).data

// Seed compteur N-1 2025-2026 (10 jours disponibles).
await sql((c) => c.query(
  `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
   VALUES (?, '2025-2026', 'N-1', 10, 0, 0, 10)`, [emp.id]))

// --- JUR-027 : report exceptionnel par la RH ---
const carry = await apiRequest('/leave-balances/period/carryover', {
  method: 'POST', token: rh,
  body: { employeeId: emp.id, closingReferencePeriod: '2025-2026', days: 4, reason: 'Arrêt maladie — congés non pris (L3141-19-1)' },
})
rec('JUR-027 : report exceptionnel accepté (HTTP 201/200)',
  carry.status === 201 || carry.status === 200, `HTTP ${carry.status}`)

const target = await apiRequest(
  `/leave-balances/employee/${emp.id}?referencePeriod=2026-2027&counterType=N-1`, { token: rh })
rec('JUR-027 : N-1 2026-2027 crédité de 4 jours (montant exact)',
  Number(target?.data?.[0]?.availableDays) === 4, `availableDays=${target?.data?.[0]?.availableDays}`)

const hist = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2026-2027`, { token: rh })
const mv = (hist.data ?? []).find((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL|2025-2026|'))
rec('JUR-027 : mouvement REPORT_EXCEPTIONNEL (distinct du transfert N→N-1)', Boolean(mv),
  `reason=${(mv?.reason ?? '').slice(0, 50)}`)
rec('JUR-027 : motif conservé dans la raison', String(mv?.reason ?? '').includes('L3141-19-1'), 'motif présent')
rec('JUR-027 : auteur enregistré (actorId RH)', Number(mv?.actorId ?? 0) > 0, `actorId=${mv?.actorId}`)
rec('JUR-027 : montant enregistré = 4 jours', Number(mv?.days) === 4, `days=${mv?.days}`)

const audits = await sql((c) => c.query(
  `SELECT COUNT(*) n FROM audit_logs WHERE action='EXCEPTIONAL_CARRYOVER_APPROVED' AND resource_id=${target?.data?.[0]?.id}`))
rec('JUR-027 : audit EXCEPTIONAL_CARRYOVER_APPROVED', audits[0][0].n === 1, `count=${audits[0][0].n}`)

const notifs = await sql((c) => c.query(
  `SELECT type, title FROM notifications WHERE user_id=${emp.id} AND type='EXCEPTIONAL_CARRYOVER_APPROVED' ORDER BY id DESC LIMIT 1`))
rec('JUR-027 : notification salarié EXCEPTIONAL_CARRYOVER_APPROVED', notifs[0].length === 1,
  notifs[0].length ? notifs[0][0].title : 'aucune')

// --- JUR-031 : absence déclarative « Congé d'adoption » sans déduction ---
const types = await apiRequest('/leave-types', { token: rh })
const adoption = (types.data ?? []).find((t) => t.name === 'Congé d’adoption')
rec('JUR-031 : type « Congé d’adoption » présent (déclaratif)', Boolean(adoption),
  adoption ? `deducts=${adoption.deductsPaidLeaveBalance} category=${adoption.category}` : 'absent')

if (adoption) {
  const before = await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=2026-2027&counterType=N-1`, { token: rh })
  const draft = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: {
    employeeId: emp.id, leaveTypeId: adoption.id, startDate: '2026-03-02', endDate: '2026-03-06' } })
  rec('JUR-031 : déclaration d’absence (brouillon RH) créée', draft.status === 201 || draft.status === 200, `HTTP ${draft.status}`)
  const reg = await apiRequest(`/absence-declarations/${draft.data?.id}/submit`, { method: 'POST', token: rh, body: {} })
  rec('JUR-031 : absence soumise/enregistrée (RH)', reg.status === 201 || reg.status === 200, `HTTP ${reg.status}`)
  const after = await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=2026-2027&counterType=N-1`, { token: rh })
  rec('JUR-031 : aucune déduction de solde (absence déclarative)',
    Number(before?.data?.[0]?.availableDays) === Number(after?.data?.[0]?.availableDays),
    `avant=${before?.data?.[0]?.availableDays} après=${after?.data?.[0]?.availableDays}`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
