// JUR-029/030 — corrections ciblées : versions légales de l'annonce handicap,
// article 5.7 Syntec complet, quotas deuil/enfant malade, décision RH motivée,
// concurrence et permissions.
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'COR2930' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const effId = ents.find((e) => e.code === 'EFFICIENCE')?.id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const svcId = svc.data.id

  const mkEmp = async (suffix, entId, role = 'COLLABORATEUR') => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `C-${suffix}`, prenom: 'Recette', email: `c-${suffix}.${TAG}@recette.fr`, role, employmentType: 'INTERNE', serviceId: svcId, hireDate: '2015-05-01', legalEntityId: entId } })).data
  const mkCol = async (suffix, entId) => {
    const u = await mkEmp(suffix, entId)
    await apiRequest(`/users/${u.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'CorrTemp2026!Pass' } })
    return { ...u, token: await login(`c-${suffix}.${TAG}@recette.fr`, 'CorrTemp2026!Pass') }
  }
  const mkType = async (name, kind, employeeCanCreate = true, documentRequired = true) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired, documentCanBeAddedLater: documentRequired, employeeCanCreate, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }

  const empG = await mkEmp('G', gmesId)
  const mariageEnfant = await mkType('Mariage enfant', 'MARIAGE_ENFANT', false)
  const deces = await mkType('Décès proche', 'DECES', false)
  const annonce = await mkType('Annonce handicap', 'ANNONCE_HANDICAP_ENFANT', false)

  const rule = (typeId, date, employeeId, qs = '') => apiRequest(`/leave-types/${typeId}/family-event-rule?date=${date}&employeeId=${employeeId}${qs}`, { token: rhToken }).then((r) => r.data)

  // ── Annonce handicap : versions légales ───────────────────────────────────
  const a2017 = await rule(annonce.id, '2017-06-01', empG.id, '&natureAnnonce=HANDICAP')
  rec('COR-ANNONCE-2017', 'Annonce handicap 2017 : 2 jours ouvrables', a2017?.days === 2 && a2017?.unit === 'OUVRABLES', `days=${a2017?.days}`)
  const a2020 = await rule(annonce.id, '2020-01-15', empG.id, '&natureAnnonce=HANDICAP')
  rec('COR-ANNONCE-2020', 'Annonce handicap 2020 : 2 jours ouvrables', a2020?.days === 2 && a2020?.unit === 'OUVRABLES', `days=${a2020?.days}`)
  const aPatho = await rule(annonce.id, '2021-12-18', empG.id, '&natureAnnonce=PATHOLOGIE_CHRONIQUE')
  rec('COR-ANNONCE-PATHO-ANTE', 'Annonce pathologie chronique < 19/12/2021 : 0 j + vérification RH', aPatho?.days === 0 && aPatho?.anomalies?.length > 0, `days=${aPatho?.days}`)
  const a2 = await rule(annonce.id, '2023-07-20', empG.id)
  rec('COR-ANNONCE-2J', 'Annonce 20/07/2023 : 2 jours ouvrables (version 2021)', a2?.days === 2 && a2?.unit === 'OUVRABLES', `days=${a2?.days}`)
  const a5 = await rule(annonce.id, '2023-07-21', empG.id)
  rec('COR-ANNONCE-5J', 'Annonce 21/07/2023 : 5 jours ouvrables', a5?.days === 5, `days=${a5?.days}`)
  const a5bis = await rule(annonce.id, '2026-06-13', empG.id)
  rec('COR-ANNONCE-5J-2026', 'Annonce 13/06/2026 : 5 jours ouvrables', a5bis?.days === 5, `days=${a5bis?.days}`)
  const a10 = await rule(annonce.id, '2026-06-14', empG.id)
  rec('COR-ANNONCE-10J', 'Annonce 14/06/2026 : 10 jours ouvrables', a10?.days === 10, `days=${a10?.days}`)

  // ── Article 5.7 Syntec complet ────────────────────────────────────────────
  const me = await rule(mariageEnfant.id, '2026-10-01', empG.id)
  rec('COR-MARIAGE-ENFANT', 'Mariage d’un enfant Syntec : 1 jour ouvré', me?.days === 1 && me?.unit === 'OUVRES', `days=${me?.days} unit=${me?.unit}`)
  const meLegal = await rule(mariageEnfant.id, '2026-10-01', (await mkEmp('E', effId)).id)
  rec('COR-MARIAGE-ENFANT-LEGAL', 'Mariage d’un enfant légal : 1 jour ouvrable', meLegal?.days === 1 && meLegal?.unit === 'OUVRABLES', `days=${meLegal?.days} unit=${meLegal?.unit}`)
  const meHist = await rule(mariageEnfant.id, '2025-06-01', empG.id)
  rec('COR-MARIAGE-ENFANT-HIST', 'Mariage d’un enfant Syntec 2023-2026 : 1 jour ouvré', meHist?.days === 1 && meHist?.unit === 'OUVRES', `days=${meHist?.days} unit=${meHist?.unit}`)
  const meLegacy = await rule(mariageEnfant.id, '2022-06-01', empG.id)
  rec('COR-MARIAGE-ENFANT-LEGACY', 'Mariage d’un enfant Syntec < 01/05/2023 : minimum légal + vérification RH', meLegacy?.days === 1 && meLegacy?.unit === 'OUVRABLES' && meLegacy?.anomalies?.length > 0, `days=${meLegacy?.days} unit=${meLegacy?.unit}`)

  // Transition Syntec 30/04/2026 vs 01/05/2026.
  const mariagePacs = await mkType('Mariage Pacs', 'MARIAGE_PACS', false)
  const tr1 = await rule(mariagePacs.id, '2026-04-30', empG.id)
  const tr2 = await rule(mariagePacs.id, '2026-05-01', empG.id)
  rec('COR-SYNTEC-TRANSITION', 'Syntec : 30/04/2026 (historique) et 01/05/2026 (2026) → 4 jours ouvrés', tr1?.days === 4 && tr1?.unit === 'OUVRES' && tr2?.days === 4 && tr2?.unit === 'OUVRES' && tr1?.reference !== tr2?.reference, `ref1=${tr1?.reference} ref2=${tr2?.reference}`)

  const badNature = await apiRequest(`/leave-types/${annonce.id}/family-event-rule?date=2022-06-01&employeeId=${empG.id}&natureAnnonce=INVALID`, { token: rhToken })
  rec('COR-NATURE-INVALIDE', 'natureAnnonce invalide refusée (400)', badNature.status === 400, `http=${badNature.status}`)

  // ── Corrections A/B/C : versionnement décès d’un enfant, fenêtre naissance, nature absente ──
  const empEff = await mkEmp('E2', effId)
  const decesEnfant = await mkType('Décès enfant', 'DECES_ENFANT', false)
  const naissance = await mkType('Naissance', 'NAISSANCE', false)
  const adoption = await mkType('Adoption', 'ADOPTION', false)

  const de22 = await rule(decesEnfant.id, '2022-06-15', empEff.id, '&enfantAge=30')
  rec('COR-DECES-ENFANT-LEGAL-2022-BASE', 'Décès enfant ≥ 25 ans 2022 légal : 5 j ouvrables', de22?.days === 5 && de22?.unit === 'OUVRABLES' && de22?.daysCertain === true, `days=${de22?.days} unit=${de22?.unit}`)
  const de22j = await rule(decesEnfant.id, '2022-06-15', empEff.id, '&enfantAge=10')
  rec('COR-DECES-ENFANT-LEGAL-2022-JEUNE', 'Décès enfant < 25 ans 2022 légal : 7 j ouvrés', de22j?.days === 7 && de22j?.unit === 'OUVRES', `days=${de22j?.days} unit=${de22j?.unit}`)
  const de19 = await rule(decesEnfant.id, '2019-06-15', empEff.id, '&enfantAge=30')
  rec('COR-DECES-ENFANT-LEGAL-2019', 'Décès enfant 2019 légal : 5 j ouvrables (2016-2020)', de19?.days === 5 && de19?.unit === 'OUVRABLES', `days=${de19?.days} unit=${de19?.unit}`)
  const de15 = await rule(decesEnfant.id, '2016-08-09', empEff.id, '&enfantAge=30')
  rec('COR-DECES-ENFANT-LEGAL-ANTE2016', 'Décès enfant avant le 10/08/2016 légal : 3 j ouvrables', de15?.days === 3 && de15?.unit === 'OUVRABLES', `days=${de15?.days} unit=${de15?.unit}`)
  const deSyn23 = await rule(decesEnfant.id, '2023-06-15', empG.id, '&enfantAge=10')
  rec('COR-DECES-ENFANT-SYNTEC-2023', 'Décès enfant < 25 ans juin 2023 Syntec : 7 j ouvrés (certain)', deSyn23?.days === 7 && deSyn23?.unit === 'OUVRES' && deSyn23?.daysCertain === true, `days=${deSyn23?.days} unit=${deSyn23?.unit}`)
  const deSyn23b = await rule(decesEnfant.id, '2023-08-15', empG.id, '&enfantAge=30')
  rec('COR-DECES-ENFANT-SYNTEC-AOUT-2023', 'Décès enfant ≥ 25 ans août 2023 Syntec : 12 j ouvrables (minimum légal)', deSyn23b?.days === 12 && deSyn23b?.unit === 'OUVRABLES', `days=${deSyn23b?.days} unit=${deSyn23b?.unit}`)
  const nHist = await rule(naissance.id, '2025-06-01', empG.id)
  rec('COR-NAISSANCE-SYNTEC-HIST', 'Naissance Syntec 2023-2026 : 3 j ouvrés, quinze jours ENTOURANT (enveloppe 14/14)', nHist?.days === 3 && nHist?.unit === 'OUVRES' && nHist?.temporalWindow?.beforeDays === 14 && nHist?.temporalWindow?.afterDays === 14 && /entourant/i.test(nHist?.fractionnement ?? ''), `days=${nHist?.days} win=${JSON.stringify(nHist?.temporalWindow)}`)
  const aHist = await rule(adoption.id, '2024-06-01', empG.id)
  rec('COR-ADOPTION-SYNTEC-HIST', 'Adoption Syntec 2023-2026 : 3 j ouvrés + fenêtre 15 j SUIVANT', aHist?.days === 3 && aHist?.temporalWindow?.beforeDays === 0 && aHist?.temporalWindow?.afterDays === 14, `win=${JSON.stringify(aHist?.temporalWindow)}`)
  const n2026 = await rule(naissance.id, '2026-10-01', empG.id)
  rec('COR-NAISSANCE-SYNTEC-2026', 'Naissance Syntec 2026 : 3 j ouvrés consécutifs + début naissance/1er ouvré suivant', n2026?.consecutive === true && n2026?.startMode === 'BIRTH_OR_NEXT_WORKING', `consecutive=${n2026?.consecutive} start=${n2026?.startMode}`)
  const a2026 = await rule(adoption.id, '2026-10-01', empG.id)
  rec('COR-ADOPTION-SYNTEC-2026', 'Adoption Syntec 2026 : 3 j ouvrés consécutifs + début 7 j avant/arrivée/1er ouvré suivant', a2026?.consecutive === true && a2026?.startMode === 'ADOPTION_2026', `consecutive=${a2026?.consecutive} start=${a2026?.startMode}`)
  const aNoNature = await rule(annonce.id, '2017-06-01', empEff.id)
  rec('COR-ANNONCE-NO-NATURE', 'Annonce sans nature : information à vérifier (daysCertain=false)', aNoNature?.daysCertain === false && aNoNature?.anomalies?.length > 0, `certain=${aNoNature?.daysCertain}`)
  const liens = {
    CONJOINT: 3, PARENT: 3, FRERE_SOEUR: 3, BEAU_PARENT: 3, AUTRE_ASCENDANT: 2,
  }
  for (const [lien, expected] of Object.entries(liens)) {
    const r = await rule(deces.id, '2026-10-01', empG.id, `&lien=${lien}`)
    rec(`COR-DECES-${lien}`, `Décès ${lien} Syntec : ${expected} j ouvrés`, r?.days === expected && r?.unit === 'OUVRES', `days=${r?.days} unit=${r?.unit}`)
  }
  const dAutre = await rule(deces.id, '2026-10-01', empG.id, '&lien=AUTRE')
  rec('COR-DECES-AUTRE', 'Décès AUTRE Syntec : 0 j + vérification RH (incertain)', dAutre?.days === 0 && dAutre?.anomalies?.length > 0, `days=${dAutre?.days}`)

  // ── Congé de deuil : même décès, deux périodes max, décès distincts ───────
  const colA = await mkCol('A', gmesId)
  const deuil = await mkType('Deuil', 'DEUIL_ENFANT')
  const create = (typeId, token, body) => apiRequest('/absence-declarations', { method: 'POST', token, body: { leaveTypeId: typeId, ...body } })
  const submit = (id, token) => apiRequest(`/absence-declarations/${id}/submit`, { method: 'POST', token, body: { certifiedAccurate: true } })

  const du1 = await create(deuil.id, colA.token, { startDate: '2026-12-07', endDate: '2026-12-10', familyEventContext: { eventDate: '2026-10-01' } })
  await submit(du1.data.id, colA.token)
  const du2 = await create(deuil.id, colA.token, { startDate: '2026-12-11', endDate: '2026-12-15', familyEventContext: { eventDate: '2026-10-01' } })
  await submit(du2.data.id, colA.token)
  const du3 = await create(deuil.id, colA.token, { startDate: '2026-12-16', endDate: '2026-12-16', familyEventContext: { eventDate: '2026-10-01' } })
  rec('COR-DEUIL-3EME-PERIODE', 'Deuil : 3e période refusée (deux périodes max)', du3.status === 400 && /deux périodes/i.test(du3.data?.message ?? ''), `http=${du3.status} msg=${du3.data?.message}`)

  const duB = await create(deuil.id, colA.token, { startDate: '2026-12-17', endDate: '2026-12-18', familyEventContext: { eventDate: '2026-11-01' } })
  rec('COR-DEUIL-DECES-DISTINCT', 'Deuil pour un autre décès : quota distinct autorisé', duB.status === 201, `http=${duB.status}`)

  const preview = (typeId, startDate, endDate, ctx, employeeId) => apiRequest('/absence-declarations/family-event/preview', { method: 'POST', token: rhToken, body: { leaveTypeId: typeId, startDate, endDate, employeeId, familyEventContext: ctx } })
  const pvOk = await preview(deuil.id, '2027-09-29', '2027-09-30', { eventDate: '2026-10-01' }, empG.id)
  rec('COR-DEUIL-DELAI-OK', 'Deuil dans le délai d’un an (jusqu’au 30/09/2027)', pvOk.status === 200, `http=${pvOk.status}`)
  const pvOut = await preview(deuil.id, '2027-10-01', '2027-10-02', { eventDate: '2026-10-01' }, empG.id)
  rec('COR-DEUIL-DELAI-REFUS', 'Deuil au-delà du délai d’un an refusé', pvOut.status === 400 && /délai d’un an/i.test(pvOut.data?.message ?? ''), `http=${pvOut.status}`)

  // ── Enfant malade : cumul annuel, changement d'année, concurrence ─────────
  const enfantMalade = await mkType('Enfant malade', 'ENFANT_MALADE')
  const em1 = await create(enfantMalade.id, colA.token, { startDate: '2026-12-21', endDate: '2026-12-23', familyEventContext: { eventDate: '2026-12-21', enfantAge: 5, nbEnfantsCharge: 1 } })
  await submit(em1.data.id, colA.token)
  const emOver = await create(enfantMalade.id, colA.token, { startDate: '2026-12-24', endDate: '2026-12-24', familyEventContext: { eventDate: '2026-12-24', enfantAge: 5, nbEnfantsCharge: 1 } })
  rec('COR-EM-QUOTA-2026', 'Enfant malade 2026 : dépassement du quota refusé', emOver.status === 400 && /quota/i.test(emOver.data?.message ?? ''), `http=${emOver.status}`)
  const em2027 = await create(enfantMalade.id, colA.token, { startDate: '2027-01-04', endDate: '2027-01-05', familyEventContext: { eventDate: '2027-01-04', enfantAge: 5, nbEnfantsCharge: 1 } })
  rec('COR-EM-ANNEE-SUIVANTE', 'Enfant malade 2027 : nouvelle année, quota recalculé', em2027.status === 201, `http=${em2027.status}`)

  // Concurrence : deux soumissions simultanées ne dépassent pas le quota.
  const colC = await mkCol('C', gmesId)
  const c1 = await create(enfantMalade.id, colC.token, { startDate: '2027-01-06', endDate: '2027-01-07', familyEventContext: { eventDate: '2027-01-06', enfantAge: 5, nbEnfantsCharge: 1 } })
  const c2 = await create(enfantMalade.id, colC.token, { startDate: '2027-01-08', endDate: '2027-01-09', familyEventContext: { eventDate: '2027-01-08', enfantAge: 5, nbEnfantsCharge: 1 } })
  const [r1, r2] = await Promise.all([submit(c1.data.id, colC.token), submit(c2.data.id, colC.token)])
  const statuses = [r1.status, r2.status]
  rec('COR-EM-CONCURRENCE', 'Enfant malade : deux soumissions simultanées, une seule acceptée', statuses.includes(200) && statuses.includes(400), `statuses=${statuses.join(',')}`)

  // ── Demande incertaine : RH informée, décision motivée ───────────────────
  const colLegal = await mkCol('L', effId)
  const decesLegal = await mkType('Décès proche légal', 'DECES', true, false)
  const inc = await create(decesLegal.id, colLegal.token, { startDate: '2026-12-21', endDate: '2026-12-21', familyEventContext: { eventDate: '2026-12-20', lien: 'AUTRE' } })
  const incSub = await submit(inc.data.id, colLegal.token)
  rec('COR-INCERTAIN-RH', 'Demande incertaine soumise → A_VERIFIER_PAR_RH', incSub.status === 200 && incSub.data?.status === 'A_VERIFIER_PAR_RH', `status=${incSub.data?.status}`)
  const regNo = await apiRequest(`/absence-declarations/${inc.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  rec('COR-INCERTAIN-JUSTIF', 'Enregistrement sans motif/source refusé', regNo.status === 400 && /Motif ET source/i.test(regNo.data?.message ?? ''), `http=${regNo.status}`)
  const regYes = await apiRequest(`/absence-declarations/${inc.data.id}/register`, { method: 'POST', token: rhToken, body: { decisionReason: 'Accord d’entreprise étendu applicable, vérifié par la RH.', decisionSource: 'Accord d’entreprise — article 3' } })
  rec('COR-INCERTAIN-DECISION', 'Enregistrement avec motif+source accepté et tracé', regYes.status === 200 && regYes.data?.status === 'ENREGISTREE' && /Accord d’entreprise/.test(regYes.data?.familyEventRule ?? ''), `status=${regYes.data?.status}`)

  // ── Permissions non affaiblies ────────────────────────────────────────────
  const regByCol = await apiRequest(`/absence-declarations/${inc.data.id}/register`, { method: 'POST', token: colLegal.token, body: {} })
  rec('COR-PERM-REGISTER', 'Collaborateur ne peut pas enregistrer (RH only)', regByCol.status === 403, `http=${regByCol.status}`)
  const cancelByCol = await apiRequest(`/absence-declarations/${em1.data.id}/cancel`, { method: 'POST', token: colA.token })
  rec('COR-PERM-CANCEL', 'Collaborateur ne peut pas annuler (RH only)', cancelByCol.status === 403, `http=${cancelByCol.status}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT CORRECTIONS JUR-029/030 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR CORRECTIONS JUR-029/030 :', e); process.exit(1) })
