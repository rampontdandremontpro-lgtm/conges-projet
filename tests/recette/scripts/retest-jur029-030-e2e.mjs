// JUR-029 / JUR-030 — circuit complet de bout en bout (collaborateur → RH),
// valeurs juridiques vérifiées, quotas, permissions, jours fériés, annulation,
// modification et changement d'entité.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const unit = (r) => (r?.unit === 'OUVRES' ? 'OUVRES' : 'OUVRABLES')

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'J2930' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const effId = ents.find((e) => e.code === 'EFFICIENCE')?.id
  if (!gmesId || !effId) {
    console.error('Entités GMES/EFFICIENCE introuvables')
    process.exit(2)
  }
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const svcId = svc.data.id

  const mkEmp = async (suffix, entId, role = 'COLLABORATEUR') => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `E2E-${suffix}`, prenom: 'Recette', email: `e2e-${suffix}.${TAG}@recette.fr`, role, employmentType: 'INTERNE', serviceId: svcId, hireDate: '2015-05-01', legalEntityId: entId } })).data

  const mkEventType = async (name, kind, { employeeCanCreate = true, rhOnly = false, documentRequired = true } = {}) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired, documentCanBeAddedLater: true, employeeCanCreate, rhOnly, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }

  const mariage = await mkEventType('Mariage', 'MARIAGE_PACS')
  const naissance = await mkEventType('Naissance', 'NAISSANCE')
  const adoption = await mkEventType('Adoption', 'ADOPTION')
  const naissanceFluxT = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Naissance flux-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
  await apiRequest(`/leave-types/${naissanceFluxT.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'NAISSANCE' } })
  const naissanceFlux = naissanceFluxT.data
  const decesEnfant = await mkEventType('Décès enfant', 'DECES_ENFANT')
  const deuil = await mkEventType('Deuil enfant', 'DEUIL_ENFANT')
  const annonce = await mkEventType('Annonce handicap', 'ANNONCE_HANDICAP_ENFANT')
  const enfantMalade = await mkEventType('Enfant malade', 'ENFANT_MALADE')
  const decesProche = await mkEventType('Décès proche', 'DECES')

  const empG = await mkEmp('G', gmesId)
  const empE = await mkEmp('E', effId)

  // Collaborateur dédié à ce run (mot de passe temporaire défini via API)
  // afin que le circuit collaborateur soit réel et reproductible.
  const col = await mkEmp('COL', gmesId)
  await apiRequest(`/users/${col.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'E2eTemp2026!Pass' } })
  const colToken = await login(`e2e-col.${TAG}@recette.fr`, 'E2eTemp2026!Pass')

  const preview = (typeId, startDate, endDate, ctx = {}, employeeId) =>
    apiRequest('/absence-declarations/family-event/preview', { method: 'POST', token: rhToken, body: { leaveTypeId: typeId, startDate, endDate, employeeId, familyEventContext: ctx } })

  const rule = (typeId, date, employeeId, qs = '') => apiRequest(`/leave-types/${typeId}/family-event-rule?date=${date}&employeeId=${employeeId}${qs}`, { token: rhToken }).then((r) => r.data)

  // ── 1. Durées et unités réelles (Syntec vs légal) ────────────────────────
  const mG = await rule(mariage.id, '2026-10-01', empG.id)
  rec('E2E-MARIAGE-SYNTEC', 'Mariage Syntec : 4 jours OUVRÉS', mG?.days === 4 && mG?.unit === 'OUVRES', `days=${mG?.days} unit=${mG?.unit}`)
  const mE = await rule(mariage.id, '2026-10-01', empE.id)
  rec('E2E-MARIAGE-LEGAL', 'Mariage légal : 4 jours OUVRABLES', mE?.days === 4 && mE?.unit === 'OUVRABLES', `days=${mE?.days}`)

  const dJeune = await rule(decesEnfant.id, '2026-10-01', empG.id, '&enfantAge=10')
  rec('E2E-DECES-ENFANT-SYNTEC', 'Décès enfant < 25 ans Syntec : 14 jours OUVRÉS', dJeune?.days === 14 && dJeune?.unit === 'OUVRES', `days=${dJeune?.days} unit=${dJeune?.unit}`)
  const dParent = await rule(decesEnfant.id, '2026-10-01', empG.id, '&enfantAge=30&enfantEstParent=true')
  rec('E2E-DECES-ENFANT-PARENT', 'Enfant ≥ 25 ans lui-même parent : 14 jours', dParent?.days === 14, `days=${dParent?.days}`)
  const dCharge = await rule(decesEnfant.id, '2026-10-01', empG.id, '&personneChargeMoins25=true')
  rec('E2E-DECES-PERSONNE-CHARGE', 'Personne < 25 ans à charge permanente : 14 jours', dCharge?.days === 14, `days=${dCharge?.days}`)

  const aAvant = await rule(annonce.id, '2026-06-13', empG.id)
  rec('E2E-ANNONCE-AVANT', 'Annonce handicap < 14/06/2026 : 5 jours ouvrables', aAvant?.days === 5 && aAvant?.unit === 'OUVRABLES', `days=${aAvant?.days}`)
  const aApres = await rule(annonce.id, '2026-06-14', empG.id)
  rec('E2E-ANNONCE-APRES', 'Annonce handicap ≥ 14/06/2026 : 10 jours ouvrables', aApres?.days === 10 && aApres?.unit === 'OUVRABLES', `days=${aApres?.days}`)
  const aHist = await rule(annonce.id, '2023-07-20', empG.id)
  rec('E2E-ANNONCE-HISTORIQUE', 'Annonce handicap 20/07/2023 : 2 jours ouvrables (version 2021)', aHist?.days === 2 && aHist?.unit === 'OUVRABLES', `days=${aHist?.days}`)

  const em = await rule(enfantMalade.id, '2026-10-01', empG.id, '&enfantAge=5')
  rec('E2E-ENFANT-MALADE', 'Enfant malade ≥ 1 an : 3 jours ouvrables, non rémunéré', em?.days === 3 && em?.paid === false, `days=${em?.days} paid=${em?.paid}`)

  // ── 2. Aperçu : jours réellement demandés selon l'unité ──────────────────
  const pv = await preview(mariage.id, '2026-10-05', '2026-10-08', { eventDate: '2026-10-01' }, empG.id)
  rec('E2E-PREVIEW-OUVRES', 'Aperçu mariage Syntec : 4 jours ouvrés demandés', pv.status === 200 && pv.data?.requestedDays === 4 && pv.data?.rule?.unit === 'OUVRES', `req=${pv.data?.requestedDays}`)

  const pvLegal = await preview(mariage.id, '2026-10-05', '2026-10-10', { eventDate: '2026-10-01' }, empE.id)
  rec('E2E-PREVIEW-OUVRABLES', 'Aperçu mariage légal : 6 jours ouvrables (lundi→samedi)', pvLegal.status === 200 && pvLegal.data?.requestedDays === 6 && pvLegal.data?.rule?.unit === 'OUVRABLES', `req=${pvLegal.data?.requestedDays}`)

  // ── 3. Jours fériés : jour non déductible exclu du décompte ──────────────
  const holiday = await apiRequest('/holidays', { method: 'POST', token: rhToken, body: { date: '2026-10-06', name: `Fermeture test ${TAG}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'recette' } })
  const pvHoliday = await preview(mariage.id, '2026-10-05', '2026-10-08', { eventDate: '2026-10-01' }, empG.id)
  rec('E2E-JOUR-FERIE', 'Jour férié non déductible exclu (4 → 3 jours ouvrés)', pvHoliday.status === 200 && pvHoliday.data?.requestedDays === 3, `req=${pvHoliday.data?.requestedDays}`)
  await apiRequest(`/holidays/${holiday.data.id}`, { method: 'PATCH', token: rhToken, body: { isActive: false } })

  // ── 4. Circuit collaborateur : mariage dans la limite, non débité des CP ─
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empG.id, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 25, reason: 'Fixture JUR-029 E2E' } })
  const d = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: mariage.id, startDate: '2026-10-05', endDate: '2026-10-08', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-COLLAB-CREATE', 'Collaborateur crée son brouillon (mariage 4 j ouvrés)', d.status === 201, `http=${d.status}`)
  const sub = await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  rec('E2E-COLLAB-SUBMIT', 'Collaborateur soumet sa déclaration', sub.status === 200 && ['A_VERIFIER_PAR_RH', 'JUSTIFICATIF_EN_ATTENTE'].includes(sub.data?.status), `http=${sub.status} status=${sub.data?.status}`)

  const [[bal]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N'", [empG.id])
  rec('E2E-NON-DEBIT-CP', 'Événement familial non débité des congés payés (25 → 25)', Number(bal?.available_days ?? 0) === 25, `avail=${bal?.available_days}`)

  // Justificatif requis avant enregistrement RH.
  const regNoDoc = await apiRequest(`/absence-declarations/${d.data.id}/register`, { method: 'POST', token: rhToken })
  rec('E2E-REGISTER-SANS-JUSTIF', 'Enregistrement RH refusé sans justificatif accepté', regNoDoc.status === 400, `http=${regNoDoc.status}`)

  // ── 5. Dépassement prouvé refusé à la création (backend, non contournable) ─
  const over = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: mariage.id, startDate: '2026-10-05', endDate: '2026-10-09', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-DEPASSEMENT', 'Dépassement mariage (5 j > 4 j ouvrés) refusé (400)', over.status === 400 && /Dépassement/.test(over.data?.message ?? ''), `http=${over.status}`)

  // ── 6. Identifiants salariés et permissions ───────────────────────────────
  const other = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { employeeId: empE.id, leaveTypeId: mariage.id, startDate: '2026-10-05', endDate: '2026-10-08' } })
  rec('E2E-PERM-EMPLOYEE-ID', 'Collaborateur ne peut pas déclarer pour un autre salarié', other.status === 403, `http=${other.status}`)

  const foreign = await apiRequest(`/absence-declarations/${d.data.id}`, { token: await login('col-b.recette@gmes.fr') })
  rec('E2E-PERM-CONSULT', 'Collaborateur ne consulte pas une déclaration étrangère', foreign.status === 403, `http=${foreign.status}`)

  const badFormat = await preview(mariage.id, 'abc', '2026-10-08', {}, empG.id)
  rec('E2E-DATE-FORMAT', 'Date invalide (format) refusée (400)', badFormat.status === 400, `http=${badFormat.status}`)
  const badOrder = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: mariage.id, startDate: '2026-10-08', endDate: '2026-10-05' } })
  rec('E2E-DATE-ORDRE', 'Date de fin antérieure à la date de début refusée (400)', badOrder.status === 400, `http=${badOrder.status}`)

  // ── 7. Naissance et adoption (Syntec 3 jours ouvrés) ──────────────────────
  const n = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: naissance.id, startDate: '2026-11-02', endDate: '2026-11-04', familyEventContext: { eventDate: '2026-11-02' } } })
  rec('E2E-NAISSANCE', 'Naissance 3 jours ouvrés acceptée', n.status === 201, `http=${n.status}`)
  const ad = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: adoption.id, startDate: '2026-10-19', endDate: '2026-10-21', familyEventContext: { eventDate: '2026-10-19' } } })
  rec('E2E-ADOPTION', 'Adoption 3 jours ouvrés consécutifs acceptée', ad.status === 201, `http=${ad.status}`)

  // ── 7b. Naissance Syntec 2023-2026 : jours non consécutifs + cumul 3 j ──
  const n1 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: naissanceFlux.id, startDate: '2025-06-02', endDate: '2025-06-03', familyEventContext: { eventDate: '2025-06-01' } } })
  rec('E2E-NAISSANCE-NONCONS-1', 'Naissance 2025 : 2 jours ouvrés acceptés', n1.status === 201, `http=${n1.status}`)
  const n2 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: naissanceFlux.id, startDate: '2025-06-05', endDate: '2025-06-05', familyEventContext: { eventDate: '2025-06-01' } } })
  rec('E2E-NAISSANCE-NONCONS-2', 'Naissance 2025 : jour non consécutif accepté', n2.status === 201, `http=${n2.status}`)
  await apiRequest(`/absence-declarations/${n1.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  await apiRequest(`/absence-declarations/${n1.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  await apiRequest(`/absence-declarations/${n2.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  await apiRequest(`/absence-declarations/${n2.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  const n3 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: naissanceFlux.id, startDate: '2025-06-06', endDate: '2025-06-06', familyEventContext: { eventDate: '2025-06-01' } } })
  rec('E2E-NAISSANCE-CUMUL', 'Naissance 2025 : 4e jour refusé (cumul 3 j/événement)', n3.status === 400 && /Dépassement|quota/i.test(n3.data?.message ?? ''), `http=${n3.status} msg=${n3.data?.message}`)
  const adOut = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: adoption.id, startDate: '2025-05-25', endDate: '2025-05-27', familyEventContext: { eventDate: '2025-06-01' } } })
  rec('E2E-ADOPTION-AVANT-ARRIVEE', 'Adoption 2025 avant l’arrivée refusée (fenêtre SUIVANT)', adOut.status === 400 && /période doit être comprise/i.test(adOut.data?.message ?? ''), `http=${adOut.status} msg=${adOut.data?.message}`)

  // ── 8. Décès d'un enfant : droit 14 jours, dépassement à 15 refusé ───────
  const de = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: decesEnfant.id, startDate: '2026-11-16', endDate: '2026-12-03', familyEventContext: { eventDate: '2026-11-15', enfantAge: 10 } } })
  rec('E2E-DECES-ENFANT-14', 'Décès enfant : 14 jours ouvrés acceptés', de.status === 201, `http=${de.status}`)
  const deOver = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: decesEnfant.id, startDate: '2026-11-16', endDate: '2026-12-04', familyEventContext: { eventDate: '2026-11-15', enfantAge: 10 } } })
  rec('E2E-DECES-ENFANT-OVER', 'Décès enfant : 15 jours ouvrés refusés (400)', deOver.status === 400, `http=${deOver.status}`)

  // ── 9. Congé de deuil : 8 jours ouvrables, fractionné, délai d'un an ─────
  const du1 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: deuil.id, startDate: '2026-12-07', endDate: '2026-12-10', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-DEUIL-FRACTION-1', 'Deuil fraction 1 : 4 jours ouvrables acceptés', du1.status === 201, `http=${du1.status}`)
  await apiRequest(`/absence-declarations/${du1.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  const du2 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: deuil.id, startDate: '2026-12-11', endDate: '2026-12-15', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-DEUIL-FRACTION-2', 'Deuil fraction 2 : 4 jours ouvrables acceptés (total 8)', du2.status === 201, `http=${du2.status}`)
  await apiRequest(`/absence-declarations/${du2.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  const duOver = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: deuil.id, startDate: '2026-12-16', endDate: '2026-12-16', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-DEUIL-OVER', 'Deuil au-delà de 8 jours refusé (quota/périodes)', duOver.status === 400 && /deux périodes|quota|Dépassement/i.test(duOver.data?.message ?? ''), `http=${duOver.status} msg=${duOver.data?.message}`)
  const duDelai = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: deuil.id, startDate: '2027-10-01', endDate: '2027-10-02', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('E2E-DEUIL-DELAI', 'Deuil hors délai d’un an refusé', duDelai.status === 400, `http=${duDelai.status}`)

  // ── 10. Enfant malade : quota annuel 3 jours, non rémunéré ────────────────
  const em1 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: enfantMalade.id, startDate: '2026-12-17', endDate: '2026-12-18', familyEventContext: { eventDate: '2026-12-17', enfantAge: 5, nbEnfantsCharge: 1 } } })
  rec('E2E-EM-1', 'Enfant malade : 2 jours ouvrables acceptés', em1.status === 201, `http=${em1.status}`)
  await apiRequest(`/absence-declarations/${em1.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  const em2 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: enfantMalade.id, startDate: '2026-12-19', endDate: '2026-12-19', familyEventContext: { eventDate: '2026-12-19', enfantAge: 5, nbEnfantsCharge: 1 } } })
  rec('E2E-EM-2', 'Enfant malade : 3e jour accepté (quota annuel atteint)', em2.status === 201, `http=${em2.status}`)
  await apiRequest(`/absence-declarations/${em2.data.id}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
  const em3 = await apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: { leaveTypeId: enfantMalade.id, startDate: '2026-12-21', endDate: '2026-12-21', familyEventContext: { eventDate: '2026-12-21', enfantAge: 5, nbEnfantsCharge: 1 } } })
  rec('E2E-EM-OVER', 'Enfant malade au-delà de 3 jours/an refusé (quota)', em3.status === 400 && /quota|Dépassement/i.test(em3.data?.message ?? ''), `http=${em3.status} msg=${em3.data?.message}`)

  // ── 11. Changement d'entité : la règle suit l'entité juridique ────────────
  const before = await rule(mariage.id, '2026-10-01', empG.id)
  await apiRequest(`/users/${empG.id}`, { method: 'PATCH', token: adminToken, body: { legalEntityId: effId } })
  const after = await rule(mariage.id, '2026-10-01', empG.id)
  rec('E2E-CHANGEMENT-ENTITE', 'Changement d’entité : Syntec (4 ouvrés) → légal (4 ouvrables)', before?.unit === 'OUVRES' && after?.unit === 'OUVRABLES' && after?.days === 4, `before=${before?.unit} after=${after?.unit}`)

  // ── 12. Modification RH et annulation cohérentes ──────────────────────────
  const mod = await apiRequest(`/absence-declarations/${de.data.id}`, { method: 'PATCH', token: rhToken, body: { startDate: '2026-11-16', endDate: '2026-12-02' } })
  rec('E2E-MODIFICATION', 'Modification RH d’une déclaration transmise', mod.status === 200, `http=${mod.status}`)
  const cancel = await apiRequest(`/absence-declarations/${n.data.id}/cancel`, { method: 'POST', token: rhToken })
  rec('E2E-ANNULATION', 'Annulation RH → statut ANNULEE', cancel.status === 200 && cancel.data?.status === 'ANNULEE', `status=${cancel.data?.status}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-029/030 E2E : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-029/030 E2E :', e); process.exit(1) })
