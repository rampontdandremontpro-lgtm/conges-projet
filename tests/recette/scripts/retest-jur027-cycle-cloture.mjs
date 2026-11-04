// Vérification du cycle complet du report exceptionnel JUR-027 :
// report -> consommation possible sur la source -> clôture -> double usage ?
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR027C' + Date.now().toString(36)

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
  nom: 'CYCLE', prenom: 'Report', email: `cycle.${TAG}@recette.fr`,
  role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-06', serviceId: svc.id,
} })).data

// 1) Compteur source N-1 2025-2026 = 10 jours.
await sql((c) => c.query(
  `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
   VALUES (?, '2025-2026', 'N-1', 10, 0, 0, 10)`, [emp.id]))

async function bal(period, counter) {
  const r = await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=${period}&counterType=${counter}`, { token: rh })
  return r.data?.[0] ?? null
}

// 2) Report exceptionnel de 4 jours.
const carry = await apiRequest('/leave-balances/period/carryover', {
  method: 'POST', token: rh,
  body: { employeeId: emp.id, closingReferencePeriod: '2025-2026', days: 4, reason: 'Arrêt maladie — report L3141-19-1' },
})
rec('report exceptionnel accepté', carry.status === 201 || carry.status === 200, `HTTP ${carry.status}`)

const srcAfter = await bal('2025-2026', 'N-1')
const dstAfter = await bal('2026-2027', 'N-1')
// Règle métier : le report exceptionnel est un TRANSFERT (débit de la source,
// crédit de la cible). La source passe donc de 10 à 6, pas à 14.
rec('après report : compteur source N-1 = 6 (débitée)', Number(srcAfter?.availableDays) === 6, `availableDays=${srcAfter?.availableDays}`)
rec('après report : compteur cible N-1 2026-2027 = 4', Number(dstAfter?.availableDays) === 4, `availableDays=${dstAfter?.availableDays}`)
rec('pas de double usage après report : total = 10 pour 10 initiaux',
  Number(srcAfter?.availableDays) + Number(dstAfter?.availableDays) === 10,
  `${srcAfter?.availableDays} + ${dstAfter?.availableDays}`)

// 3) Les 6 jours restants restent consommables sur la source : simulation de la
//    consommation du reliquat réel (6 jours) après le report.
await sql((c) => c.query(
  `UPDATE leave_balances SET available_days = 0, consumed_days = 6 WHERE id = ?`, [srcAfter.id]))
const srcConsumed = await bal('2025-2026', 'N-1')
rec('consommation simulée du reliquat source (6 jours)', Number(srcConsumed?.consumedDays) === 6 && Number(srcConsumed?.availableDays) === 0,
  `consumed=${srcConsumed?.consumedDays} available=${srcConsumed?.availableDays}`)

// 4) Clôture de la période 2025-2026.
const close = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true },
})
rec('clôture 2025-2026 acceptée', close.status === 201 || close.status === 200, `HTTP ${close.status}`)

const srcClosed = await bal('2025-2026', 'N-1')
const dstClosed = await bal('2026-2027', 'N-1')
rec('après clôture : source N-1 = 0 (remise à zéro)', Number(srcClosed?.availableDays ?? 0) === 0, `availableDays=${srcClosed?.availableDays}`)
rec('après clôture : cible N-1 2026-2027 = 4 (report conservé)', Number(dstClosed?.availableDays) === 4, `availableDays=${dstClosed?.availableDays}`)

// 5) Pas de double crédit du report à la clôture.
const hist2027 = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2026-2027`, { token: rh })
const reports = (hist2027.data ?? []).filter((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL|'))
rec('aucun double crédit du report (un seul mouvement REPORT_EXCEPTIONNEL)', reports.length === 1, `count=${reports.length}`)

// 6) Contre-test anti-double usage : 6 jours consommés + 4 jours conservés.
const total = Number(srcConsumed?.consumedDays ?? 0) + Number(dstClosed?.availableDays ?? 0)
rec('PAS de double usage : 6 consommés + 4 conservés = 10 (pour 10 initiaux)', total === 10, `total=${total}`)

// 7) Mouvements et audit.
const histSrc = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2025-2026`, { token: rh })
const types = (histSrc.data ?? []).map((m) => m.movementType).join(',')
// Le report débite la source (CORRECTION_NEGATIVE) ; aucun REMISE_A_ZERO n'est
// attendu ici car le reliquat est entièrement consommé avant la clôture.
rec('mouvements source : CORRECTION_NEGATIVE (débit du report) présent', types.includes('CORRECTION_NEGATIVE'), types)
const audits = await sql((c) => c.query(
  `SELECT COUNT(*) n FROM audit_logs WHERE action='REFERENCE_PERIOD_CLOSED' AND JSON_EXTRACT(new_value, '$.referencePeriod')='2025-2026'`))
rec('audit REFERENCE_PERIOD_CLOSED (2025-2026)', audits[0][0].n >= 1, `count=${audits[0][0].n}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
