// Retest : logo d'entreprise sur les PDF de congés VALIDÉS (3 entités) +
// conservation d'un PDF stocké avant un changement de rattachement.
import { writeFileSync } from 'node:fs'
import { apiRequest, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'LOGOV' + Date.now().toString(36)

const admin = await login('admin.recette@gmes.fr')
const rh = await login('rh.recette@gmes.fr')
const directeur = await login('directeur.recette@gmes.fr')

const leaveType = (await apiRequest('/leave-types', {
  method: 'POST', token: admin,
  body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true },
})).data
const svc = (await apiRequest('/services', {
  method: 'POST', token: admin,
  body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
})).data

const entities = (await apiRequest('/legal-entities', { token: rh })).data
const byCode = Object.fromEntries(entities.map((e) => [e.code, e]))

async function makeUser(suffix, code) {
  const entity = byCode[code]
  return (await apiRequest('/users', {
    method: 'POST', token: rh,
    body: { nom: 'LOGOV', prenom: suffix, email: `logov.${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06', legalEntityId: entity.id },
  })).data
}

async function validateToPdf(user, date = '2026-12-01') {
  const empToken = signAccessToken({ id: user.id, email: user.email, role: 'COLLABORATEUR' })
  const draft = (await apiRequest('/leave-requests', {
    method: 'POST', token: empToken,
    body: { leaveTypeId: leaveType.id, startDate: date, endDate: date, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
  })).data
  await apiRequest(`/leave-requests/${draft.id}/submit`, { method: 'POST', token: empToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
  const v1 = await apiRequest(`/leave-requests/${draft.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  if (v1.status !== 200) throw new Error(`RH validate HTTP ${v1.status} ${JSON.stringify(v1.data)}`)
  const v2 = await apiRequest(`/leave-requests/${draft.id}/validate`, { method: 'POST', token: directeur, body: { signatureType: 'INITIALS', signatureData: 'DI' } })
  if (v2.status !== 200) throw new Error(`Directeur validate HTTP ${v2.status} ${JSON.stringify(v2.data)}`)

  const res = await fetch(`${API_URL}/leave-requests/${draft.id}/pdf`, { headers: { Authorization: `Bearer ${empToken}` } })
  if (!res.ok) throw new Error(`download pdf HTTP ${res.status}`)
  return { draftId: draft.id, buffer: Buffer.from(await res.arrayBuffer()) }
}

// 1. Trois entités.
for (const code of ['GMES', 'EFFICIENCE', 'GMES_INGENIERIE']) {
  const user = await makeUser(code.toLowerCase(), code)
  const { buffer } = await validateToPdf(user)
  const file = `tests/recette/preuves/PDF-VALIDE-${code}.pdf`
  writeFileSync(file, buffer)
  console.log(`PDF validé ${code}: ${file} (${buffer.length} octets)`)
}

// 2. Conservation d'un PDF stocké avant changement de rattachement.
const userMoved = await makeUser('moved', 'GMES_INGENIERIE')
const { draftId } = await validateToPdf(userMoved)
// Télécharger une première fois (PDF GMI stocké).
const empToken = signAccessToken({ id: userMoved.id, email: userMoved.email, role: 'COLLABORATEUR' })
const before = Buffer.from(await (await fetch(`${API_URL}/leave-requests/${draftId}/pdf`, { headers: { Authorization: `Bearer ${empToken}` } })).arrayBuffer())
writeFileSync('tests/recette/preuves/PDF-VALIDE-AVANT.pdf', before)

// Changer le rattachement vers GMES.
await apiRequest(`/users/${userMoved.id}`, { method: 'PATCH', token: rh, body: { legalEntityId: byCode.GMES.id } })
const after = Buffer.from(await (await fetch(`${API_URL}/leave-requests/${draftId}/pdf`, { headers: { Authorization: `Bearer ${empToken}` } })).arrayBuffer())
writeFileSync('tests/recette/preuves/PDF-VALIDE-APRES.pdf', after)
console.log(`avant changement: ${before.length} octets | après changement: ${after.length} octets | identiques: ${before.equals(after)}`)
