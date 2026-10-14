// Retest du vrai parcours de dérogation GMES (soumission directe).
// - Aucune étape autonome « Envoyer la demande » de dérogation.
// - La dérogation est créée/attachée au moment de la soumission du congé.
// - Aucune dérogation fantôme dans les listes RH.
// - Actions réelles via API uniquement, base gestion_conges_gmes_test (3001).

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'DIRECTE' + Date.now().toString(36)
const results = []

function record(id, scenario, ok, detail, comment = '') {
  results.push({ id, scenario, status: ok ? 'Conforme' : 'Non conforme', detail, comment, date: new Date().toISOString() })
  console.log(`${ok ? 'OK ' : 'KO '} ${id} ${scenario} :: ${detail}${comment ? ` (${comment})` : ''}`)
}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = isoAddDays(s, 1) }
  return s
}
let nearCursor = isoAddDays(todayIso(), 2)
function nextNearDate() { nearCursor = advanceToWeekday(nearCursor); const d = nearCursor; nearCursor = isoAddDays(nearCursor, 1); return d }
let farCursor = isoAddDays(todayIso(), 45)
function nextFarDate() { farCursor = advanceToWeekday(farCursor); const d = farCursor; farCursor = isoAddDays(farCursor, 1); return d }

let db
async function dbQuery(sql, params = []) {
  if (!db) db = await dbConn()
  const [rows] = await db.query(sql, params)
  return rows
}

const adminToken = await login('admin.recette@gmes.fr')
const rhToken = await login('rh.recette@gmes.fr')
const dirToken = await login('directeur.recette@gmes.fr')
const respToken = await login('responsable.recette@gmes.fr')
const me = async (token) => (await apiRequest('/users/me', { token })).data
const rhId = (await me(rhToken)).id
const respId = (await me(respToken)).id

const type = async (label) => (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
const typeDerog = await type('DEROG')
const typeSans = await type('SANS')

const svcAvec = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `AVEC-RESP-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
await apiRequest(`/users/${respId}`, { method: 'PATCH', token: adminToken, body: { serviceId: svcAvec.id } })
await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

const svcSans = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `SANS-RESP-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data

const mkCol = async (suffix, svcId) => {
  const u = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: 'DCOL', prenom: suffix, email: `dcol.${suffix.toLowerCase()}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, hireDate: '2026-01-06' } })).data
  return { ...u, token: signAccessToken({ id: u.id, email: u.email, role: 'COLLABORATEUR' }) }
}
const colAvec = await mkCol('AVEC', svcAvec.id)
const colSans = await mkCol('SANS', svcSans.id)

const createDraft = async (token, typeId, d) => (await apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: typeId, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
const submit = (token, id, extra = {}) => apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'CO', ...extra } })
const validate = (token, id, initials) => apiRequest(`/leave-requests/${id}/validate`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: initials } })
const refuse = (token, id, comment) => apiRequest(`/leave-requests/${id}/refuse`, { method: 'POST', token, body: { comment } })
const mgmt = async (token) => (await apiRequest('/derogations/management', { token })).data
const myDerog = async (token, requestId) => (await apiRequest('/derogations/my', { token })).data.find((d) => Number(d.leaveRequestId) === Number(requestId))

console.log(`\n=== Retest dérogation directe (${TAG}) ===`)

// ---------------------------------------------------------------------------
// 1. Soumission directe avec dérogation (collaborateur avec responsable)
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  const sub = await submit(colAvec.token, draft.id, { derogationReason: 'Départ urgent (motif)' })
  const der = await myDerog(colAvec.token, draft.id)
  const inList = (await mgmt(rhToken)).find((x) => Number(x.id) === Number(der?.id))
  record('D1-SOUMISSION', 'Soumission directe congé + dérogation (sans étape autonome)', sub.status === 200 && sub.data?.status === 'EN_ATTENTE_VALIDATION', `HTTP=${sub.status}`)
  record('D1-DEROG-CREEE', 'Dérogation créée à la soumission avec le motif', der?.status === 'EN_ATTENTE_RH' && der?.reason === 'Départ urgent (motif)' && der?.submittedAt != null, JSON.stringify({ status: der?.status, reason: der?.reason }))
  record('D1-RH-LISTE', 'Dérogation visible et traitable par la RH', Boolean(inList) && inList.workflowStatus === 'EN_ATTENTE_RH', JSON.stringify(inList && { id: inList.id, lr: inList.leaveRequest?.status }))
  record('D1-UNIQUE', 'Une seule dérogation pour la demande', (await dbQuery('SELECT COUNT(*) n FROM derogations WHERE leave_request_id = ?', [draft.id]))[0].n === 1, '')
}

// ---------------------------------------------------------------------------
// 2. Clics multiples sur soumettre : aucune duplication
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  const first = await submit(colAvec.token, draft.id, { derogationReason: 'Anti double-clic' })
  const second = await submit(colAvec.token, draft.id, { derogationReason: 'Anti double-clic' })
  const count = (await dbQuery('SELECT COUNT(*) n FROM derogations WHERE leave_request_id = ?', [draft.id]))[0].n
  record('D2-DOUBLE', 'Double soumission refusée sans dérogation dupliquée', first.status === 200 && second.status !== 200 && count === 1, `first=${first.status} second=${second.status} derog=${count}`)
}

// ---------------------------------------------------------------------------
// 3. Dérogation fantôme sur brouillon non soumis
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  const der = (await apiRequest('/derogations', { method: 'POST', token: colAvec.token, body: { leaveRequestId: draft.id, reason: 'fantôme brouillon' } })).data
  const inList = (await mgmt(rhToken)).find((x) => Number(x.id) === Number(der.id))
  record('D3-FANTOME', 'Dérogation sur brouillon non soumis absente des listes RH', !inList, JSON.stringify(der && { id: der.id, status: der.status }))
}

// ---------------------------------------------------------------------------
// 4. Dérogation supprimée d'un brouillon : ne réapparaît pas active
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  const der = (await apiRequest('/derogations', { method: 'POST', token: colAvec.token, body: { leaveRequestId: draft.id, reason: 'à supprimer' } })).data
  const del = await apiRequest(`/derogations/${der.id}`, { method: 'DELETE', token: colAvec.token })
  const still = await myDerog(colAvec.token, draft.id)
  const inList = (await mgmt(rhToken)).find((x) => Number(x.id) === Number(der.id))
  record('D4-SUPPRESSION', 'Dérogation supprimée disparaît des listes RH', del.status === 204 && !still && !inList, `DELETE=${del.status}`)
}

// ---------------------------------------------------------------------------
// 5. Modification des dates : aucune ancienne dérogation active fantôme
// ---------------------------------------------------------------------------
{
  const d1 = nextNearDate()
  const d2 = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d1)
  const der = (await apiRequest('/derogations', { method: 'POST', token: colAvec.token, body: { leaveRequestId: draft.id, reason: 'ancienne sélection' } })).data
  // Changement de dates du brouillon -> invalidation de l'ancienne dérogation.
  await apiRequest(`/leave-requests/${draft.id}`, { method: 'PATCH', token: colAvec.token, body: { startDate: d2, endDate: d2 } })
  const derAfter = (await dbQuery('SELECT status FROM derogations WHERE id = ?', [der.id]))[0]
  const inList = (await mgmt(rhToken)).find((x) => Number(x.id) === Number(der.id))
  record('D5-DATES', 'Changement de dates ne laisse pas d’ancienne dérogation active', derAfter?.status === 'EXPIREE' && (!inList || inList.workflowStatus !== 'EN_ATTENTE_RH'), JSON.stringify({ db: derAfter, list: inList?.workflowStatus }))
}

// ---------------------------------------------------------------------------
// 6. RH accepte (circuit avec responsable) : RH puis Responsable signe final
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  await submit(colAvec.token, draft.id, { derogationReason: 'Dérogation acceptée' })
  const v1 = await validate(rhToken, draft.id, 'RH')
  const derMid = (await dbQuery('SELECT status, decided_by_rh_id FROM derogations WHERE leave_request_id = ?', [draft.id]))[0]
  record('D6-RH-ACCEPTE', 'RH valide le premier niveau (dérogation accordée)', v1.status === 200 && derMid?.status === 'ACCORDEE' && derMid?.decided_by_rh_id === rhId, `HTTP=${v1.status} der=${JSON.stringify(derMid)}`)
  const v2 = await validate(respToken, draft.id, 'RS')
  const fin = (await dbQuery('SELECT status FROM leave_requests WHERE id = ?', [draft.id]))[0]
  record('D6-RESP-FINAL', 'Responsable signe la validation finale', v2.status === 200 && fin?.status === 'VALIDEE', `HTTP=${v2.status} lr=${fin?.status}`)
}

// ---------------------------------------------------------------------------
// 7. RH refuse : la demande entière devient REFUSEE (dérogation REFUSEE)
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colSans.token, typeDerog.id, d)
  await submit(colSans.token, draft.id, { derogationReason: 'Dérogation refusée' })
  const ref = await refuse(rhToken, draft.id, 'Période impossible')
  const fin = (await dbQuery('SELECT status FROM leave_requests WHERE id = ?', [draft.id]))[0]
  const der = (await dbQuery('SELECT status FROM derogations WHERE leave_request_id = ?', [draft.id]))[0]
  record('D7-REFUS', 'Refus RH -> demande REFUSEE + dérogation REFUSEE', ref.status === 200 && fin?.status === 'REFUSEE' && der?.status === 'REFUSEE', `HTTP=${ref.status} lr=${fin?.status} der=${der?.status}`)
}

// ---------------------------------------------------------------------------
// 8. RH ne peut pas décider une dérogation liée à un brouillon (endpoint legacy neutralisé)
// ---------------------------------------------------------------------------
{
  const d = nextNearDate()
  const draft = await createDraft(colAvec.token, typeDerog.id, d)
  const der = (await apiRequest('/derogations', { method: 'POST', token: colAvec.token, body: { leaveRequestId: draft.id, reason: 'brouillon' } })).data
  const dec = await apiRequest(`/derogations/${der.id}/decision`, { method: 'PATCH', token: rhToken, body: { decision: 'ACCORDER' } })
  const derAfter = (await dbQuery('SELECT status, decided_by_rh_id FROM derogations WHERE id = ?', [der.id]))[0]
  record('D8-BROUILLON-DECISION', 'RH ne peut pas décider une dérogation sur brouillon', dec.status === 400 && derAfter?.status === 'EN_ATTENTE_RH' && derAfter?.decided_by_rh_id == null, `HTTP=${dec.status} der=${JSON.stringify(derAfter)}`)
}

// ---------------------------------------------------------------------------
// 9. Congé sans dérogation : pas de dérogation créée
// ---------------------------------------------------------------------------
{
  const d = nextFarDate()
  const draft = await createDraft(colSans.token, typeSans.id, d)
  const sub = await submit(colSans.token, draft.id)
  const count = (await dbQuery('SELECT COUNT(*) n FROM derogations WHERE leave_request_id = ?', [draft.id]))[0].n
  record('D9-SANS-DEROG', 'Congé ordinaire soumis sans dérogation', sub.status === 200 && count === 0, `HTTP=${sub.status} derog=${count}`)
}

// ---------------------------------------------------------------------------
// Résumé
// ---------------------------------------------------------------------------
console.log('\n=== RÉSUMÉ ===')
const okCount = results.filter((r) => r.status === 'Conforme').length
const koCount = results.filter((r) => r.status === 'Non conforme').length
console.log(`Total: ${results.length}, Conforme: ${okCount}, Non conforme: ${koCount}`)
for (const r of results.filter((x) => x.status === 'Non conforme')) {
  console.log(`  KO ${r.id} ${r.scenario} :: ${r.detail}`)
}

if (db) await db.end()
process.exitCode = koCount === 0 ? 0 : 1
