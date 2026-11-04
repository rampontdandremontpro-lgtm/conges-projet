// JUR-027 correction — report puis clôture (pas de double crédit) + seconde clôture refusée.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR027Y' + Date.now().toString(36)

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

const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const emp = (await apiRequest('/users', { method: 'POST', token: rh, body: {
  nom: 'CLOT', prenom: 'Report', email: `clot.${TAG}@recette.fr`,
  role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-06', serviceId: svc.id,
} })).data

// Période 2025-2026 (clôturable : se termine le 31/05/2026).
await sql((c) => c.query(
  `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
   VALUES (?, '2025-2026', 'N-1', 10, 0, 0, 10)`, [emp.id]))

const report = await apiRequest('/leave-balances/period/carryover', {
  method: 'POST', token: rh,
  body: { employeeId: emp.id, closingReferencePeriod: '2025-2026', days: 4, reason: 'Arrêt maladie — report L3141-19-1' },
})
async function bal(period, counter) {
  const r = await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=${period}&counterType=${counter}`, { token: rh })
  return r.data?.[0] ?? null
}
const s1 = await bal('2025-2026', 'N-1')
const t1 = await bal('2026-2027', 'N-1')
rec('après report : source 2025-2026 = 6', Number(s1?.availableDays) === 6, `availableDays=${s1?.availableDays}`)
rec('après report : cible 2026-2027 = 4', Number(t1?.availableDays) === 4, `availableDays=${t1?.availableDays}`)

const close = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
rec('clôture 2025-2026 acceptée', close.status === 201 || close.status === 200, `HTTP ${close.status}`)

const s2 = await bal('2025-2026', 'N-1')
const t2 = await bal('2026-2027', 'N-1')
rec('après clôture : source = 0', Number(s2?.availableDays ?? 0) === 0, `availableDays=${s2?.availableDays}`)
rec('après clôture : cible = 4 (report conservé, pas de double crédit)', Number(t2?.availableDays) === 4, `availableDays=${t2?.availableDays}`)

const histT = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2026-2027`, { token: rh })
const reports = (histT.data ?? []).filter((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL|'))
rec('un seul crédit REPORT_EXCEPTIONNEL (pas de double crédit)', reports.length === 1, `count=${reports.length}`)

const close2 = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
rec('seconde clôture refusée (409)', close2.status === 409, `HTTP ${close2.status}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
