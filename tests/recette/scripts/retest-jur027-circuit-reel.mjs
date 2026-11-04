// Reproduction RÉELLE du double usage JUR-027 via les API métier
// (report exceptionnel RH + congé direct RH imputé sur le compteur source).
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR027R' + Date.now().toString(36)

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

// 1) Préparation : service actif + type de congé déduisant le solde + collaborateur.
const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const lt = (await apiRequest('/leave-types', { method: 'POST', token: rh, body: {
  name: 'Congés payés annuels ' + TAG, category: 'DEMANDE_CONGE',
  deductsPaidLeaveBalance: true, allowsDays: true, allowsHalfDays: true,
  employeeCanCreate: true, requiresValidation: true, rhOnly: false, documentRequired: false, documentCanBeAddedLater: false,
} })).data
const emp = (await apiRequest('/users', { method: 'POST', token: rh, body: {
  nom: 'CIRCUIT', prenom: 'Reel', email: `circuit.${TAG}@recette.fr`,
  role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-06', serviceId: svc.id,
} })).data
rec('préparation : collaborateur + service + type de congé créés', Boolean(emp?.id && lt?.id && svc?.id),
  `emp=${emp?.id} lt=${lt?.id} svc=${svc?.id}`)

// 2) Compteur source N-1 2026-2027 = 10 jours (préparation SQL autorisée).
await sql((c) => c.query(
  `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
   VALUES (?, '2026-2027', 'N-1', 10, 0, 0, 10)`, [emp.id]))

async function bal(period, counter) {
  const r = await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=${period}&counterType=${counter}`, { token: rh })
  return r.data?.[0] ?? null
}

// 3) Report exceptionnel de 4 jours (API réelle).
const carry = await apiRequest('/leave-balances/period/carryover', {
  method: 'POST', token: rh,
  body: { employeeId: emp.id, closingReferencePeriod: '2026-2027', days: 4, reason: 'Arrêt maladie — report L3141-19-1' },
})
rec('report exceptionnel accepté', carry.status === 201 || carry.status === 200, `HTTP ${carry.status}`)

const src1 = await bal('2026-2027', 'N-1')
const dst1 = await bal('2027-2028', 'N-1')
// Règle métier : le report exceptionnel est un TRANSFERT (source débitée).
rec('après report : source N-1 = 6 (débitée)', Number(src1?.availableDays) === 6, `availableDays=${src1?.availableDays}`)
rec('après report : cible N-1 2027-2028 = 4', Number(dst1?.availableDays) === 4, `availableDays=${dst1?.availableDays}`)

// 4) Congé direct RH réel imputé sur la source (10 jours ouvrés environ).
const leave = await apiRequest('/leave-requests/rh/direct', {
  method: 'POST', token: rh,
  body: {
    employeeId: emp.id, leaveTypeId: lt.id,
    startDate: '2026-10-26', endDate: '2026-11-05',
    startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
  },
})
rec('congé direct RH créé (circuit réel)', leave.status === 201 || leave.status === 200,
  `HTTP ${leave.status} deductedDays=${leave.data?.deductedDays}`)

const src2 = await bal('2026-2027', 'N-1')
const dst2 = await bal('2027-2028', 'N-1')
const deducted = Number(leave.data?.deductedDays ?? 0)
rec('après congé : source N-1 consommée (10 → 0 ou moins)', Number(src2?.availableDays) <= 0,
  `availableDays=${src2?.availableDays} consumedDays=${src2?.consumedDays}`)
rec('après congé : cible N-1 2027-2028 = 4 (report conservé)', Number(dst2?.availableDays) === 4, `availableDays=${dst2?.availableDays}`)

// 5) Contre-test anti-double usage par le circuit réel : le total ne peut pas
//    dépasser les 10 jours initiaux (le report transfère, il ne duplique pas).
const consumedOnSource = Number(src2?.consumedDays ?? 0)
const keptOnTarget = Number(dst2?.availableDays ?? 0)
rec(`PAS de double usage (circuit réel) : ${consumedOnSource} consommés + ${keptOnTarget} conservés = 10 initiaux`,
  consumedOnSource + keptOnTarget === 10, `total=${consumedOnSource + keptOnTarget}`)

// 6) Mouvements réels.
const histSrc = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2026-2027`, { token: rh })
const typesSrc = (histSrc.data ?? []).map((m) => m.movementType).join(',')
rec('mouvement DEDUCTION sur la source', typesSrc.includes('DEDUCTION'), typesSrc)
const histDst = await apiRequest(`/leave-balances/employee/${emp.id}/history?referencePeriod=2027-2028`, { token: rh })
const reportMoves = (histDst.data ?? []).filter((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL|'))
rec('report conservé (REPORT_EXCEPTIONNEL présent)', reportMoves.length === 1, `count=${reportMoves.length}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
