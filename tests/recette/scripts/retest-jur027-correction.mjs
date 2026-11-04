// Tests de non-régression de la correction JUR-027 :
// le report exceptionnel débite désormais le compteur source N-1.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR027X' + Date.now().toString(36)

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
const lt = (await apiRequest('/leave-types', { method: 'POST', token: rh, body: {
  name: 'Congés payés annuels ' + TAG, category: 'DEMANDE_CONGE',
  deductsPaidLeaveBalance: true, allowsDays: true, allowsHalfDays: true,
  employeeCanCreate: true, requiresValidation: true, rhOnly: false, documentRequired: false, documentCanBeAddedLater: false,
} })).data

async function createEmp(suffix) {
  return (await apiRequest('/users', { method: 'POST', token: rh, body: {
    nom: 'CORR', prenom: 'Emp' + suffix, email: `corr.${suffix}.${TAG}@recette.fr`,
    role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-06', serviceId: svc.id,
  } })).data
}

async function seedN1(empId, period, available, reserved = 0, acquired = null) {
  await sql((c) => c.query(
    `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
     VALUES (?, ?, 'N-1', ?, ?, 0, ?)`,
    [empId, period, acquired ?? available, reserved, available]))
}

async function bal(empId, period, counter = 'N-1') {
  const r = await apiRequest(`/leave-balances/employee/${empId}?referencePeriod=${period}&counterType=${counter}`, { token: rh })
  return r.data?.[0] ?? null
}

async function report(empId, period, days, reason = 'Arrêt maladie — report L3141-19-1') {
  return apiRequest('/leave-balances/period/carryover', {
    method: 'POST', token: rh,
    body: { employeeId: empId, closingReferencePeriod: period, days, reason },
  })
}

// --- Check 1 : report 4/10 → source 6, cible 4 ---
const e1 = await createEmp('A')
await seedN1(e1.id, '2026-2027', 10)
const r1 = await report(e1.id, '2026-2027', 4)
const s1 = await bal(e1.id, '2026-2027', 'N-1')
const t1 = await bal(e1.id, '2027-2028', 'N-1')
rec('C1 : report accepté', r1.status === 201 || r1.status === 200, `HTTP ${r1.status}`)
rec('C1 : source = 6 (débitée)', Number(s1?.availableDays) === 6, `availableDays=${s1?.availableDays}`)
rec('C1 : cible = 4 (créditée)', Number(t1?.availableDays) === 4, `availableDays=${t1?.availableDays}`)

// --- Check 2 : consommation de 6 jours après report (autorisée) ---
const lv6 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: {
  employeeId: e1.id, leaveTypeId: lt.id, startDate: '2026-10-26', endDate: '2026-10-30', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
} })
const s1b = await bal(e1.id, '2026-2027', 'N-1')
rec('C2 : congé de 6 jours créé', lv6.status === 201 || lv6.status === 200, `HTTP ${lv6.status} deducted=${lv6.data?.deductedDays}`)
rec('C2 : source consommée à 0', Number(s1b?.availableDays) === 0, `availableDays=${s1b?.availableDays}`)

// --- Check 3 : tentative de consommation de 10 jours après report ---
const e3 = await createEmp('B')
await seedN1(e3.id, '2026-2027', 10)
await report(e3.id, '2026-2027', 4)
const s3 = await bal(e3.id, '2026-2027', 'N-1')
rec('C3 : après report, source = 6 (les 4 jours reportés indisponibles)', Number(s3?.availableDays) === 6, `availableDays=${s3?.availableDays}`)
const lv10 = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: {
  employeeId: e3.id, leaveTypeId: lt.id, startDate: '2026-10-26', endDate: '2026-11-05', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
} })
const s3b = await bal(e3.id, '2026-2027', 'N-1')
const n3b = await bal(e3.id, '2026-2027', 'N')
const t3b = await bal(e3.id, '2027-2028', 'N-1')
rec('C3 : congé de 10 jours (source 6 + N négatif)', lv10.status === 201 || lv10.status === 200, `deducted=${lv10.data?.deductedDays}`)
rec('C3 : source N-1 = 0 (pas de réutilisation des 4 jours)', Number(s3b?.availableDays) === 0, `availableDays=${s3b?.availableDays}`)
rec('C3 : N négatif (anticipation, pas les jours reportés)', Number(n3b?.availableDays) < 0, `N=${n3b?.availableDays}`)
rec('C3 : cible = 4 (report conservé)', Number(t3b?.availableDays) === 4, `availableDays=${t3b?.availableDays}`)

// --- Check 4 : deux reports successifs ---
const e4 = await createEmp('C')
await seedN1(e4.id, '2026-2027', 10)
const r4a = await report(e4.id, '2026-2027', 4)
const r4b = await report(e4.id, '2026-2027', 3)
const s4 = await bal(e4.id, '2026-2027', 'N-1')
const t4 = await bal(e4.id, '2027-2028', 'N-1')
rec('C4 : deux reports acceptés', (r4a.status === 201 || r4a.status === 200) && (r4b.status === 201 || r4b.status === 200), `HTTP ${r4a.status}/${r4b.status}`)
rec('C4 : source = 3 (7 débités)', Number(s4?.availableDays) === 3, `availableDays=${s4?.availableDays}`)
rec('C4 : cible = 7', Number(t4?.availableDays) === 7, `availableDays=${t4?.availableDays}`)

// --- Check 5 : report supérieur au solde libre refusé ---
const e5 = await createEmp('D')
await seedN1(e5.id, '2026-2027', 10)
const r5 = await report(e5.id, '2026-2027', 11)
const s5 = await bal(e5.id, '2026-2027', 'N-1')
rec('C5 : report 11/10 refusé (400)', r5.status === 400, `HTTP ${r5.status}`)
rec('C5 : source inchangée (10)', Number(s5?.availableDays) === 10, `availableDays=${s5?.availableDays}`)

// --- Check 6 : report avec jours déjà réservés ---
const e6 = await createEmp('E')
await seedN1(e6.id, '2026-2027', 10, 5) // 5 réservés, 5 libres
const r6a = await report(e6.id, '2026-2027', 6)
const s6a = await bal(e6.id, '2026-2027', 'N-1')
rec('C6 : report 6 avec 5 réservés refusé', r6a.status === 400, `HTTP ${r6a.status}`)
rec('C6 : compteurs inchangés', Number(s6a?.availableDays) === 10 && Number(s6a?.reservedDays) === 5, `available=${s6a?.availableDays} reserved=${s6a?.reservedDays}`)
const r6b = await report(e6.id, '2026-2027', 5)
const s6b = await bal(e6.id, '2026-2027', 'N-1')
rec('C6 : report 5 (libre) accepté', r6b.status === 201 || r6b.status === 200, `HTTP ${r6b.status}`)
rec('C6 : source available=5, reserved=5 (pas de double affectation)', Number(s6b?.availableDays) === 5 && Number(s6b?.reservedDays) === 5, `available=${s6b?.availableDays} reserved=${s6b?.reservedDays}`)

// --- Check 9 : opérations concurrentes (deux reports de 6 en parallèle) ---
const e9 = await createEmp('F')
await seedN1(e9.id, '2026-2027', 10)
const [c9a, c9b] = await Promise.all([report(e9.id, '2026-2027', 6), report(e9.id, '2026-2027', 6)])
const s9 = await bal(e9.id, '2026-2027', 'N-1')
const t9 = await bal(e9.id, '2027-2028', 'N-1')
const ok9 = [c9a.status, c9b.status].filter((s) => s === 201 || s === 200).length
rec('C9 : un seul des deux reports concurrents aboutit', ok9 === 1, `statuses=${c9a.status}/${c9b.status}`)
rec('C9 : intégrité source + cible = 10', Number(s9?.availableDays) + Number(t9?.availableDays) === 10, `source=${s9?.availableDays} cible=${t9?.availableDays}`)

// --- Check 10 : mouvements, audit, notification ---
const histSrc = await apiRequest(`/leave-balances/employee/${e1.id}/history?referencePeriod=2026-2027`, { token: rh })
const debitMove = (histSrc.data ?? []).find((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL_DEBIT|'))
const histTgt = await apiRequest(`/leave-balances/employee/${e1.id}/history?referencePeriod=2027-2028`, { token: rh })
const creditMove = (histTgt.data ?? []).find((m) => String(m.reason ?? '').startsWith('REPORT_EXCEPTIONNEL|'))
rec('C10 : mouvement de débit source tracé (REPORT_EXCEPTIONNEL_DEBIT)', Boolean(debitMove), `type=${debitMove?.movementType} before=${debitMove?.balanceBefore} after=${debitMove?.balanceAfter}`)
rec('C10 : mouvement de crédit cible tracé (REPORT_EXCEPTIONNEL)', Boolean(creditMove), `type=${creditMove?.movementType}`)
const audits = await sql((c) => c.query(
  `SELECT COUNT(*) n FROM audit_logs WHERE action='EXCEPTIONAL_CARRYOVER_APPROVED' AND JSON_EXTRACT(new_value, '$.sourceBalanceAfter') IS NOT NULL`))
rec('C10 : audit avec solde source/cible', audits[0][0].n >= 1, `count=${audits[0][0].n}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
