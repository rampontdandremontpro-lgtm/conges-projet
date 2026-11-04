// JUR-031 — congé de paternité et d'accueil de l'enfant : événement de
// naissance géré par le backend, jours calendaires, périodes, fractionnement,
// délais, prévenance, cumul sécurisé, concurrence, modification/annulation,
// justificatif et acquisition des congés payés.
import { apiRequest, login, dbConn, isoAddDays } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'PAT' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  if (!gmesId) {
    console.error('Entité GMES introuvable')
    process.exit(2)
  }

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const svcId = svc.data.id

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `PAT-${suffix}`, prenom: 'Recette', email: `pat-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const empLogin = async (suffix) => {
    const u = await mkEmp(suffix)
    await apiRequest(`/users/${u.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'PatTemp2026!Pass' } })
    return { ...u, token: await login(`pat-${suffix}.${TAG}@recette.fr`, 'PatTemp2026!Pass') }
  }

  // Types dédiés aux tests de flux.
  const mkType = async (name, kind, employeeCanCreate = true) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }
  const pat = await mkType('Paternité', 'PATERNITE_ACCUEIL')
  const naissance = await mkType('Naissance', 'NAISSANCE')

  const createBirthEvent = (token, dateNaissance, nbEnfants) =>
    apiRequest('/birth-events', { method: 'POST', token, body: { dateNaissance, nbEnfants } })

  const registerBirthLeave = async (token, dateNaissance) => {
    const d = await apiRequest('/absence-declarations', { method: 'POST', token, body: { leaveTypeId: naissance.id, startDate: dateNaissance, endDate: isoAddDays(dateNaissance, 2), familyEventContext: { eventDate: dateNaissance } } })
    await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token, body: { certifiedAccurate: true } })
    await apiRequest(`/absence-declarations/${d.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
    return d.data
  }

  const createDecl = (token, body) => apiRequest('/absence-declarations', { method: 'POST', token, body })
  const submit = (id, token) => apiRequest(`/absence-declarations/${id}/submit`, { method: 'POST', token, body: { certifiedAccurate: true } })
  const register = (id, extra = {}) => apiRequest(`/absence-declarations/${id}/register`, { method: 'POST', token: rhToken, body: extra })
  const cancel = (id) => apiRequest(`/absence-declarations/${id}/cancel`, { method: 'POST', token: rhToken })

  // ── 0. Type requis déjà classifié ────────────────────────────────────────
  const mgmt = await apiRequest('/leave-types/management', { token: rhToken })
  const requiredType = (mgmt.data ?? []).find((t) => t.name === 'Congé de paternité et d’accueil de l’enfant')
  rec('PAT-TYPE-EXISTANT', 'Type « Congé de paternité… » présent et classifié PATERNITE_ACCUEIL', requiredType?.absenceKind === 'PATERNITE_ACCUEIL', `kind=${requiredType?.absenceKind}`)
  rec('PAT-TYPE-COLLAB', 'Le collaborateur peut créer ce type', requiredType?.employeeCanCreate === true && requiredType?.rhOnly === false, `canCreate=${requiredType?.employeeCanCreate} rhOnly=${requiredType?.rhOnly}`)

  // ── 1. Sécurisation de l'événement de naissance ──────────────────────────
  const emp = await empLogin('EMP')
  const emp2 = await empLogin('EMP2')

  const ev1 = await createBirthEvent(emp.token, '2026-06-15', 1)
  rec('PAT-EVENT-CREATE', 'Création d’un événement de naissance (backend)', ev1.status === 201 && !!ev1.data?.id, `id=${ev1.data?.id?.slice(0, 8)}`)

  const dup = await createBirthEvent(emp.token, '2026-06-15', 1)
  rec('PAT-EVENT-DUPLICATE', 'Même naissance, second identifiant refusé (doublon de date)', dup.status === 409, `http=${dup.status}`)

  const distinct = await createBirthEvent(emp.token, '2025-03-01', 1)
  rec('PAT-EVENT-DISTINCT', 'Naissance distincte (autre date) : événement indépendant accepté', distinct.status === 201, `http=${distinct.status}`)

  const foreign = await createDecl(emp2.token, { leaveTypeId: pat.id, startDate: '2026-06-18', endDate: '2026-06-21', familyEventContext: { naissanceId: ev1.data.id, periode: 'PREMIERE' } })
  rec('PAT-EVENT-FOREIGN', 'Accès à l’événement d’un autre salarié refusé (403)', foreign.status === 403, `http=${foreign.status}`)

  const correctDenied = await apiRequest(`/birth-events/${ev1.data.id}`, { method: 'PATCH', token: emp.token, body: { nbEnfants: 2, reason: 'essai', source: 'test' } })
  rec('PAT-EVENT-CORRECT-DENIED', 'Correction par un collaborateur refusée (403)', correctDenied.status === 403, `http=${correctDenied.status}`)

  const correctOk = await apiRequest(`/birth-events/${ev1.data.id}`, { method: 'PATCH', token: rhToken, body: { nbEnfants: 2, reason: 'Naissance gémellaire confirmée', source: 'Acte de naissance' } })
  rec('PAT-EVENT-CORRECT-RH', 'Correction RH justifiée et historisée', correctOk.status === 200 && correctOk.data?.nbEnfants === 2 && (correctOk.data?.corrections?.length ?? 0) >= 1, `nb=${correctOk.data?.nbEnfants} corr=${correctOk.data?.corrections?.length}`)
  // Revenir à 1 enfant pour la suite.
  await apiRequest(`/birth-events/${ev1.data.id}`, { method: 'PATCH', token: rhToken, body: { nbEnfants: 1, reason: 'Correction annulée (enfant unique)', source: 'Acte de naissance' } })

  // ── 1b. Enchaînement, concurrence, exceptions ────────────────────────────
  const empE2 = await empLogin('EMPE')
  const evE2 = await apiRequest('/birth-events', { method: 'POST', token: empE2.token, body: { dateNaissance: '2026-06-15', nbEnfants: 1 } })
  await registerBirthLeave(empE2.token, '2026-06-15')
  const badLink = await createDecl(empE2.token, { leaveTypeId: pat.id, startDate: '2026-06-19', endDate: '2026-06-22', familyEventContext: { naissanceId: evE2.data.id, periode: 'PREMIERE' } })
  rec('PAT-ENCHAINEMENT', 'Première période non consécutive au congé de naissance refusée', badLink.status === 400, `http=${badLink.status}`)

  // Congé de naissance historique réparti sur plusieurs déclarations (2 j + 1 j).
  const empSplit = await empLogin('EMPSPLIT')
  const evSplit = await apiRequest('/birth-events', { method: 'POST', token: empSplit.token, body: { dateNaissance: '2025-06-01', nbEnfants: 1 } })
  const bl1 = await apiRequest('/absence-declarations', { method: 'POST', token: empSplit.token, body: { leaveTypeId: naissance.id, startDate: '2025-06-02', endDate: '2025-06-03', familyEventContext: { eventDate: '2025-06-01' } } })
  await submit(bl1.data.id, empSplit.token)
  await register(bl1.data.id)
  const bl2 = await apiRequest('/absence-declarations', { method: 'POST', token: empSplit.token, body: { leaveTypeId: naissance.id, startDate: '2025-06-05', endDate: '2025-06-05', familyEventContext: { eventDate: '2025-06-01' } } })
  await submit(bl2.data.id, empSplit.token)
  await register(bl2.data.id)
  const splitP1 = await createDecl(empSplit.token, { leaveTypeId: pat.id, startDate: '2025-06-06', endDate: '2025-06-09', familyEventContext: { naissanceId: evSplit.data.id, periode: 'PREMIERE' } })
  rec('PAT-ENCHAINEMENT-MULTI', 'Enchaînement avec congé de naissance réparti (2 j + 1 j) accepté', splitP1.status === 201, `http=${splitP1.status}`)

  const empY = await empLogin('EMPY')
  const [cA, cB] = await Promise.all([
    createBirthEvent(empY.token, '2026-09-10', 1),
    createBirthEvent(empY.token, '2026-09-10', 1),
  ])
  const createStatuses = [cA.status, cB.status].sort((a, b) => a - b)
  rec('PAT-EVENT-CONCURRENT', 'Deux créations concurrentes de même naissance : un seul événement', createStatuses[0] === 201 && createStatuses[1] === 409, `statuses=${createStatuses.join(',')}`)

  const empZ = await empLogin('EMPZ')
  const evZ = await apiRequest('/birth-events', { method: 'POST', token: empZ.token, body: { dateNaissance: '2026-10-01', nbEnfants: 1 } })
  const excNoNotice = await createDecl(empZ.token, { leaveTypeId: pat.id, startDate: '2026-11-02', endDate: '2026-11-06', familyEventContext: { naissanceId: evZ.data.id, periode: 'SECONDE', hospitalisationEnfant: true } })
  const excNoNoticeSub = await submit(excNoNotice.data.id, empZ.token)
  rec('PAT-EXCEPTION-SANS-PREVENANCE', 'Exception sans date de prévenance → vérification RH', excNoNoticeSub.status === 200 && excNoNoticeSub.data?.status === 'A_VERIFIER_PAR_RH', `status=${excNoNoticeSub.data?.status}`)

  const empR = await empLogin('EMPR')
  const rhEv = await apiRequest(`/birth-events?employeeId=${empR.id}`, { method: 'POST', token: rhToken, body: { dateNaissance: '2026-05-20', nbEnfants: 1 } })
  rec('PAT-RH-EVENT', 'La RH crée une naissance pour un autre salarié', rhEv.status === 201 && rhEv.data?.employeeId === empR.id, `http=${rhEv.status}`)
  const badRhEv = await apiRequest('/birth-events?employeeId=abc', { method: 'POST', token: rhToken, body: { dateNaissance: '2026-05-21', nbEnfants: 1 } })
  rec('PAT-RH-EVENT-INVALIDE', 'employeeId non numérique refusé (400)', badRhEv.status === 400, `http=${badRhEv.status}`)

  const empNo = await empLogin('EMPNO')
  const noEv = await createDecl(empNo.token, { leaveTypeId: pat.id, startDate: '2026-06-18', endDate: '2026-06-21', familyEventContext: { periode: 'PREMIERE' } })
  await submit(noEv.data.id, empNo.token)
  const noEvReg = await apiRequest(`/absence-declarations/${noEv.data.id}/register`, { method: 'POST', token: rhToken, body: { decisionReason: 'rattachement à faire', decisionSource: 'RH' } })
  rec('PAT-SANS-EVENT-FINAL', 'Décision finale sans événement de naissance refusée (400)', noEvReg.status === 400, `http=${noEvReg.status}`)

  // ── 2. Naissance simple : 25 jours calendaires (4 + 21) ──────────────────
  const birth1 = { naissanceId: ev1.data.id, dateNaissance: '2026-06-15', nbEnfants: 1 }
  await registerBirthLeave(emp.token, '2026-06-15')

  const p1 = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-06-18', endDate: '2026-06-21', familyEventContext: { ...birth1, periode: 'PREMIERE' } })
  rec('PAT-PREMIERE-4J', 'Première période : 4 jours calendaires (week-end inclus) acceptée', p1.status === 201 && p1.data?.durationDays === 4, `http=${p1.status} days=${p1.data?.durationDays}`)

  const p1bad = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-06-18', endDate: '2026-06-22', familyEventContext: { ...birth1, periode: 'PREMIERE' } })
  rec('PAT-PREMIERE-5J-REFUS', 'Première période de 5 jours refusée (doit être 4)', p1bad.status === 400, `http=${p1bad.status}`)

  const p1mod = await apiRequest(`/absence-declarations/${p1.data.id}`, { method: 'PATCH', token: emp.token, body: { endDate: '2026-06-22' } })
  rec('PAT-MODIF-FORME', 'Modification d’un brouillon en 5 jours refusée (forme)', p1mod.status === 400, `http=${p1mod.status}`)

  const s1 = await submit(p1.data.id, emp.token)
  rec('PAT-PREMIERE-SOUMIS', 'Première période soumise → à vérifier RH', s1.status === 200 && s1.data?.status === 'A_VERIFIER_PAR_RH', `status=${s1.data?.status}`)
  const r1 = await register(p1.data.id)
  rec('PAT-PREMIERE-ENREG', 'Première période enregistrée par la RH', r1.status === 200 && r1.data?.status === 'ENREGISTREE', `status=${r1.data?.status}`)

  // Fraude : le contexte client nbEnfants=2 est ignoré (l'événement vaut 1).
  const fraud = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-09-01', endDate: '2026-09-22', familyEventContext: { naissanceId: ev1.data.id, nbEnfants: 2, periode: 'SECONDE', prevenanceDate: '2026-07-15' } })
  rec('PAT-FRAUDE-1-2', 'Passage 1→2 enfants par le client sans effet (22 j refusés, plafond 21)', fraud.status === 400, `http=${fraud.status}`)

  const f1 = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-09-01', endDate: '2026-09-10', familyEventContext: { naissanceId: ev1.data.id, periode: 'SECONDE', prevenanceDate: '2026-07-15' } })
  rec('PAT-SECONDE-FRACTION-1', 'Seconde période fraction 1 (10 jours calendaires) acceptée', f1.status === 201, `http=${f1.status}`)
  await submit(f1.data.id, emp.token)
  await register(f1.data.id)

  const f2 = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-10-01', endDate: '2026-10-11', familyEventContext: { naissanceId: ev1.data.id, periode: 'SECONDE', prevenanceDate: '2026-08-15' } })
  rec('PAT-SECONDE-FRACTION-2', 'Seconde période fraction 2 (11 jours) acceptée', f2.status === 201, `http=${f2.status}`)
  await submit(f2.data.id, emp.token)
  await register(f2.data.id)

  const f3 = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-10-15', endDate: '2026-10-19', familyEventContext: { naissanceId: ev1.data.id, periode: 'SECONDE', prevenanceDate: '2026-09-01' } })
  rec('PAT-TROISIEME-FRACTION', 'Troisième fraction refusée (deux périodes max)', f3.status === 400 && /Dépassement|dépassement|période/i.test(f3.data?.message ?? ''), `http=${f3.status} msg=${f3.data?.message}`)

  const over = await createDecl(emp.token, { leaveTypeId: pat.id, startDate: '2026-10-15', endDate: '2026-10-25', familyEventContext: { naissanceId: ev1.data.id, periode: 'SECONDE', prevenanceDate: '2026-09-01' } })
  rec('PAT-DEPASSEMENT-25', 'Dépassement du total de 25 jours refusé', over.status === 400, `http=${over.status}`)

  // ── 3. Naissances multiples : 32 jours calendaires maximum ───────────────
  const empM = await empLogin('EMPM')
  const evM = await createBirthEvent(empM.token, '2026-06-01', 2)
  await registerBirthLeave(empM.token, '2026-06-01')

  const m1 = await createDecl(empM.token, { leaveTypeId: pat.id, startDate: '2026-06-04', endDate: '2026-06-07', familyEventContext: { naissanceId: evM.data.id, periode: 'PREMIERE' } })
  await submit(m1.data.id, empM.token)
  await register(m1.data.id)
  const m2 = await createDecl(empM.token, { leaveTypeId: pat.id, startDate: '2026-07-01', endDate: '2026-07-14', familyEventContext: { naissanceId: evM.data.id, periode: 'SECONDE', prevenanceDate: '2026-06-01' } })
  await submit(m2.data.id, empM.token)
  await register(m2.data.id)
  const m3 = await createDecl(empM.token, { leaveTypeId: pat.id, startDate: '2026-08-01', endDate: '2026-08-14', familyEventContext: { naissanceId: evM.data.id, periode: 'SECONDE', prevenanceDate: '2026-07-01' } })
  rec('PAT-MULTIPLES-32', 'Naissances multiples : 4 + 14 + 14 = 32 jours acceptés', m3.status === 201, `http=${m3.status}`)
  await submit(m3.data.id, empM.token)
  await register(m3.data.id)
  const mOver = await createDecl(empM.token, { leaveTypeId: pat.id, startDate: '2026-08-20', endDate: '2026-08-24', familyEventContext: { naissanceId: evM.data.id, periode: 'SECONDE', prevenanceDate: '2026-07-20' } })
  rec('PAT-MULTIPLES-DEPASSEMENT', 'Naissances multiples : 33e jour refusé', mOver.status === 400, `http=${mOver.status}`)

  const corrDown = await apiRequest(`/birth-events/${evM.data.id}`, { method: 'PATCH', token: rhToken, body: { nbEnfants: 1, reason: 'correction', source: 'acte' } })
  rec('PAT-CORRECTION-DROITS', 'Correction 2→1 enfants avec 32 j déjà pris refusée', corrDown.status === 400, `http=${corrDown.status}`)

  // ── 4. Délai de 6 mois, prévenance et exceptions ────────────────────────
  const empD = await empLogin('EMPD')
  const evD = await createBirthEvent(empD.token, '2026-07-01', 1)
  const late = await createDecl(empD.token, { leaveTypeId: pat.id, startDate: '2027-02-01', endDate: '2027-02-05', familyEventContext: { naissanceId: evD.data.id, periode: 'SECONDE', prevenanceDate: '2027-01-01' } })
  rec('PAT-DELAI-6MOIS', 'Seconde période au-delà de 6 mois refusée', late.status === 400 && /6 mois/i.test(late.data?.message ?? ''), `http=${late.status} msg=${late.data?.message}`)

  const except = await createDecl(empD.token, { leaveTypeId: pat.id, startDate: '2027-02-01', endDate: '2027-02-05', familyEventContext: { naissanceId: evD.data.id, periode: 'SECONDE', prevenanceDate: '2027-01-01', hospitalisationEnfant: true } })
  rec('PAT-DELAI-EXCEPTION', 'Dépassement avec hospitalisation → vérification RH (non refusé)', except.status === 201, `http=${except.status}`)

  const noNotice = await createDecl(empD.token, { leaveTypeId: pat.id, startDate: '2026-11-02', endDate: '2026-11-06', familyEventContext: { naissanceId: evD.data.id, periode: 'SECONDE' } })
  const noNoticeSub = await submit(noNotice.data.id, empD.token)
  rec('PAT-PREVENANCE', 'Prévenance manquante → soumis à vérification RH', noNoticeSub.status === 200 && noNoticeSub.data?.status === 'A_VERIFIER_PAR_RH', `status=${noNoticeSub.data?.status}`)

  // ── 5. Annulation restitue les jours ─────────────────────────────────────
  const empC = await empLogin('EMPC')
  const evC = await createBirthEvent(empC.token, '2026-06-01', 1)
  await registerBirthLeave(empC.token, '2026-06-01')

  const c1 = await createDecl(empC.token, { leaveTypeId: pat.id, startDate: '2026-06-04', endDate: '2026-06-07', familyEventContext: { naissanceId: evC.data.id, periode: 'PREMIERE' } })
  await submit(c1.data.id, empC.token)
  await register(c1.data.id)
  const c2 = await createDecl(empC.token, { leaveTypeId: pat.id, startDate: '2026-07-01', endDate: '2026-07-10', familyEventContext: { naissanceId: evC.data.id, periode: 'SECONDE', prevenanceDate: '2026-06-01' } })
  await submit(c2.data.id, empC.token)
  await register(c2.data.id)
  const c3 = await createDecl(empC.token, { leaveTypeId: pat.id, startDate: '2026-08-01', endDate: '2026-08-11', familyEventContext: { naissanceId: evC.data.id, periode: 'SECONDE', prevenanceDate: '2026-07-01' } })
  await submit(c3.data.id, empC.token)
  await register(c3.data.id)
  const cOver = await createDecl(empC.token, { leaveTypeId: pat.id, startDate: '2026-09-01', endDate: '2026-09-05', familyEventContext: { naissanceId: evC.data.id, periode: 'SECONDE', prevenanceDate: '2026-08-01' } })
  rec('PAT-ANNUL-AVANT', 'Jour supplémentaire refusé avant annulation', cOver.status === 400, `http=${cOver.status}`)
  const cancelResp = await cancel(c2.data.id)
  rec('PAT-ANNULATION', 'Annulation RH d’une fraction', cancelResp.status === 200 && cancelResp.data?.status === 'ANNULEE', `status=${cancelResp.data?.status}`)
  const cAfter = await createDecl(empC.token, { leaveTypeId: pat.id, startDate: '2026-09-01', endDate: '2026-09-10', familyEventContext: { naissanceId: evC.data.id, periode: 'SECONDE', prevenanceDate: '2026-08-01' } })
  rec('PAT-ANNUL-APRES', 'Les jours annulés sont restitués (nouvelle fraction acceptée)', cAfter.status === 201, `http=${cAfter.status}`)

  // ── 6. Concurrence : deux soumissions simultanées, une seule acceptée ────
  const empX = await empLogin('EMPX')
  const evX = await createBirthEvent(empX.token, '2026-06-01', 1)
  const dA = await createDecl(empX.token, { leaveTypeId: pat.id, startDate: '2026-09-01', endDate: '2026-09-21', familyEventContext: { naissanceId: evX.data.id, periode: 'SECONDE', prevenanceDate: '2026-08-01' } })
  const dB = await createDecl(empX.token, { leaveTypeId: pat.id, startDate: '2026-10-01', endDate: '2026-10-21', familyEventContext: { naissanceId: evX.data.id, periode: 'SECONDE', prevenanceDate: '2026-09-01' } })
  const [subA, subB] = await Promise.all([submit(dA.data.id, empX.token), submit(dB.data.id, empX.token)])
  const statuses = [subA.status, subB.status].sort((a, b) => a - b)
  rec('PAT-CONCURRENCE', 'Deux soumissions concurrentes : une seule acceptée', statuses[0] === 200 && statuses[1] === 400, `statuses=${statuses.join(',')}`)

  // ── 7. Acquisition des congés payés non réduite par la paternité ─────────
  const acc = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-08' } })
  const credited = (acc.data?.creditedEmployees ?? []).find((e) => e.employeeId === emp.id)
  rec('PAT-ACQUISITION', 'Acquisition août 2026 créditée (2,5 j) malgré la paternité', acc.status === 201 && !!credited, `http=${acc.status} rate=${acc.data?.daysPerEmployee} credited=${!!credited}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-031 PATERNITÉ : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-031 PATERNITÉ :', e); process.exit(1) })
