// Retest des chevauchements de congés/absences (granularité MATIN / APRES_MIDI).
// - Vérification backend (création, modification, soumission) avec HTTP 409.
// - Base : gestion_conges_gmes_test (API 3001).

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'OVL' + Date.now().toString(36)
const results = []

function record(id, scenario, ok, detail) {
  results.push({ id, scenario, status: ok ? 'Conforme' : 'Non conforme', detail, date: new Date().toISOString() })
  console.log(`${ok ? 'OK ' : 'KO '} ${id} ${scenario} :: ${detail}`)
}

function addDays(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekday(iso) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}

function advanceToWeekday(iso) {
  let d = iso
  for (let i = 0; i < 7; i++) {
    const wd = weekday(d)
    if (wd >= 1 && wd <= 5) return d
    d = addDaysFrom(d, 1)
  }
  return d
}

function addDaysFrom(iso, n) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

let cursorIso = addDays(45)
function nextWeekday() {
  cursorIso = advanceToWeekday(cursorIso)
  const d = cursorIso
  cursorIso = addDaysFrom(cursorIso, 1)
  return d
}

const admin = await login('admin.recette@gmes.fr')
const rh = await login('rh.recette@gmes.fr')

const leaveType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `ABS ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'OVL', prenom: 'Col', email: `ovl.col.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
const token = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })

const createLeave = (body) => apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: leaveType.id, ...body } })

const d1 = nextWeekday()
const d2 = nextWeekday()

console.log(`\n=== Retest chevauchements (${TAG}) ===`)

// 1. Matin occupé -> après-midi libre
{
  const r1 = await createLeave({ startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'MATIN' })
  const r2 = await createLeave({ startDate: d1, endDate: d1, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' })
  record('OVL1', 'Matin occupé -> après-midi sélectionnable', r1.status === 201 && r2.status === 201, `matin=${r1.status} apresmidi=${r2.status}`)
}

// 2. Après-midi occupé -> matin libre
{
  const d = nextWeekday()
  const r1 = await createLeave({ startDate: d, endDate: d, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' })
  const r2 = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' })
  record('OVL2', 'Après-midi occupé -> matin sélectionnable', r1.status === 201 && r2.status === 201, `apresmidi=${r1.status} matin=${r2.status}`)
}

// 3. Deux demi-journées occupées -> journée bloquée
{
  const d = nextWeekday()
  await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' })
  await createLeave({ startDate: d, endDate: d, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' })
  const r3 = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  record('OVL3', 'Deux demi-journées occupées -> journée bloquée (409)', r3.status === 409, `HTTP=${r3.status} ${JSON.stringify(r3.data?.message)}`)
}

// 4. Plage traversant un créneau occupé -> refus
{
  const d = nextWeekday()
  const before = addDaysFrom(d, -1)
  const after = addDaysFrom(d, 1)
  await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' })
  const range = await createLeave({ startDate: before, endDate: after, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  record('OVL4', 'Plage traversant un créneau occupé -> refus (409)', range.status === 409, `HTTP=${range.status} ${JSON.stringify(range.data?.message)}`)
}

// 5. Modification d'un brouillon : pas d'auto-blocage
{
  const d = nextWeekday()
  const r = (await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' })).data
  const upd = await apiRequest(`/leave-requests/${r.id}`, { method: 'PATCH', token, body: { startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  record('OVL5', 'Modification de son propre brouillon sans auto-blocage', upd.status === 200, `HTTP=${upd.status}`)
}

// 6. Absence (matin) bloque une journée complète mais pas l'après-midi
{
  const d = nextWeekday()
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: col.id, leaveTypeId: absenceType.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' } })).data
  const full = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  const pm = await createLeave({ startDate: d, endDate: d, startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' })
  record('OVL6', 'Absence matin bloque journée entière mais laisse l’après-midi', abs?.id != null && full.status === 409 && pm.status === 201, `abs=${abs?.id} full=${full.status} pm=${pm.status}`)
}

// 7. Refus libère les dates
{
  const d = nextWeekday()
  const r = (await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })).data
  const sub = await apiRequest(`/leave-requests/${r.id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
  const ref = await apiRequest(`/leave-requests/${r.id}/refuse`, { method: 'POST', token: rh, body: { comment: 'test' } })
  const again = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  record('OVL7', 'Demande refusée -> dates libérées', sub.status === 200 && ref.status === 200 && again.status === 201, `submit=${sub.status} refuse=${ref.status} recreer=${again.status}`)
}

// 8. Suppression d'un brouillon libère les dates
{
  const d = nextWeekday()
  const r = (await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })).data
  const del = await apiRequest(`/leave-requests/${r.id}`, { method: 'DELETE', token })
  const again = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  record('OVL8', 'Brouillon supprimé -> dates libérées', (del.status === 200 || del.status === 204) && again.status === 201, `delete=${del.status} recreer=${again.status}`)
}

// 9. Absence annulée libère les dates
{
  const d = nextWeekday()
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: col.id, leaveTypeId: absenceType.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  const cancel = await apiRequest(`/absence-declarations/${abs.id}/cancel`, { method: 'POST', token: rh })
  const again = await createLeave({ startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' })
  record('OVL9', 'Absence annulée -> dates libérées', cancel.status === 200 && again.status === 201, `cancel=${cancel.status} recreer=${again.status}`)
}

console.log('\n=== RÉSUMÉ ===')
const ok = results.filter((r) => r.status === 'Conforme').length
const ko = results.filter((r) => r.status === 'Non conforme').length
console.log(`Total: ${results.length}, Conforme: ${ok}, Non conforme: ${ko}`)
for (const r of results.filter((x) => x.status === 'Non conforme')) console.log(`  KO ${r.id} ${r.scenario} :: ${r.detail}`)

process.exitCode = ko === 0 ? 0 : 1
