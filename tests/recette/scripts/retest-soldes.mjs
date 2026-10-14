// Vérification ciblée des soldes (4 sous-cas) sans modifier les règles métier.
// - Congé futur : aucune déduction anticipée (ni au 1er niveau, ni au final).
// - Congé commencé (heure Martinique) : déduction exactement une fois.
// - Première validation : aucune déduction.
// - Double validation : aucun double débit.

import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'SOLDE' + Date.now().toString(36)
const out = {}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function martiniqueToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = isoAddDays(s, 1) }
  return s
}

async function countDeductions(db, requestId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id = ? AND movement_type = 'DEDUCTION'`,
    [requestId],
  )
  return Number(rows[0].n)
}

async function main() {
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SOLDE-SANS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'SOLDECOL', prenom: 'FUTUR', email: `soldecol.${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const colToken = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })
  const typeSolde = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP SOLDE ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  await apiRequest('/leave-balances/initialize', { method: 'POST', token: admin, body: { employeeId: col.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 10, reason: 'Init solde ' + TAG } })

  const db = await dbConn()

  // ===== Congé futur : aucune déduction anticipée =====
  const futureDate = advanceToWeekday(isoAddDays(new Date().toISOString().slice(0, 10), 45))
  const futureReq = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: typeSolde.id, startDate: futureDate, endDate: futureDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${futureReq.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
  const midFuture = await countDeductions(db, futureReq.id)
  await apiRequest(`/leave-requests/${futureReq.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  const midFuture2 = await countDeductions(db, futureReq.id)
  await apiRequest(`/leave-requests/${futureReq.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
  const finFuture = await countDeductions(db, futureReq.id)

  // Double validation : le Directeur ne peut pas re-valider -> aucun débit supplémentaire.
  const doubleVal = await apiRequest(`/leave-requests/${futureReq.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
  const finAfterDouble = await countDeductions(db, futureReq.id)

  out['future'] = {
    startDate: futureDate,
    deductionsAfterFirstLevel: midFuture,
    deductionsAfterRhValidation: midFuture2,
    deductionsAfterFinal: finFuture,
    doubleValidationHttp: doubleVal.status,
    deductionsAfterDoubleAttempt: finAfterDouble,
  }

  // ===== Congé commencé en heure Martinique : déduction exactement une fois =====
  // Utilise la déclaration directe RH (fonctionnalité réelle) pour un congé dont la
  // date de début est passée en heure Martinique, afin d'être déterministe.
  const mToday = martiniqueToday()
  const startedDate = mToday
  const startedReq = (await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rh, body: { employeeId: col.id, leaveTypeId: typeSolde.id, startDate: startedDate, endDate: startedDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  const startedDeductions = await countDeductions(db, startedReq.id)

  // Maintenance : ne doit pas re-débiter (balanceProcessingStatus déjà DEFINITIF).
  await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh, body: {} }).catch(() => {})
  const startedDeductionsAfterMaintenance = await countDeductions(db, startedReq.id)

  out['started'] = {
    martiniqueToday: mToday,
    startDate: startedDate,
    requestId: startedReq.id,
    deductions: startedDeductions,
    deductionsAfterMaintenance: startedDeductionsAfterMaintenance,
  }

  await db.end()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
