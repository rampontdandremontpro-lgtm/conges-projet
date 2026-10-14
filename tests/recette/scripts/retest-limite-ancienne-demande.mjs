// Retest : la validation backend N/N+1 ne doit pas rejeter une modification
// SANS changement de dates sur une ancienne demande déjà enregistrée (dont
// les dates dépassent la limite actuelle).
//
// La demande "ancienne" ne peut plus être créée via l'API (la limite la
// bloque), on la fabrique donc via un UPDATE SQL de fixture dans la base de
// test, puis on valide le comportement par de vraies actions API PATCH.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'LIMOLD' + Date.now().toString(36)

const admin = await login('admin.recette@gmes.fr')
const leaveType = (await apiRequest('/leave-types', {
  method: 'POST',
  token: admin,
  body: {
    name: 'CP ' + TAG,
    category: 'DEMANDE_CONGE',
    deductsPaidLeaveBalance: false,
    documentRequired: false,
    documentCanBeAddedLater: false,
    employeeCanCreate: true,
    rhOnly: false,
    allowsDays: true,
    allowsHalfDays: false,
    allowsHours: false,
    requiresValidation: true,
  },
})).data
const service = (await apiRequest('/services', {
  method: 'POST',
  token: admin,
  body: {
    name: 'SVC-' + TAG,
    serviceType: 'INTERNE',
    minimumPresence: 1,
    hasMinimumPresenceRule: false,
  },
})).data
const collaborator = (await apiRequest('/users', {
  method: 'POST',
  token: admin,
  body: {
    nom: 'LIMOLD',
    prenom: 'Col',
    email: `limold.col.${TAG}@recette.fr`,
    role: 'COLLABORATEUR',
    employmentType: 'INTERNE',
    serviceId: service.id,
    hireDate: '2026-01-06',
  },
})).data
const token = signAccessToken({ id: collaborator.id, email: collaborator.email, role: 'COLLABORATEUR' })

// Création d'un brouillon dans les limites (31/05/2028 = fin N+1).
const draft = (await apiRequest('/leave-requests', {
  method: 'POST',
  token,
  body: {
    leaveTypeId: leaveType.id,
    startDate: '2028-05-31',
    endDate: '2028-05-31',
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  },
})).data

// Fixture : on simule une demande historique dont les dates dépassent la
// limite actuelle (2030-06-03, au-delà du 31/05/2028).
const conn = await dbConn()
await conn.query(
  "UPDATE leave_requests SET start_date = '2030-06-03', end_date = '2030-06-03' WHERE id = ?",
  [draft.id],
)
await conn.end()

// 1. Modification SANS changement de dates (commentaire seul) → doit réussir.
const r1 = await apiRequest(`/leave-requests/${draft.id}`, {
  method: 'PATCH',
  token,
  body: { comment: 'mise à jour sans changement de dates' },
})

// 2. Modification en renvoyant les MÊMES dates explicitement → doit réussir.
const r2 = await apiRequest(`/leave-requests/${draft.id}`, {
  method: 'PATCH',
  token,
  body: {
    startDate: '2030-06-03',
    endDate: '2030-06-03',
    comment: 'dates identiques renvoyées',
  },
})

// 3. Modification AVEC changement de dates au-delà de la limite → doit être rejetée.
const r3 = await apiRequest(`/leave-requests/${draft.id}`, {
  method: 'PATCH',
  token,
  body: { endDate: '2030-06-05' },
})

const ok1 = r1.status === 200
const ok2 = r2.status === 200
const ok3 = r3.status === 400

console.log('1. PATCH commentaire seul (dates inchangées)      →', r1.status, ok1 ? 'OK' : `ÉCHEC ${r1.data?.message}`)
console.log('2. PATCH mêmes dates renvoyées                     →', r2.status, ok2 ? 'OK' : `ÉCHEC ${r2.data?.message}`)
console.log('3. PATCH changement de date au-delà de N+1         →', r3.status, ok3 ? 'OK (rejeté)' : `ÉCHEC ${r3.data?.message}`)

console.log('\n=== RÉSUMÉ ancienne demande ===')
console.log(`Total: 3, Conforme: ${(ok1 ? 1 : 0) + (ok2 ? 1 : 0) + (ok3 ? 1 : 0)}, Non conforme: ${(ok1 ? 0 : 1) + (ok2 ? 0 : 1) + (ok3 ? 0 : 1)}`)
process.exit(ok1 && ok2 && ok3 ? 0 : 1)
