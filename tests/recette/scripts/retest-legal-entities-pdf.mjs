// Retest PDF : identité d'entreprise sur le récapitulatif provisoire.
// Génère un PDF pour GMES, Efficience et GMES Ingénierie, puis laisse la
// vérification de rendu à PyMuPDF (retest-legal-entities-pdf.py).
import { writeFileSync } from 'node:fs'
import { apiRequest, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'LEPDF' + Date.now().toString(36)
const admin = await login('admin.recette@gmes.fr')
const rh = await login('rh.recette@gmes.fr')

const leaveType = (await apiRequest('/leave-types', {
  method: 'POST', token: admin,
  body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true },
})).data
const svc = (await apiRequest('/services', {
  method: 'POST', token: admin,
  body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
})).data

const entities = (await apiRequest('/legal-entities', { token: rh })).data
const gmes = entities.find((e) => e.code === 'GMES')
const efficience = entities.find((e) => e.code === 'EFFICIENCE')
const ingenierie = entities.find((e) => e.code === 'GMES_INGENIERIE')

async function makeUser(suffix, legalEntityId) {
  return (await apiRequest('/users', {
    method: 'POST', token: rh,
    body: { nom: 'LEPDF', prenom: suffix, email: `lepdf.${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06', legalEntityId },
  })).data
}

async function generatePdf(code, user) {
  const employeeToken = signAccessToken({ id: user.id, email: user.email, role: 'COLLABORATEUR' })
  const draft = (await apiRequest('/leave-requests', {
    method: 'POST', token: employeeToken,
    body: { leaveTypeId: leaveType.id, startDate: '2026-12-01', endDate: '2026-12-02', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
  })).data

  // Soumission pour obtenir le statut EN_ATTENTE_VALIDATION.
  await apiRequest(`/leave-requests/${draft.id}/submit`, {
    method: 'POST', token: employeeToken,
    body: { signatureType: 'INITIALS', signatureData: 'CO' },
  })

  const res = await fetch(`${API_URL}/leave-requests/${draft.id}/pending-summary-pdf`, {
    headers: { Authorization: `Bearer ${rh}` },
  })
  if (!res.ok) throw new Error(`PDF ${code}: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const file = `tests/recette/preuves/PDF-ENT-${code}.pdf`
  writeFileSync(file, buffer)
  console.log(`PDF ${code} généré: ${file} (${buffer.length} octets)`)
  return file
}

await generatePdf('GMES', await makeUser('gmes', gmes.id))
await generatePdf('EFFICIENCE', await makeUser('eff', efficience.id))
await generatePdf('INGENIERIE', await makeUser('ing', ingenierie.id))
