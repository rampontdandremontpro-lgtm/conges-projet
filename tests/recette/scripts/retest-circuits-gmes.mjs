// Retest ciblé des 4 circuits de validation GMES (12 parcours métier).
// - Actions réelles via API uniquement (aucune insertion SQL de validation).
// - Vérification des statuts en base (lecture seule).
// - Base cible : gestion_conges_gmes_test (API sur 3001).

import { apiRequest } from '../helpers/api.mjs'
import { dbConn, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'CIRC' + Date.now().toString(36)
const results = []

function record(id, scenario, ok, detail, comment = '') {
  results.push({
    id,
    scenario,
    status: ok ? 'Conforme' : 'Non conforme',
    detail,
    comment,
    date: new Date().toISOString(),
  })
  console.log(`${ok ? 'OK ' : 'KO '} ${id} ${scenario} :: ${detail}${comment ? ` (${comment})` : ''}`)
}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function weekday(iso) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) {
    if (weekday(s) >= 1 && weekday(s) <= 5) return s
    s = isoAddDays(s, 1)
  }
  return s
}

// Curseurs de dates strictement croissants pour éviter tout chevauchement.
let farCursor = isoAddDays(todayIso(), 40)
let nearCursor = isoAddDays(todayIso(), 3)
function nextFarDate() {
  farCursor = advanceToWeekday(farCursor)
  const d = farCursor
  farCursor = isoAddDays(farCursor, 1)
  return d
}
function nextNearDate() {
  nearCursor = advanceToWeekday(nearCursor)
  const d = nearCursor
  nearCursor = isoAddDays(nearCursor, 1)
  return d
}

let db
async function dbQuery(sql, params = []) {
  if (!db) db = await dbConn()
  const [rows] = await db.query(sql, params)
  return rows
}

async function createLeaveType(label, extra = {}) {
  const r = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `CP ${label} ${TAG}`,
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
      ...extra,
    },
  })
  if (r.status !== 201) throw new Error(`leave-type ${label} -> ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}

async function createService(name, { primaryManagerId, validationMode } = {}) {
  const r = await apiRequest('/services', {
    method: 'POST',
    token: adminToken,
    body: {
      name,
      serviceType: 'INTERNE',
      minimumPresence: 1,
      hasMinimumPresenceRule: false,
    },
  })
  if (r.status !== 201) throw new Error(`service ${name} -> ${r.status} ${JSON.stringify(r.data)}`)
  const svc = r.data
  if (primaryManagerId !== undefined || validationMode) {
    const patch = await apiRequest(`/services/${svc.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        ...(primaryManagerId !== undefined ? { primaryManagerId } : {}),
        ...(validationMode ? { validationMode } : {}),
        takeoverDelayDays: 7,
      },
    })
    if (patch.status !== 200) throw new Error(`service patch -> ${patch.status} ${JSON.stringify(patch.data)}`)
    return patch.data
  }
  return svc
}

async function createUser(nom, prenom, role, serviceId, extra = {}) {
  const r = await apiRequest('/users', {
    method: 'POST',
    token: adminToken,
    body: {
      nom,
      prenom,
      email: `${nom.toLowerCase()}.${prenom.toLowerCase()}.${TAG}@recette.fr`,
      role,
      employmentType: 'INTERNE',
      serviceId: serviceId ?? undefined,
      hireDate: '2026-01-06',
      ...extra,
    },
  })
  if (r.status !== 201) throw new Error(`user ${nom} -> ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}

async function setUserService(userId, serviceId) {
  const r = await apiRequest(`/users/${userId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { serviceId },
  })
  if (r.status !== 200) throw new Error(`setUserService -> ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}

async function createDraft(employeeToken, leaveTypeId, startDate, endDate) {
  const r = await apiRequest('/leave-requests', {
    method: 'POST',
    token: employeeToken,
    body: {
      leaveTypeId,
      startDate,
      endDate,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    },
  })
  if (r.status !== 201) throw new Error(`draft -> ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}

async function createDerogation(employeeToken, leaveRequestId, reason) {
  const r = await apiRequest('/derogations', {
    method: 'POST',
    token: employeeToken,
    body: { leaveRequestId, reason },
  })
  if (r.status !== 201) throw new Error(`derogation -> ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
}

async function submit(employeeToken, requestId, initials) {
  return apiRequest(`/leave-requests/${requestId}/submit`, {
    method: 'POST',
    token: employeeToken,
    body: { signatureType: 'INITIALS', signatureData: initials },
  })
}

async function validate(token, requestId, initials, extra = {}) {
  return apiRequest(`/leave-requests/${requestId}/validate`, {
    method: 'POST',
    token,
    body: { signatureType: 'INITIALS', signatureData: initials, ...extra },
  })
}

async function refuse(token, requestId, comment) {
  return apiRequest(`/leave-requests/${requestId}/refuse`, {
    method: 'POST',
    token,
    body: { comment },
  })
}

async function getManagement(requestId, token) {
  return (await apiRequest(`/leave-requests/management/${requestId}`, { token })).data
}

async function verifyDbStatus(requestId) {
  const rows = await dbQuery(
    'SELECT status, final_decider_id, final_decider_role, employee_signed_at, validator_signed_at, decision_at FROM leave_requests WHERE id = ?',
    [requestId],
  )
  return rows[0] ?? null
}

async function verifyDerogationStatus(requestId) {
  const rows = await dbQuery(
    'SELECT status, decided_by_rh_id, decided_at FROM derogations WHERE leave_request_id = ?',
    [requestId],
  )
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Comptes de base
// ---------------------------------------------------------------------------
const adminToken = await login('admin.recette@gmes.fr')
const rhToken = await login('rh.recette@gmes.fr')
const dirToken = await login('directeur.recette@gmes.fr')
const respToken = await login('responsable.recette@gmes.fr')

const me = async (token) => (await apiRequest('/users/me', { token })).data
const rhId = (await me(rhToken)).id
const dirId = (await me(dirToken)).id
const respId = (await me(respToken)).id

console.log(`\n=== Retest circuits GMES (${TAG}) ===`)
console.log(`rhId=${rhId} dirId=${dirId} respId=${respId}`)

// ---------------------------------------------------------------------------
// Préparation : services « sans responsable » et « avec responsable »
// ---------------------------------------------------------------------------
const svcSansResp = await createService(`CIRCUIT-SANS-RESP-${TAG}`, {})
const svcAvecResp = await createService(`CIRCUIT-AVEC-RESP-${TAG}`, {})
await setUserService(respId, svcAvecResp.id)
await apiRequest(`/services/${svcAvecResp.id}`, {
  method: 'PATCH',
  token: adminToken,
  body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 },
})

// Collaborateurs de test (JWT signé directement, comme les autres modules de recette).
const colSans = await createUser('COL', 'SANSRESP', 'COLLABORATEUR', svcSansResp.id)
const colAvec = await createUser('COL', 'AVECRESP', 'COLLABORATEUR', svcAvecResp.id)
const colSansToken = signAccessToken({ id: colSans.id, email: colSans.email, role: 'COLLABORATEUR' })
const colAvecToken = signAccessToken({ id: colAvec.id, email: colAvec.email, role: 'COLLABORATEUR' })

console.log(`colSans.id=${colSans.id} colAvec.id=${colAvec.id}`)
console.log(`svcSansResp.id=${svcSansResp.id} (DIRECTEUR_ET_RH) svcAvecResp.id=${svcAvecResp.id} (RESPONSABLE_PUIS_RELAIS)`)

// ---------------------------------------------------------------------------
// Helpers de parcours
// ---------------------------------------------------------------------------
async function runFullValidation({ circuit, employeeToken, leaveType, getDate, withDerogation, first, firstInit, second, secondInit }) {
  const startDate = getDate()
  const request = await createDraft(employeeToken, leaveType.id, startDate, startDate)
  if (withDerogation) {
    await createDerogation(employeeToken, request.id, 'Dérogation test circuit ' + circuit)
  }
  const sub = await submit(employeeToken, request.id, 'CO')
  if (sub.status !== 200) {
    record(`${circuit}-VALID`, `Soumission circuit ${circuit}`, false, `submit HTTP=${sub.status} ${JSON.stringify(sub.data)}`)
    return null
  }

  const mgmtFirst = await getManagement(request.id, first.token)
  const firstOk = mgmtFirst?.decisionAccess != null
  record(`${circuit}-VALID`, `Premier valideur autorisé (${first.role})`, firstOk, `decisionAccess=${mgmtFirst?.decisionAccess?.kind}`)

  const premature = await validate(second.token, request.id, 'ZZ')
  record(`${circuit}-VALID`, `Second valideur bloqué prématurément (${second.role})`, premature.status === 403 || premature.status === 400, `HTTP=${premature.status}`)

  const v1 = await validate(first.token, request.id, firstInit)
  record(`${circuit}-VALID`, `Premier niveau validé (${first.role})`, v1.status === 200 && v1.data?.workflowStatus === 'EN_COURS_TRAITEMENT', `HTTP=${v1.status} stage=${v1.data?.validationStage}`)

  const mid = await verifyDbStatus(request.id)
  record(`${circuit}-VALID`, `Statut intermédiaire EN_ATTENTE_VALIDATION + finalDeciderId`, mid?.status === 'EN_ATTENTE_VALIDATION' && mid?.final_decider_id != null, JSON.stringify(mid))

  const v2 = await validate(second.token, request.id, secondInit)
  record(`${circuit}-VALID`, `Second niveau validé (${second.role})`, v2.status === 200 && v2.data?.status === 'VALIDEE', `HTTP=${v2.status} status=${v2.data?.status}`)

  const fin = await verifyDbStatus(request.id)
  record(`${circuit}-VALID`, `Statut final VALIDEE`, fin?.status === 'VALIDEE', JSON.stringify(fin))

  if (withDerogation) {
    const der = await verifyDerogationStatus(request.id)
    record(`${circuit}-VALID`, `Dérogation accordée par RH`, der?.status === 'ACCORDEE' && der?.decided_by_rh_id != null, JSON.stringify(der))
  }
  return request
}

async function runRefuseFirst({ circuit, employeeToken, leaveType, getDate, withDerogation, first, firstInit }) {
  const startDate = getDate()
  const request = await createDraft(employeeToken, leaveType.id, startDate, startDate)
  if (withDerogation) {
    await createDerogation(employeeToken, request.id, 'Dérogation refusée circuit ' + circuit)
  }
  const sub = await submit(employeeToken, request.id, 'CO')
  if (sub.status !== 200) {
    record(`${circuit}-REFUS1`, `Soumission circuit ${circuit}`, false, `submit HTTP=${sub.status} ${JSON.stringify(sub.data)}`)
    return null
  }
  const ref = await refuse(first.token, request.id, 'Refus premier valideur')
  record(`${circuit}-REFUS1`, `Refus premier valideur (${first.role})`, ref.status === 200 && ref.data?.status === 'REFUSEE', `HTTP=${ref.status} status=${ref.data?.status}`)
  const fin = await verifyDbStatus(request.id)
  record(`${circuit}-REFUS1`, `Statut final REFUSEE`, fin?.status === 'REFUSEE', JSON.stringify(fin))
  if (withDerogation) {
    const der = await verifyDerogationStatus(request.id)
    record(`${circuit}-REFUS1`, `Dérogation REFUSEE`, der?.status === 'REFUSEE', JSON.stringify(der))
  }
  return request
}

async function runRefuseSecond({ circuit, employeeToken, leaveType, getDate, withDerogation, first, firstInit, second }) {
  const startDate = getDate()
  const request = await createDraft(employeeToken, leaveType.id, startDate, startDate)
  if (withDerogation) {
    await createDerogation(employeeToken, request.id, 'Dérogation acceptée RH puis refus final circuit ' + circuit)
  }
  const sub = await submit(employeeToken, request.id, 'CO')
  if (sub.status !== 200) {
    record(`${circuit}-REFUS2`, `Soumission circuit ${circuit}`, false, `submit HTTP=${sub.status} ${JSON.stringify(sub.data)}`)
    return null
  }
  const v1 = await validate(first.token, request.id, firstInit)
  const ref = await refuse(second.token, request.id, 'Refus second valideur')
  record(`${circuit}-REFUS2`, `Refus second valideur (${second.role})`, v1.status === 200 && ref.status === 200 && ref.data?.status === 'REFUSEE', `v1=${v1.status} ref=${ref.status} status=${ref.data?.status}`)
  const fin = await verifyDbStatus(request.id)
  record(`${circuit}-REFUS2`, `Statut final REFUSEE`, fin?.status === 'REFUSEE', JSON.stringify(fin))
  return request
}

// ---------------------------------------------------------------------------
// Types de congé
// ---------------------------------------------------------------------------
const typeSansDerog = await createLeaveType('SANS-DEROG')
const typeAvecDerog = await createLeaveType('AVEC-DEROG')
const typeSolde = await createLeaveType('SOLDE', { deductsPaidLeaveBalance: true })

// ---------------------------------------------------------------------------
// CIRCUIT 1 — sans responsable, sans dérogation : Collab -> RH -> Directeur
// ---------------------------------------------------------------------------
console.log('\n=== CIRCUIT 1 ===')
await runFullValidation({
  circuit: 'C1',
  employeeToken: colSansToken,
  leaveType: typeSansDerog,
  getDate: nextFarDate,
  withDerogation: false,
  first: { token: rhToken, role: 'RH' },
  firstInit: 'RH',
  second: { token: dirToken, role: 'DIRECTEUR' },
  secondInit: 'DR',
})
await runRefuseFirst({ circuit: 'C1', employeeToken: colSansToken, leaveType: typeSansDerog, getDate: nextFarDate, withDerogation: false, first: { token: rhToken, role: 'RH' }, firstInit: 'RH' })
await runRefuseSecond({ circuit: 'C1', employeeToken: colSansToken, leaveType: typeSansDerog, getDate: nextFarDate, withDerogation: false, first: { token: rhToken, role: 'RH' }, firstInit: 'RH', second: { token: dirToken, role: 'DIRECTEUR' } })

// ---------------------------------------------------------------------------
// CIRCUIT 2 — avec responsable, sans dérogation : Collab -> Responsable -> RH
// ---------------------------------------------------------------------------
console.log('\n=== CIRCUIT 2 ===')
await runFullValidation({
  circuit: 'C2',
  employeeToken: colAvecToken,
  leaveType: typeSansDerog,
  getDate: nextFarDate,
  withDerogation: false,
  first: { token: respToken, role: 'RESPONSABLE' },
  firstInit: 'RS',
  second: { token: rhToken, role: 'RH' },
  secondInit: 'RH',
})
await runRefuseFirst({ circuit: 'C2', employeeToken: colAvecToken, leaveType: typeSansDerog, getDate: nextFarDate, withDerogation: false, first: { token: respToken, role: 'RESPONSABLE' }, firstInit: 'RS' })
await runRefuseSecond({ circuit: 'C2', employeeToken: colAvecToken, leaveType: typeSansDerog, getDate: nextFarDate, withDerogation: false, first: { token: respToken, role: 'RESPONSABLE' }, firstInit: 'RS', second: { token: rhToken, role: 'RH' } })

// ---------------------------------------------------------------------------
// CIRCUIT 3 — sans responsable, avec dérogation : Collab -> RH -> Directeur
// ---------------------------------------------------------------------------
console.log('\n=== CIRCUIT 3 ===')
await runFullValidation({
  circuit: 'C3',
  employeeToken: colSansToken,
  leaveType: typeAvecDerog,
  getDate: nextNearDate,
  withDerogation: true,
  first: { token: rhToken, role: 'RH' },
  firstInit: 'RH',
  second: { token: dirToken, role: 'DIRECTEUR' },
  secondInit: 'DR',
})
await runRefuseFirst({ circuit: 'C3', employeeToken: colSansToken, leaveType: typeAvecDerog, getDate: nextNearDate, withDerogation: true, first: { token: rhToken, role: 'RH' }, firstInit: 'RH' })
await runRefuseSecond({ circuit: 'C3', employeeToken: colSansToken, leaveType: typeAvecDerog, getDate: nextNearDate, withDerogation: true, first: { token: rhToken, role: 'RH' }, firstInit: 'RH', second: { token: dirToken, role: 'DIRECTEUR' } })

// ---------------------------------------------------------------------------
// CIRCUIT 4 — avec responsable, avec dérogation : Collab -> RH -> Responsable
// ---------------------------------------------------------------------------
console.log('\n=== CIRCUIT 4 ===')
await runFullValidation({
  circuit: 'C4',
  employeeToken: colAvecToken,
  leaveType: typeAvecDerog,
  getDate: nextNearDate,
  withDerogation: true,
  first: { token: rhToken, role: 'RH' },
  firstInit: 'RH',
  second: { token: respToken, role: 'RESPONSABLE' },
  secondInit: 'RS',
})
await runRefuseFirst({ circuit: 'C4', employeeToken: colAvecToken, leaveType: typeAvecDerog, getDate: nextNearDate, withDerogation: true, first: { token: rhToken, role: 'RH' }, firstInit: 'RH' })
await runRefuseSecond({ circuit: 'C4', employeeToken: colAvecToken, leaveType: typeAvecDerog, getDate: nextNearDate, withDerogation: true, first: { token: rhToken, role: 'RH' }, firstInit: 'RH', second: { token: respToken, role: 'RESPONSABLE' } })

// ---------------------------------------------------------------------------
// Contrôles complémentaires
// ---------------------------------------------------------------------------
console.log('\n=== CONTRÔLES COMPLÉMENTAIRES ===')

// Tentative de validation par un rôle non autorisé (Responsable sur Circuit 1)
{
  const startDate = nextFarDate()
  const request = await createDraft(colSansToken, typeSansDerog.id, startDate, startDate)
  await submit(colSansToken, request.id, 'CO')
  const r = await validate(respToken, request.id, 'ZZ')
  record('CTRL-ROLE', 'Responsable non autorisé sur circuit sans responsable', r.status === 403, `HTTP=${r.status}`)
}

// Double validation (premier valideur tente de re-valider après transmission)
{
  const startDate = nextFarDate()
  const request = await createDraft(colSansToken, typeSansDerog.id, startDate, startDate)
  await submit(colSansToken, request.id, 'CO')
  await validate(rhToken, request.id, 'RH')
  const again = await validate(rhToken, request.id, 'RH')
  record('CTRL-DOUBLE', 'RH ne peut pas re-valider après transmission au Directeur', again.status === 403, `HTTP=${again.status}`)
}

// Soumission avec dérogation sans retour préalable au brouillon
{
  const startDate = nextNearDate()
  const request = await createDraft(colAvecToken, typeAvecDerog.id, startDate, startDate)
  await createDerogation(colAvecToken, request.id, 'Dérogation immédiate')
  const sub = await submit(colAvecToken, request.id, 'CO')
  const mgmt = await getManagement(request.id, rhToken)
  record('CTRL-DEROG', 'Soumission immédiate avec dérogation (sans accord préalable)', sub.status === 200 && mgmt?.decisionAccess?.kind === 'RH_PREMIERE_VALIDATION', `submit=${sub.status} access=${mgmt?.decisionAccess?.kind}`)
}

// Non-régression des congés ordinaires (délai respecté -> pas de dérogation requise)
{
  const startDate = nextFarDate()
  const request = await createDraft(colSansToken, typeSansDerog.id, startDate, startDate)
  const sub = await submit(colSansToken, request.id, 'CO')
  const mgmt = await getManagement(request.id, rhToken)
  record('CTRL-ORDINAIRE', 'Congé ordinaire soumis sans dérogation', sub.status === 200 && mgmt?.decisionAccess?.kind === 'RH_PREMIERE_VALIDATION', `submit=${sub.status} access=${mgmt?.decisionAccess?.kind}`)
}

// Contrôle de solde : Circuit 1 avec un type débitant le solde, départ aujourd'hui.
{
  const refPeriod = '2026-2027'
  await apiRequest('/leave-balances/initialize', {
    method: 'POST',
    token: adminToken,
    body: { employeeId: colSans.id, referencePeriod: refPeriod, counterType: 'N', acquiredDays: 10, reason: 'Initialisation retest circuits' },
  })
  const today = todayIso()
  const request = await createDraft(colSansToken, typeSolde.id, today, today)
  await createDerogation(colSansToken, request.id, 'Dérogation pour départ immédiat (contrôle solde)')
  const sub = await submit(colSansToken, request.id, 'CO')
  await validate(rhToken, request.id, 'RH')
  const midDeductions = await dbQuery(
    `SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id = ? AND movement_type = 'DEDUCTION'`,
    [request.id],
  )
  await validate(dirToken, request.id, 'DR')
  const finDeductions = await dbQuery(
    `SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id = ? AND movement_type = 'DEDUCTION'`,
    [request.id],
  )
  // Le solde n'est débité qu'au début effectif du congé (jamais au premier niveau,
  // et jamais deux fois). Pour une demande dont le départ n'est pas encore passé,
  // aucune écriture de déduction ne doit exister après validation finale.
  record('CTRL-SOLDE', 'Solde non débité au premier niveau et jamais débité deux fois', sub.status === 200 && Number(midDeductions[0].n) === 0 && Number(finDeductions[0].n) <= 1, `submit=${sub.status} mid=${midDeductions[0].n} fin=${finDeductions[0].n}`)
}

// Vérification signatures et historique (circuit 1 validé)
{
  const startDate = nextFarDate()
  const request = await createDraft(colSansToken, typeSansDerog.id, startDate, startDate)
  const sub = await submit(colSansToken, request.id, 'CO')
  const v1 = await validate(rhToken, request.id, 'RH')
  const v2 = await validate(dirToken, request.id, 'DR')
  const row = await dbQuery(
    `SELECT employee_signature_type, validator_signature_type, validator_signed_at, decision_at, final_decider_id, final_decider_role FROM leave_requests WHERE id = ?`,
    [request.id],
  )
  const audits = await dbQuery(
    `SELECT action, actor_id, new_value FROM audit_logs WHERE resource_type = 'LEAVE_REQUESTS' AND resource_id = ? ORDER BY id ASC`,
    [request.id],
  )
  const actions = audits.map((a) => a.action)
  const hasPre = actions.includes('DEMANDE_PREVALIDEE')
  const hasVal = actions.includes('DEMANDE_VALIDEE')
  const preMeta = audits.find((a) => a.action === 'DEMANDE_PREVALIDEE')
  const preMetaOk = preMeta?.new_value?.metadata?.firstLevelSignatureData === 'RH'
  record('CTRL-SIGN', 'Signatures et historique enregistrés (2 niveaux)', sub.status === 200 && v1.status === 200 && v2.status === 200 && row[0]?.employee_signature_type != null && row[0]?.validator_signature_type != null && hasPre && hasVal && preMetaOk, JSON.stringify({ actions, employeeSig: row[0]?.employee_signature_type, validatorSig: row[0]?.validator_signature_type, preMetaOk }))
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
