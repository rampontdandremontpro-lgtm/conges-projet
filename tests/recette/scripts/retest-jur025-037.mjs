// JUR-025 / JUR-037 — acquisition des congés payés selon la nature des
// absences + maintien de salaire individuel + historique + idempotence/legacy.
import { apiRequest, login, dbConn, config } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'ACQ' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code, convention_type, idcc, convention_name, accord_type, accord_name, accord_idcc, accord_valid_from, accord_valid_to FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const effId = ents.find((e) => e.code === 'EFFICIENCE')?.id
  const gmesInit = ents.find((e) => e.code === 'GMES')
  const effInit = ents.find((e) => e.code === 'EFFICIENCE')

  // Restauration SÛRE des entités partagées (état initial capturé AVANT test),
  // y compris en cas d'échec (appelée dans un finally).
  const restoreSharedEntities = async () => {
    for (const [id, init] of [[gmesId, gmesInit], [effId, effInit]]) {
      if (!id || !init) continue
      await apiRequest(`/legal-entities/${id}/convention`, { method: 'PATCH', token: rhToken, body: {
        conventionType: init.convention_type ?? 'NON_RENSEIGNEE',
        idcc: init.idcc ?? undefined,
        conventionName: init.convention_name ?? undefined,
        accordType: init.accord_type ?? 'NONE',
        accordName: init.accord_name ?? undefined,
        accordIdcc: init.accord_idcc ?? undefined,
        accordValidFrom: init.accord_valid_from ?? undefined,
        accordValidTo: init.accord_valid_to ?? undefined,
      } })
    }
  }

  // Préparation INDÉPENDANTE de l'état antérieur : GMES = Syntec (IDCC 1486),
  // EFFICIENCE = régime légal. Rend les scénarios reproductibles. L'état initial
  // est restauré en fin de test (voir finally).
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec recette' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  try {

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })

  // RH « globale » (périmètre toutes entités) pour les justificatifs d'accord
  // rattachés à des ENTITÉS dédiées de test (la RH de recette est scopée GMES).
  const globalRh = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `RH-GLOBAL-${TAG}`, prenom: 'Recette', email: `rh-global.${TAG}@recette.fr`, role: 'RH', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01' } })).data
  // Périmètre global (toutes entités) pour ce scénario dédié.
  await conn.query('UPDATE users SET legal_entity_id=NULL WHERE id=?', [globalRh.id])
  await apiRequest(`/users/${globalRh.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'RhGlobal2026!Pass' } })
  const globalRhToken = await login(`rh-global.${TAG}@recette.fr`, 'RhGlobal2026!Pass')

  const mkEmp = async (suffix, { legalEntityId = gmesId, hireDate = '2020-01-01', exitDate } = {}) =>
    (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `ACQ-${suffix}`, prenom: 'Recette', email: `acq-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate, exitDate, legalEntityId } })).data

  const empLogin = async (suffix, opts) => {
    const u = await mkEmp(suffix, opts)
    await apiRequest(`/users/${u.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'AcqTemp2026!Pass' } })
    return { ...u, token: await login(`acq-${suffix}.${TAG}@recette.fr`, 'AcqTemp2026!Pass') }
  }

  const mkType = async (name, kind) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }
  const arretMaladie = await mkType('Arrêt maladie', 'ARRET_MALADIE')
  const atMp = await mkType('AT/MP', 'AT_MP')
  const nonMedical = await mkType('Indispo non médicale', 'NON_MEDICAL')

  const createAbsence = async (employeeId, typeId, start, end) => (await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId, leaveTypeId: typeId, startDate: start, endDate: end } })).data
  const registerAbsence = async (employeeId, typeId, start, end) => {
    const d = await createAbsence(employeeId, typeId, start, end)
    await apiRequest(`/absence-declarations/${d.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    await apiRequest(`/absence-declarations/${d.id}/register`, { method: 'POST', token: rhToken, body: {} })
    return d
  }
  const runAccrual = (month) => apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: month } })
  const creditedFor = async (empId, month) => {
    const [rows] = await conn.query(
      "SELECT SUM(days) AS d FROM balance_movements WHERE employee_id=? AND accrual_month=? AND movement_type='ACQUISITION'",
      [empId, month],
    )
    return Number(rows?.[0]?.d ?? 0)
  }
  const netFor = async (empId, month) => {
    const [rows] = await conn.query(
      `SELECT SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END) AS d
         FROM balance_movements WHERE employee_id=? AND accrual_month=? AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')`,
      [empId, month],
    )
    return Number(rows?.[0]?.d ?? 0)
  }
  const illnessForPeriod = async (empId, period) => {
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(m.illness_days),0) AS d FROM balance_movements m
         INNER JOIN leave_balances b ON b.id = m.leave_balance_id
        WHERE m.employee_id=? AND m.movement_type='ACQUISITION' AND b.reference_period=?`,
      [empId, period],
    )
    return Number(rows?.[0]?.d ?? 0)
  }
  const movementCount = async (empId, month) => {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS c FROM balance_movements WHERE employee_id=? AND accrual_month=?",
      [empId, month],
    )
    return Number(rows?.[0]?.c ?? 0)
  }
  const createMaintenance = (employeeId, startDate, endDate, justification = 'Maintien de salaire Syntec 5.5 confirmé par la paie.', basis, basisReference, extra = {}) =>
    apiRequest('/illness-maintenance', { method: 'POST', token: rhToken, body: { employeeId, startDate, endDate, justification, ...(basis ? { basis } : {}), ...(basisReference ? { basisReference } : {}), ...extra } })
  // Téléverse un VRAI justificatif de fondement (EN ATTENTE) puis le fait
  // VALIDER par la RH (justification) : renvoie l'id du document ACCEPTE.
  const uploadBasis = async (path, fieldName, targetId, token = rhToken) => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
    const form = new FormData()
    form.append(fieldName, String(targetId))
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'fondement-basis.pdf')
    const res = await fetch(`${config.API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const data = await res.json().catch(() => null)
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`upload basis failed: ${res.status} ${JSON.stringify(data)}`)
    }
    return data
  }
  const validateBasis = async (documentId, token = rhToken) => {
    const res = await apiRequest(`/documents/basis/${documentId}/validate`, { method: 'POST', token, body: { justification: 'Fondement vérifié par la RH (contenu conforme à la disposition revendiquée).' } })
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`validate basis failed: ${res.status} ${JSON.stringify(res.data)}`)
    }
    return res.data
  }
  const createVerifiedDocument = async (employeeId) => {
    const uploaded = await uploadBasis('/documents/basis', 'employeeId', employeeId)
    await validateBasis(uploaded.id)
    return uploaded.id
  }
  const createAccordDocument = async (legalEntityId) => {
    const uploaded = await uploadBasis('/documents/accord-basis', 'legalEntityId', legalEntityId, globalRhToken)
    await validateBasis(uploaded.id, globalRhToken)
    return uploaded.id
  }

  // ── 1. Mois entièrement travaillé → 2,5 j ────────────────────────────────
  const eWork = await empLogin('WORK')
  await runAccrual('2026-08')
  rec('S01-TRAVAIL', 'Mois travaillé : 2,5 j', (await creditedFor(eWork.id, '2026-08')) === 2.5, `days=${await creditedFor(eWork.id, '2026-08')}`)

  // ── 2. Mois entièrement maladie non professionnelle (légal) → 2 j ────────
  const eMal = await empLogin('MAL')
  await registerAbsence(eMal.id, arretMaladie.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  rec('S02-MALADIE', 'Mois maladie non pro : 2 j', (await creditedFor(eMal.id, '2026-08')) === 2, `days=${await creditedFor(eMal.id, '2026-08')}`)

  // ── 3. Mois entièrement AT/MP → 2,5 j (assimilé, sans limite) ────────────
  const eAt = await empLogin('ATMP')
  await registerAbsence(eAt.id, atMp.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  rec('S03-ATMP', 'Mois AT/MP : 2,5 j (assimilé)', (await creditedFor(eAt.id, '2026-08')) === 2.5, `days=${await creditedFor(eAt.id, '2026-08')}`)

  // ── 4. Mois mixte travail + maladie + AT/MP ──────────────────────────────
  const eMix = await empLogin('MIX')
  await registerAbsence(eMix.id, atMp.id, '2026-08-01', '2026-08-10')
  await registerAbsence(eMix.id, arretMaladie.id, '2026-08-11', '2026-08-20')
  await runAccrual('2026-08')
  const mixDays = await creditedFor(eMix.id, '2026-08')
  const expectedMix = round2((2.5 * 21 + 2 * 10) / 31)
  rec('S04-MIXTE', 'Mois mixte travail + maladie + AT/MP', Math.abs(mixDays - expectedMix) < 0.01, `days=${mixDays} expected=${expectedMix}`)

  // ── 5. AT/MP supérieur à un an : pas de limite d'un an ───────────────────
  const eLong = await empLogin('LONG')
  await registerAbsence(eLong.id, atMp.id, '2025-07-01', '2026-08-31')
  await runAccrual('2026-08')
  rec('S05-ATMP-LONG', 'AT/MP > 1 an : 2,5 j au 14e mois', (await creditedFor(eLong.id, '2026-08')) === 2.5, `days=${await creditedFor(eLong.id, '2026-08')}`)

  // ── 6/7. Plafond maladie : 24 j par période puis remise à zéro ───────────
  const eCap = await empLogin('CAP')
  for (let i = 0; i < 12; i += 1) {
    const y = 2025 + Math.floor((5 + i) / 12)
    const m = ((5 + i) % 12) + 1
    const month = `${y}-${String(m).padStart(2, '0')}`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    await registerAbsence(eCap.id, arretMaladie.id, `${month}-01`, `${month}-${last}`)
    await runAccrual(month)
  }
  const capPeriod1 = await illnessForPeriod(eCap.id, '2025-2026')
  let capNetTotal = 0
  for (let i = 0; i < 12; i += 1) {
    const y = 2025 + Math.floor((5 + i) / 12)
    const m = ((5 + i) % 12) + 1
    capNetTotal += await netFor(eCap.id, `${y}-${String(m).padStart(2, '0')}`)
  }
  rec('S06-MALADIE-CAP', '12 mois maladie : 24 j (plafond période 2025-2026, net)', Math.abs(capPeriod1 - 24) < 0.01 && Math.abs(capNetTotal - 24) < 0.01, `illnessDays=${capPeriod1} net=${capNetTotal}`)

  const capMonth13 = '2026-06'
  await registerAbsence(eCap.id, arretMaladie.id, '2026-06-01', '2026-06-30')
  await runAccrual(capMonth13)
  const cap13 = await creditedFor(eCap.id, capMonth13)
  const capPeriod2 = await illnessForPeriod(eCap.id, '2026-2027')
  rec('S07-MALADIE-NOUVEAU-PERIODE', '13e mois (nouvelle période) : 2 j, plafond réinitialisé', cap13 === 2 && Math.abs(capPeriod2 - 2) < 0.01, `days=${cap13} illness2026-2027=${capPeriod2}`)

  // ── 8. P3 — Syntec : maintien INDIVIDUEL → maladie assimilée 2,5 j ──────
  const eSyntecMaintien = await empLogin('SYNMAI')
  await registerAbsence(eSyntecMaintien.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  await createMaintenance(eSyntecMaintien.id, '2026-07-01', '2026-07-31')
  await runAccrual('2026-07')
  const syntecMaintienDays = await creditedFor(eSyntecMaintien.id, '2026-07')
  rec('S08-SYNTEC-MAINTIEN', 'Syntec maintien individuel confirmé : maladie assimilée 2,5 j', syntecMaintienDays === 2.5, `days=${syntecMaintienDays}`)

  // ── 9. P3 — Syntec sans maintien : 2 j + décision RH requise ─────────────
  const eSyntecSans = await empLogin('SYNSAN')
  await registerAbsence(eSyntecSans.id, arretMaladie.id, '2026-09-01', '2026-09-30')
  const runSyntecSans = await runAccrual('2026-09')
  const syntecSansDays = await creditedFor(eSyntecSans.id, '2026-09')
  const flaggedSyntec = (runSyntecSans.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eSyntecSans.id)
  rec('S09-SYNTEC-SANS-MAINTIEN', 'Syntec sans maintien : 2 j + signal RH', syntecSansDays === 2 && flaggedSyntec, `days=${syntecSansDays} flagged=${flaggedSyntec}`)

  // ── 10. Régime légal (EFFICIENCE) → 2 j, sans signal ─────────────────────
  const eLegal = await empLogin('LEGAL', { legalEntityId: effId })
  await registerAbsence(eLegal.id, arretMaladie.id, '2026-09-01', '2026-09-30')
  const runLegal = await runAccrual('2026-09')
  const legalDays = await creditedFor(eLegal.id, '2026-09')
  const flaggedLegal = (runLegal.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eLegal.id)
  rec('S10-LEGAL', 'Régime légal : 2 j sans signal RH', legalDays === 2 && !flaggedLegal, `days=${legalDays} flagged=${flaggedLegal}`)

  // ── 11. Entrée en cours de mois → prorata présence ───────────────────────
  const eHire = await empLogin('HIRE', { hireDate: '2026-08-16' })
  await runAccrual('2026-08')
  const hireDays = await creditedFor(eHire.id, '2026-08')
  const expectedHire = round2((2.5 * 16) / 31)
  rec('S11-EMBAUCHE', 'Embauche le 16/08 : prorata présence', Math.abs(hireDays - expectedHire) < 0.01, `days=${hireDays} expected=${expectedHire}`)

  // ── 12. Enregistrement tardif après crédit → régularisation ──────────────
  const eLate = await empLogin('LATE')
  await runAccrual('2026-08')
  const beforeLate = await creditedFor(eLate.id, '2026-08')
  await registerAbsence(eLate.id, arretMaladie.id, '2026-08-01', '2026-08-31')
  const netLate = await netFor(eLate.id, '2026-08')
  rec('S12-ENREGISTREMENT-TARDIF', 'Arrêt enregistré après crédit : régularisation', beforeLate === 2.5 && Math.abs(netLate - 2) < 0.01, `avant=${beforeLate} après=${netLate}`)

  // ── 13. Requalification maladie → AT/MP → régularisation + ventilation ───
  const eReq = await empLogin('REQ')
  const reqAbs = await registerAbsence(eReq.id, arretMaladie.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  const beforeReq = await creditedFor(eReq.id, '2026-08')
  await apiRequest(`/absence-declarations/${reqAbs.id}`, { method: 'PATCH', token: rhToken, body: { leaveTypeId: atMp.id } })
  const netReq = await netFor(eReq.id, '2026-08')
  const [reqIll] = await conn.query(
    "SELECT COALESCE(illness_days,0) AS d FROM balance_movements WHERE employee_id=? AND accrual_month='2026-08' AND movement_type='ACQUISITION'",
    [eReq.id],
  )
  rec('S13-REQUALIFICATION', 'Maladie → AT/MP : 2 → 2,5 et illness_days ventilé à 0', beforeReq === 2 && Math.abs(netReq - 2.5) < 0.01 && Number(reqIll?.[0]?.d ?? 0) === 0, `avant=${beforeReq} après=${netReq} illness_days=${Number(reqIll?.[0]?.d ?? 0)}`)

  // ── 14. Annulation après crédit → régularisation ─────────────────────────
  const eAnn = await empLogin('ANN')
  const annAbs = await registerAbsence(eAnn.id, arretMaladie.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  const beforeAnn = await creditedFor(eAnn.id, '2026-08')
  await apiRequest(`/absence-declarations/${annAbs.id}/cancel`, { method: 'POST', token: rhToken })
  const netAnn = await netFor(eAnn.id, '2026-08')
  rec('S14-ANNULATION', 'Annulation après crédit : régularisation 2 → 2,5', beforeAnn === 2 && Math.abs(netAnn - 2.5) < 0.01, `avant=${beforeAnn} après=${netAnn}`)

  // ── 15. Idempotence séquentielle + au plafond ────────────────────────────
  const countBefore = await movementCount(eReq.id, '2026-08')
  await runAccrual('2026-08')
  const regResp = await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eReq.id, startDate: '2026-08-01', endDate: '2026-08-31' } })
  const countAfter = await movementCount(eReq.id, '2026-08')
  const capReg = await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eCap.id, startDate: '2026-05-01', endDate: '2026-05-31' } })
  rec('S15-IDEMPOTENCE', 'Relance sans duplication (mois courant + plafond)', countBefore === countAfter && (regResp.data?.corrections ?? []).length === 0 && (capReg.data?.corrections ?? []).length === 0, `mouvements ${countBefore}→${countAfter}`)

  // ── 16. Mois traités dans le désordre : résultats cohérents ──────────────
  const eOoo = await empLogin('OOO')
  await registerAbsence(eOoo.id, arretMaladie.id, '2026-09-01', '2026-09-30')
  await runAccrual('2026-09')
  const oooSep = await creditedFor(eOoo.id, '2026-09')
  await runAccrual('2026-08')
  const oooAug = await creditedFor(eOoo.id, '2026-08')
  rec('S16-DESORDRE', 'Mois traités dans le désordre (09 puis 08)', oooSep === 2 && oooAug === 2.5, `09=${oooSep} 08=${oooAug}`)

  // ── 17. Absence non assimilée (non médicale) → crédit 0 ──────────────────
  const eEnf = await empLogin('ENF')
  await registerAbsence(eEnf.id, nonMedical.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  const enfDays = await creditedFor(eEnf.id, '2026-08')
  rec('S17-NON-ASSIMILEE', 'Absence non assimilée (non médicale) : crédit 0', enfDays === 0, `days=${enfDays}`)

  // ── 18. P2 — arrondi unique : février 28 j, 25 travaillés + 3 maladie ────
  const eRound = await empLogin('ROUND')
  await registerAbsence(eRound.id, arretMaladie.id, '2026-02-26', '2026-02-28')
  await runAccrual('2026-02')
  const roundDays = await creditedFor(eRound.id, '2026-02')
  rec('S18-ARRONDI', 'Février 28 j (25 travaillés + 3 maladie) : 2,45 (arrondi unique)', roundDays === 2.45, `days=${roundDays}`)

  // ── 19. P4A — embauche en cours de mois + arrêt chevauchant ──────────────
  const eClip = await empLogin('CLIP', { hireDate: '2026-08-16' })
  await registerAbsence(eClip.id, arretMaladie.id, '2026-08-01', '2026-08-31')
  await runAccrual('2026-08')
  const clipDays = await creditedFor(eClip.id, '2026-08')
  const expectedClip = round2((2 * 16) / 31) // 16 j de maladie couverts par le contrat
  rec('S19-CLIP-CONTRAT', 'Embauche 16/08 + arrêt chevauchant : maladie bornée au contrat', Math.abs(clipDays - expectedClip) < 0.01, `days=${clipDays} expected=${expectedClip}`)

  // ── 20. P5 — mois historique (2023) avec maladie : pas de crédit auto ────
  const eHist = await empLogin('HIST', { hireDate: '2020-01-01' })
  await registerAbsence(eHist.id, arretMaladie.id, '2023-08-01', '2023-08-31')
  const runHist = await runAccrual('2023-08')
  const histDays = await creditedFor(eHist.id, '2023-08')
  const flaggedHist = (runHist.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eHist.id)
  rec('S20-HISTORIQUE', 'Mois 2023 maladie : aucun crédit automatique + signal RH', histDays === 0 && flaggedHist, `days=${histDays} flagged=${flaggedHist}`)

  // ── 21. P1 — ancien mouvement sans accrual_month : pas de double crédit ──
  const eLeg = await empLogin('LEG')
  const [balRow] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2026-2027', 'N', 2.5, 0, 0, 2.5)",
    [eLeg.id],
  )
  const balId = balRow?.insertId
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, NULL, 'Acquisition mensuelle de août 2026 : +2,50 jours')",
    [eLeg.id, balId],
  )
  await runAccrual('2026-08')
  const [legRows] = await conn.query(
    "SELECT accrual_month, COUNT(*) AS c FROM balance_movements WHERE employee_id=? AND movement_type='ACQUISITION' GROUP BY accrual_month",
    [eLeg.id],
  )
  const legOk = legRows.length === 1 && legRows[0].accrual_month === '2026-08' && Number(legRows[0].c) === 1
  rec('S21-LEGACY-UNAMBIGU', 'Ancien mouvement sans accrual_month : rattaché, pas de double crédit', legOk, `rows=${JSON.stringify(legRows)}`)

  // ── 22. P1 — ancien mouvement ambigu : signal RH, pas de crédit auto ─────
  const eAmb = await empLogin('AMB')
  const [ambBal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2026-2027', 'N', 2.5, 0, 0, 2.5)",
    [eAmb.id],
  )
  const ambBalId = ambBal?.insertId
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, NULL, 'Acquisition mensuelle')",
    [eAmb.id, ambBalId],
  )
  const runAmb = await runAccrual('2026-08')
  const ambAcq = await creditedFor(eAmb.id, '2026-08')
  const flaggedAmb = (runAmb.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eAmb.id)
  rec('S22-LEGACY-AMBIGU', 'Ancien mouvement ambigu : signal RH, aucun nouveau crédit', ambAcq === 0 && flaggedAmb, `days=${ambAcq} flagged=${flaggedAmb}`)

  // ── 23. P3 — deux salariés même entité, situations différentes ───────────
  const eMaintA = await empLogin('MAINTA')
  await registerAbsence(eMaintA.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  await createMaintenance(eMaintA.id, '2026-07-01', '2026-07-31')
  const eMaintB = await empLogin('MAINTB')
  await registerAbsence(eMaintB.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  await runAccrual('2026-07')
  const maintADays = await creditedFor(eMaintA.id, '2026-07')
  const maintBDays = await creditedFor(eMaintB.id, '2026-07')
  rec('S23-MAINTIEN-DIFFERENCIE', 'Même entité : avec décision 2,5 / sans décision 2', maintADays === 2.5 && maintBDays === 2, `A=${maintADays} B=${maintBDays}`)

  // ── 24. P3 — maintien partiel d'un arrêt ────────────────────────────────
  const ePart = await empLogin('PART')
  await registerAbsence(ePart.id, arretMaladie.id, '2026-08-01', '2026-08-10')
  await createMaintenance(ePart.id, '2026-08-01', '2026-08-05')
  await runAccrual('2026-08')
  const partDays = await creditedFor(ePart.id, '2026-08')
  // 5 j maintenus (assimilés) + 5 j non maintenus (2/mois) + 21 j travaillés.
  const expectedPart = round2((2.5 * 26 + 2 * 5) / 31)
  rec('S24-MAINTIEN-PARTIEL', 'Maintien partiel (5 j sur 10) : prorata exact', Math.abs(partDays - expectedPart) < 0.01, `days=${partDays} expected=${expectedPart}`)

  // ── 25. P3 — décision RH modifiée après acquisition → recalcul ───────────
  const eDec = await empLogin('DEC')
  await registerAbsence(eDec.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  await runAccrual('2026-07')
  const beforeDec = await creditedFor(eDec.id, '2026-07')
  const decision = await createMaintenance(eDec.id, '2026-07-01', '2026-07-31')
  const netDec = await netFor(eDec.id, '2026-07')
  rec('S25-DECISION-APRES', 'Décision de maintien après acquisition : recalcul 2 → 2,5', beforeDec === 2 && Math.abs(netDec - 2.5) < 0.01, `avant=${beforeDec} après=${netDec}`)

  // ── 26. Concurrence : deux acquisitions simultanées du même mois ────────
  const eConc = await empLogin('CONC')
  const [r1, r2] = await Promise.all([runAccrual('2026-07'), runAccrual('2026-07')])
  const creditedCount =
    [r1, r2].reduce(
      (sum, r) => sum + (r.data?.creditedEmployees ?? []).filter((c) => c.employeeId === eConc.id).length,
      0,
    )
  const concMov = await movementCount(eConc.id, '2026-07')
  rec('S26-CONCURRENCE', 'Deux acquisitions concurrentes (même instance) : un seul mouvement', creditedCount === 1 && concMov === 1, `creditedCount=${creditedCount} mouvements=${concMov}`)

  // ── 27. P1 — ancien mouvement d'un AUTRE mois n'est pas ambigu ──────────
  const eLeg2 = await empLogin('LEG2')
  const [leg2Bal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2025-2026', 'N', 2.5, 0, 0, 2.5)",
    [eLeg2.id],
  )
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, NULL, 'Acquisition mensuelle de août 2025 : +2,50 jours')",
    [eLeg2.id, leg2Bal?.insertId],
  )
  await runAccrual('2026-08')
  const leg2Aug2026 = await creditedFor(eLeg2.id, '2026-08')
  const [leg2Null] = await conn.query(
    "SELECT COUNT(*) AS c FROM balance_movements WHERE employee_id=? AND accrual_month IS NULL AND movement_type='ACQUISITION'",
    [eLeg2.id],
  )
  rec('S27-LEGACY-AUTRE-MOIS', 'Ancien mouvement août 2025 ne bloque pas août 2026', leg2Aug2026 === 2.5 && Number(leg2Null?.[0]?.c) === 1, `2026=${leg2Aug2026} legacyNull=${Number(leg2Null?.[0]?.c)}`)

  // ── 28. P1 — modification rétroactive d'une ancienne période légacy ─────
  await registerAbsence(eLeg2.id, arretMaladie.id, '2025-08-01', '2025-08-31')
  const leg2Net2025 = await netFor(eLeg2.id, '2025-08')
  rec('S28-LEGACY-REGULARISATION', 'Régularisation de l’ancienne période rattachée : 2,5 → 2', Math.abs(leg2Net2025 - 2) < 0.01, `net=${leg2Net2025}`)

  // ── 29. P2 — régularisation sans changement sur une période pleine ───────
  const regCapAug = await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eCap.id, startDate: '2025-08-01', endDate: '2025-08-31' } })
  const capAugNet = await netFor(eCap.id, '2025-08')
  rec('S29-CAP-REGULARISATION', 'Régularisation sans changement (août 2025) : delta 0', (regCapAug.data?.corrections ?? []).length === 0 && Math.abs(capAugNet - 2) < 0.01, `corrections=${JSON.stringify(regCapAug.data?.corrections ?? [])} net=${capAugNet}`)

  // ── 30. P2 — requalification d'un mois au plafond, puis inverse ─────────
  const [capAugRows] = await conn.query(
    "SELECT a.id FROM absence_declarations a INNER JOIN leave_types lt ON lt.id=a.leave_type_id WHERE a.employee_id=? AND lt.absence_kind='ARRET_MALADIE' AND a.start_date='2025-08-01'",
    [eCap.id],
  )
  const capAugAbs = capAugRows?.[0]?.id
  await apiRequest(`/absence-declarations/${capAugAbs}`, { method: 'PATCH', token: rhToken, body: { leaveTypeId: atMp.id } })
  const capAugAtmp = await netFor(eCap.id, '2025-08')
  await apiRequest(`/absence-declarations/${capAugAbs}`, { method: 'PATCH', token: rhToken, body: { leaveTypeId: arretMaladie.id } })
  const capAugBack = await netFor(eCap.id, '2025-08')
  const capRelance = await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eCap.id, startDate: '2025-08-01', endDate: '2025-08-31' } })
  rec('S30-CAP-REQUALIFICATION', 'Requalif AT/MP puis inverse au plafond : 2,5 puis 2, relance delta 0', Math.abs(capAugAtmp - 2.5) < 0.01 && Math.abs(capAugBack - 2) < 0.01 && (capRelance.data?.corrections ?? []).length === 0, `atmp=${capAugAtmp} back=${capAugBack}`)

  // ── 31. P3 — chevauchement contradictoire maladie / AT-MP ───────────────
  const eConf1 = await empLogin('CONF1')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-15', '2026-08-15', 'ENREGISTREE', 1), (?, ?, '2026-08-15', '2026-08-15', 'ENREGISTREE', 1)",
    [eConf1.id, arretMaladie.id, eConf1.id, atMp.id],
  )
  const runConf1 = await runAccrual('2026-08')
  const conf1Days = await creditedFor(eConf1.id, '2026-08')
  const conf1Flagged = (runConf1.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eConf1.id && /contradictoires/.test(r.reason))
  rec('S31-CONFLIT-MALADIE-ATMP', 'Chevauchement maladie/AT-MP : anomalie RH, jour exclu (2,42)', conf1Flagged && Math.abs(conf1Days - round2((2.5 * 30) / 31)) < 0.01, `days=${conf1Days} flagged=${conf1Flagged}`)

  // ── 32. P3 — deux déclarations identiques : pas de conflit ──────────────
  const eConf2 = await empLogin('CONF2')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-16', '2026-08-16', 'ENREGISTREE', 1), (?, ?, '2026-08-16', '2026-08-16', 'ENREGISTREE', 1)",
    [eConf2.id, arretMaladie.id, eConf2.id, arretMaladie.id],
  )
  const runConf2 = await runAccrual('2026-08')
  const conf2Days = await creditedFor(eConf2.id, '2026-08')
  const conf2Flagged = (runConf2.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eConf2.id && /contradictoires/.test(r.reason))
  rec('S32-CONFLIT-IDENTIQUE', 'Deux déclarations identiques : pas de conflit, 1 jour maladie', !conf2Flagged && Math.abs(conf2Days - round2((2.5 * 30 + 2 * 1) / 31)) < 0.01, `days=${conf2Days} flagged=${conf2Flagged}`)

  // ── 33. P3 — chevauchement maladie / absence non assimilée ──────────────
  const eConf3 = await empLogin('CONF3')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-17', '2026-08-17', 'ENREGISTREE', 1), (?, ?, '2026-08-17', '2026-08-17', 'ENREGISTREE', 1)",
    [eConf3.id, arretMaladie.id, eConf3.id, nonMedical.id],
  )
  const runConf3 = await runAccrual('2026-08')
  const conf3Days = await creditedFor(eConf3.id, '2026-08')
  const conf3Flagged = (runConf3.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eConf3.id && /contradictoires/.test(r.reason))
  rec('S33-CONFLIT-NON-ASSIMILEE', 'Chevauchement maladie/non assimilée : anomalie RH, jour exclu', conf3Flagged && Math.abs(conf3Days - round2((2.5 * 30) / 31)) < 0.01, `days=${conf3Days} flagged=${conf3Flagged}`)

  // ── 34-38. P4 — changement de loi avril 2024 (dates effectives) ─────────
  const eM24 = await empLogin('M24')
  await registerAbsence(eM24.id, arretMaladie.id, '2024-03-01', '2024-03-31')
  const runM24 = await runAccrual('2024-03')
  rec('S34-HISTO-MARS2024', 'Mars 2024 maladie : 0 j auto + signal historique', (await creditedFor(eM24.id, '2024-03')) === 0 && (runM24.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eM24.id), `days=${await creditedFor(eM24.id, '2024-03')}`)

  const eA1 = await empLogin('A1')
  await registerAbsence(eA1.id, arretMaladie.id, '2024-04-01', '2024-04-23')
  const runA1 = await runAccrual('2024-04')
  const a1Days = await creditedFor(eA1.id, '2024-04')
  rec('S35-HISTO-AVRIL-1-23', 'Avril 2024 arrêt 1→23 : 7 j de travail certains (0,58) + signal', Math.abs(a1Days - round2((2.5 * 7) / 30)) < 0.01 && (runA1.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eA1.id), `days=${a1Days}`)

  const eA2 = await empLogin('A2')
  await registerAbsence(eA2.id, arretMaladie.id, '2024-04-24', '2024-04-30')
  const runA2 = await runAccrual('2024-04')
  const a2Days = await creditedFor(eA2.id, '2024-04')
  const a2Hist = (runA2.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eA2.id && /antérieurs au 24\/04\/2024/.test(r.reason))
  rec('S36-HISTO-AVRIL-24-30', 'Avril 2024 arrêt 24→30 : règles actuelles (2,38), pas de signal historique', Math.abs(a2Days - round2((2.5 * 23 + 2 * 7) / 30)) < 0.01 && !a2Hist, `days=${a2Days}`)

  const eA3 = await empLogin('A3')
  await registerAbsence(eA3.id, arretMaladie.id, '2024-04-20', '2024-04-26')
  const runA3 = await runAccrual('2024-04')
  const a3Days = await creditedFor(eA3.id, '2024-04')
  rec('S37-HISTO-AVRIL-TRAVERSANT', 'Avril 2024 arrêt 20→26 : 4 j historiques + 3 j actuels (2,12)', Math.abs(a3Days - round2((2.5 * 23 + 2 * 3) / 30)) < 0.01 && (runA3.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eA3.id && /antérieurs au 24\/04\/2024/.test(r.reason)), `days=${a3Days}`)

  const eMai24 = await empLogin('MAI24')
  await registerAbsence(eMai24.id, arretMaladie.id, '2024-05-01', '2024-05-31')
  await runAccrual('2024-05')
  rec('S38-HISTO-MAI2024', 'Mai 2024 maladie : 2 j (règles actuelles)', (await creditedFor(eMai24.id, '2024-05')) === 2, `days=${await creditedFor(eMai24.id, '2024-05')}`)

  // ── 39. P4 — AT/MP historique : limite d'un an ───────────────────────────
  const eLongH = await empLogin('LONGH')
  await registerAbsence(eLongH.id, atMp.id, '2023-01-01', '2024-03-31')
  const runLongH = await runAccrual('2024-03')
  rec('S39-ATMP-HISTORIQUE-1AN', 'AT/MP > 1 an (2023-2024) : exclu + signal historique', (await creditedFor(eLongH.id, '2024-03')) === 0 && (runLongH.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eLongH.id), `days=${await creditedFor(eLongH.id, '2024-03')}`)

  const eShortH = await empLogin('SHORTH')
  await registerAbsence(eShortH.id, atMp.id, '2023-06-01', '2023-12-31')
  const runShortH = await runAccrual('2023-07')
  const shortHFlag = (runShortH.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eShortH.id && /antérieurs au 24\/04\/2024/.test(r.reason))
  rec('S39b-ATMP-HISTORIQUE-1AN-OK', 'AT/MP ≤ 1 an (2023) : assimilé 2,5 sans signal', (await creditedFor(eShortH.id, '2023-07')) === 2.5 && !shortHFlag, `days=${await creditedFor(eShortH.id, '2023-07')}`)

  // ── 40. P5 — fondement non applicable ────────────────────────────────────
  const eBad = await empLogin('BAD', { legalEntityId: effId })
  await registerAbsence(eBad.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const badResp = await createMaintenance(eBad.id, '2026-07-01', '2026-07-31', 'Fondement inapplicable', 'SYNTEC_5_5')
  rec('S40-FONDEMENT-NON-APPLICABLE', 'Syntec 5.5 sur salarié régime légal : refusé (400)', badResp.status === 400, `status=${badResp.status}`)

  // ── 41. P1 — AT/MP long : première année assimilée (salarié dédié) ──────
  const eFirstY = await empLogin('FIRSTY')
  await registerAbsence(eFirstY.id, atMp.id, '2023-01-01', '2024-03-31')
  await runAccrual('2023-07')
  const firstYearDays = await creditedFor(eFirstY.id, '2023-07')
  rec('S41-ATMP-PREMIERE-ANNEE', 'AT/MP long : première année (2023-07) assimilée 2,5', firstYearDays === 2.5, `days=${firstYearDays}`)

  // ── 42. P1 — deux déclarations AT/MP consécutives = un seul arrêt continu ─
  const eSeq = await empLogin('SEQ')
  await registerAbsence(eSeq.id, atMp.id, '2023-01-01', '2023-06-30')
  await registerAbsence(eSeq.id, atMp.id, '2023-07-01', '2024-03-31')
  await runAccrual('2023-07')
  await runAccrual('2024-03')
  const seqFirst = await creditedFor(eSeq.id, '2023-07')
  const seqAfter = await creditedFor(eSeq.id, '2024-03')
  rec('S42-ATMP-CONSECUTIF', 'Deux déclarations consécutives : 1re année 2,5 puis au-delà 0', seqFirst === 2.5 && seqAfter === 0, `2023-07=${seqFirst} 2024-03=${seqAfter}`)

  // ── 43. P1 — interruption réelle entre deux arrêts : compteur réinitialisé ─
  const eGap = await empLogin('GAP')
  await registerAbsence(eGap.id, atMp.id, '2022-01-01', '2022-06-30')
  await registerAbsence(eGap.id, atMp.id, '2023-01-01', '2024-12-31')
  await runAccrual('2023-07')
  const gapDays = await creditedFor(eGap.id, '2023-07')
  rec('S43-ATMP-INTERRUPTION', 'Interruption entre deux arrêts : 2e période repart à 0 (2,5)', gapDays === 2.5, `days=${gapDays}`)

  // ── 44. P2 — cycle de vie d'une anomalie de conflit ──────────────────────
  const [confAnomaly] = await conn.query(
    "SELECT id, status, days FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-08'",
    [eConf1.id],
  )
  const confOpen = confAnomaly?.[0]?.status === 'OPEN' && Number(confAnomaly?.[0]?.days) === 1
  const [confAtmpAbs] = await conn.query(
    'SELECT id FROM absence_declarations WHERE employee_id=? AND leave_type_id=? AND start_date=\'2026-08-15\'',
    [eConf1.id, atMp.id],
  )
  await conn.query("UPDATE absence_declarations SET status='ANNULEE' WHERE id=?", [confAtmpAbs?.[0]?.id])
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eConf1.id, startDate: '2026-08-01', endDate: '2026-08-31' } })
  const [confAfter] = await conn.query(
    "SELECT status, days FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-08'",
    [eConf1.id],
  )
  const confResolved = confAfter?.[0]?.status === 'RESOLVED' && Number(confAfter?.[0]?.days) === 0
  const confNet = await netFor(eConf1.id, '2026-08')
  rec('S44-CONFLIT-CYCLE-VIE', 'Conflit → anomalie ouverte → correction → résolue + compteur exact', confOpen && confResolved && Math.abs(confNet - round2((2.5 * 30 + 2 * 1) / 31)) < 0.01, `open=${confOpen} resolved=${confResolved} net=${confNet}`)

  // ── 45. P3 — mouvement ambigu dans une AUTRE période ne bloque pas ──────
  const eAmb2 = await empLogin('AMB2')
  const [amb2Bal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2023-2024', 'N', 2.5, 0, 0, 2.5)",
    [eAmb2.id],
  )
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, NULL, 'Acquisition mensuelle')",
    [eAmb2.id, amb2Bal?.insertId],
  )
  const runAmb2 = await runAccrual('2026-08')
  const amb2Days = await creditedFor(eAmb2.id, '2026-08')
  const amb2Flagged = (runAmb2.data?.manualReviewRequired ?? []).some((r) => r.employeeId === eAmb2.id && /sans mois identifiable/.test(r.reason))
  rec('S45-AMBIGU-AUTRE-PERIODE', 'Ancien mouvement ambigu (2023-2024) ne bloque pas 2026-2027', amb2Days === 2.5 && !amb2Flagged, `days=${amb2Days} flagged=${amb2Flagged}`)

  // ── 46. P1 — fondement AUTRE : sans document vérifié → PROPOSITION ──────
  const eAutre = await empLogin('AUTRE')
  await registerAbsence(eAutre.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const autreNoDoc = await createMaintenance(eAutre.id, '2026-07-01', '2026-07-31', 'Justification libre', 'AUTRE')
  await runAccrual('2026-07')
  const autreNoDocDays = await creditedFor(eAutre.id, '2026-07')
  rec('S46-FONDEMENT-AUTRE-SANS-SOURCE', 'AUTRE sans document vérifié : PROPOSITION non appliquée (2 j)', autreNoDoc.status === 201 && autreNoDoc.data?.basisValidationStatus === 'PROPOSED' && autreNoDocDays === 2, `status=${autreNoDoc.status} basisStatus=${autreNoDoc.data?.basisValidationStatus} days=${autreNoDocDays}`)

  // ── 47. P1 — accord d'entreprise : la période de validité est une donnée
  // ENREGISTRÉE sur l'entité ET adossée à un justificatif d'accord VÉRIFIÉ.
  const mkAccordEntity = async (code, validFrom, validTo, withDocument = true) => {
    const inserted = (
      await conn.query(
        "INSERT INTO legal_entities (code, name, convention_type, idcc, convention_name, accord_type, accord_name, accord_idcc, accord_valid_from, accord_valid_to, illness_wage_maintenance, is_active, sort_order, created_at, updated_at) VALUES (?, 'Entité accord recette', 'SYNTEC', '1486', 'Syntec recette', 'ACCORD_ENTREPRISE', 'Accord recette', 'IDCC-ACC-RECETTE', ?, ?, 'UNKNOWN', 1, 0, NOW(), NOW())",
        [code, validFrom, validTo],
      )
    )?.[0]?.insertId
    if (withDocument) {
      const docId = await createAccordDocument(inserted)
      await conn.query('UPDATE legal_entities SET accord_document_id=? WHERE id=?', [docId, inserted])
    }
    return inserted
  }
  const accordExpiredEntityId = await mkAccordEntity(`ACCORD-EXP-${TAG}`, '2023-07-01', '2026-06-30')
  const accordValidEntityId = await mkAccordEntity(`ACCORD-VAL-${TAG}`, '2023-07-01', '2026-12-31')
  const accordNoDatesEntityId = await mkAccordEntity(`ACCORD-NOD-${TAG}`, null, null, false)

  const eAccordExp = await empLogin('ACCORDE', { legalEntityId: accordExpiredEntityId })
  await registerAbsence(eAccordExp.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  // L'entité enregistre un accord EXPIRÉ au 30/06/2026 : juillet 2026 hors période.
  const accordExpired = await createMaintenance(eAccordExp.id, '2026-07-01', '2026-07-31', 'Accord d’entreprise.', 'ACCORD_ENTREPRISE', 'Accord recette')
  await runAccrual('2026-07')
  const accordExpDays = await creditedFor(eAccordExp.id, '2026-07')

  const eAccordOk = await empLogin('ACCORDV', { legalEntityId: accordValidEntityId })
  await registerAbsence(eAccordOk.id, arretMaladie.id, '2026-05-01', '2026-05-31')
  // Accord ENREGISTRÉ valide couvrant mai 2026 → applicabilité établie.
  const accordValid = await createMaintenance(eAccordOk.id, '2026-05-01', '2026-05-31', 'Accord d’entreprise valide.', 'ACCORD_ENTREPRISE', 'Accord recette')
  await runAccrual('2026-05')
  const accordOkDays = await creditedFor(eAccordOk.id, '2026-05')
  rec('S47-ACCORD-VALIDITE', 'Accord expiré → PROPOSITION (2 j) ; accord enregistré couvrant → VALIDATED (2,5 j)', accordExpired.status === 201 && accordExpired.data?.basisValidationStatus === 'PROPOSED' && accordExpDays === 2 && accordValid.status === 201 && accordValid.data?.basisValidationStatus === 'VALIDATED' && accordOkDays === 2.5, `exp=${accordExpDays}/${accordExpired.data?.basisValidationStatus} val=${accordOkDays}/${accordValid.data?.basisValidationStatus}`)

  // ── 47b. P2 — dates librement inventées sur la décision : aucune validation ─
  const eAccordInvent = await empLogin('ACCORDINV', { legalEntityId: accordNoDatesEntityId })
  await registerAbsence(eAccordInvent.id, arretMaladie.id, '2026-05-01', '2026-05-31')
  // Aucune validité ENREGISTRÉE sur l'entité : même avec des dates saisies sur la
  // décision, la source de vérité manque → PROPOSITION, aucun crédit supérieur.
  const accordInvented = await createMaintenance(eAccordInvent.id, '2026-05-01', '2026-05-31', 'Accord revendiqué.', 'ACCORD_ENTREPRISE', 'Accord recette', { basisValidFrom: '2020-01-01', basisValidTo: '2030-12-31' })
  await runAccrual('2026-05')
  const accordInventDays = await creditedFor(eAccordInvent.id, '2026-05')
  rec('S47b-ACCORD-DATES-INVENTEES', 'Dates librement inventées sans validité enregistrée : PROPOSITION (2 j)', accordInvented.status === 201 && accordInvented.data?.basisValidationStatus === 'PROPOSED' && accordInventDays === 2, `basis=${accordInvented.data?.basisValidationStatus} days=${accordInventDays}`)

  // ── 48. P4 — deux décisions simultanées (verrou GET_LOCK) ───────────────
  const eConc2 = await empLogin('CONC2')
  await registerAbsence(eConc2.id, arretMaladie.id, '2026-10-01', '2026-10-31')
  const [cA, cB] = await Promise.all([
    createMaintenance(eConc2.id, '2026-10-01', '2026-10-31', 'Décision A'),
    createMaintenance(eConc2.id, '2026-10-15', '2026-10-20', 'Décision B'),
  ])
  const concStatuses = [cA.status, cB.status].sort((a, b) => a - b)
  rec('S48-DECISION-CONCURRENCE', 'Deux décisions simultanées : une 201 + une 409 (verrou)', concStatuses[0] === 201 && concStatuses[1] === 409, `statuses=${concStatuses.join(',')}`)

  // ── 49. P2 — endpoint de résolution : refuse sans justification, clôture RH ─
  const eRes = await empLogin('RES')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-09-15', '2026-09-15', 'ENREGISTREE', 1), (?, ?, '2026-09-15', '2026-09-15', 'ENREGISTREE', 1)",
    [eRes.id, arretMaladie.id, eRes.id, atMp.id],
  )
  await runAccrual('2026-09')
  const [resAn] = await conn.query(
    "SELECT id FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-09' ORDER BY id DESC LIMIT 1",
    [eRes.id],
  )
  const resAnId = resAn?.[0]?.id
  const resNoReason = await apiRequest(`/leave-balances/accrual-anomalies/${resAnId}/resolve`, { method: 'POST', token: rhToken, body: {} })
  const resReasonNoKind = await apiRequest(`/leave-balances/accrual-anomalies/${resAnId}/resolve`, { method: 'POST', token: rhToken, body: { decisionReason: 'Justification seule, sans classification retenue.' } })
  const resWithKind = await apiRequest(`/leave-balances/accrual-anomalies/${resAnId}/resolve`, { method: 'POST', token: rhToken, body: { decisionReason: 'Chevauchement documenté : la RH retient l’arrêt maladie.', retainedKind: 'ARRET_MALADIE' } })
  const [resAfter] = await conn.query(
    'SELECT status, resolution_mode, resolution_reason, retained_kind FROM accrual_anomalies WHERE id=?',
    [resAnId],
  )
  // Le moteur applique réellement la classification retenue : le jour n'est
  // plus exclu, il est compté comme 1 j de maladie (2,48 au lieu de 2,42).
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eRes.id, startDate: '2026-09-01', endDate: '2026-09-30' } })
  const resNet = await netFor(eRes.id, '2026-09')
  // Relance : la décision RH n'est pas annulée, l'anomalie reste RH_DECIDED.
  await runAccrual('2026-09')
  const [resAfterRerun] = await conn.query(
    'SELECT status, retained_kind FROM accrual_anomalies WHERE id=?',
    [resAnId],
  )
  rec('S49-RESOLUTION-CONTROLEE', 'Résolution : justification seule refusée, classification retenue appliquée et stable', resNoReason.status === 400 && resReasonNoKind.status === 400 && resWithKind.status === 201 && resAfter?.[0]?.status === 'RH_DECIDED' && resAfter?.[0]?.resolution_mode === 'RH_DECISION' && resAfter?.[0]?.retained_kind === 'ARRET_MALADIE' && Math.abs(resNet - round2((2.5 * 30 + 2 * 1) / 31)) < 0.01 && resAfterRerun?.[0]?.status === 'RH_DECIDED', `noReason=${resNoReason.status} noKind=${resReasonNoKind.status} withKind=${resWithKind.status} net=${resNet} rerun=${resAfterRerun?.[0]?.status}`)

  // ── 49b. P2 — résolution VÉRIFIÉE quand la cause a réellement disparu ──
  const eVer = await empLogin('VER')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-18', '2026-08-18', 'ENREGISTREE', 1), (?, ?, '2026-08-18', '2026-08-18', 'ENREGISTREE', 1)",
    [eVer.id, arretMaladie.id, eVer.id, atMp.id],
  )
  await runAccrual('2026-08')
  const [verAn] = await conn.query(
    "SELECT id FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-08' AND days > 0 ORDER BY id DESC LIMIT 1",
    [eVer.id],
  )
  const verAnId = verAn?.[0]?.id
  await conn.query(
    "UPDATE absence_declarations SET status='ANNULEE' WHERE employee_id=? AND leave_type_id=? AND start_date='2026-08-18'",
    [eVer.id, atMp.id],
  )
  const verResolve = await apiRequest(`/leave-balances/accrual-anomalies/${verAnId}/resolve`, { method: 'POST', token: rhToken, body: {} })
  const [verAfter] = await conn.query(
    'SELECT status, resolution_mode, resolution_reason FROM accrual_anomalies WHERE id=?',
    [verAnId],
  )
  rec('S49b-RESOLUTION-VERIFIED', 'Résolution VÉRIFIÉE sans justification quand la cause a disparu', verResolve.status === 201 && verAfter?.[0]?.status === 'RESOLVED' && verAfter?.[0]?.resolution_mode === 'VERIFIED' && !verAfter?.[0]?.resolution_reason, `status=${verResolve.status} mode=${verAfter?.[0]?.resolution_mode}`)

  // ── 50. P2 — date anniversaire : 14 j assimilés + 17 j provisoires ───────
  const eAnniv = await empLogin('ANNIV')
  await registerAbsence(eAnniv.id, atMp.id, '2023-03-15', '2024-03-31')
  await runAccrual('2024-03')
  const [annivAn] = await conn.query(
    "SELECT days FROM accrual_anomalies WHERE employee_id=? AND type='HISTORICAL_PENDING' AND accrual_month='2024-03'",
    [eAnniv.id],
  )
  const annivPending = Number(annivAn?.[0]?.days ?? 0)
  const annivCredit = await creditedFor(eAnniv.id, '2024-03')
  rec('S50-ATMP-ANNIVERSAIRE', 'Date anniversaire 15/03 : 14 j assimilés + 17 j provisoires', annivPending === 17 && Math.abs(annivCredit - round2((2.5 * 14) / 31)) < 0.01, `pending=${annivPending} days=${annivCredit}`)

  // ── 51. P2 — 29 février : date anniversaire en année non bissextile ──────
  const eFeb = await empLogin('FEB')
  await registerAbsence(eFeb.id, atMp.id, '2020-02-29', '2021-02-28')
  await runAccrual('2021-02')
  const [febAn] = await conn.query(
    "SELECT days FROM accrual_anomalies WHERE employee_id=? AND type='HISTORICAL_PENDING' AND accrual_month='2021-02'",
    [eFeb.id],
  )
  const febPending = Number(febAn?.[0]?.days ?? 0)
  const febCredit = await creditedFor(eFeb.id, '2021-02')
  rec('S51-ATMP-29-FEVRIER', '29 février (anniversaire 28/02/2021) : 27 j assimilés + 1 j provisoire', febPending === 1 && Math.abs(febCredit - round2((2.5 * 27) / 28)) < 0.01, `pending=${febPending} days=${febCredit}`)

  // ── 52. P2 — Cass. 22-17.638 : pas de correction négative définitive ─────
  const eCass = await empLogin('CASS')
  await registerAbsence(eCass.id, atMp.id, '2023-01-01', '2024-03-31')
  const [cassBal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2023-2024', 'N', 2.5, 0, 0, 2.5)",
    [eCass.id],
  )
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, '2024-03', 'Acquisition mensuelle de mars 2024 : +2,50 jours')",
    [eCass.id, cassBal?.insertId],
  )
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eCass.id, startDate: '2024-03-01', endDate: '2024-03-31' } })
  const cassNet = await netFor(eCass.id, '2024-03')
  const [cassCorr] = await conn.query(
    "SELECT COUNT(*) AS c FROM balance_movements WHERE employee_id=? AND accrual_month='2024-03' AND movement_type='CORRECTION_NEGATIVE'",
    [eCass.id],
  )
  rec('S52-CASSATION-PAS-DE-NEGATIF', 'Cass. 22-17.638 : aucune correction négative sur les jours au-delà d’un an', Math.abs(cassNet - 2.5) < 0.01 && Number(cassCorr?.[0]?.c) === 0, `net=${cassNet} negCorr=${Number(cassCorr?.[0]?.c)}`)

  // ── 53. P1 — clause contractuelle sans source vérifiée → aucun droit auto ─
  const eContrat = await empLogin('CONTRAT')
  await registerAbsence(eContrat.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const contratResp = await createMaintenance(eContrat.id, '2026-07-01', '2026-07-31', 'Clause contractuelle déclarée sans justificatif.', 'CONTRACTUEL', 'Clause art. 3', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31' })
  await runAccrual('2026-07')
  const contratDays = await creditedFor(eContrat.id, '2026-07')
  rec('S53-CONTRACTUEL-SANS-SOURCE', 'Clause contractuelle sans document vérifié : aucun droit supplémentaire automatique', contratResp.status === 201 && contratResp.data?.basisValidationStatus === 'PROPOSED' && contratDays === 2, `status=${contratResp.status} basis=${contratResp.data?.basisValidationStatus} days=${contratDays}`)

  // ── 54. P1 — AUTRE valable avec Syntec : autorisé après vérification ─────
  const eAutreOk = await empLogin('AUTREOK')
  await registerAbsence(eAutreOk.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const docId = await createVerifiedDocument(eAutreOk.id)
  const autreOkResp = await createMaintenance(eAutreOk.id, '2026-07-01', '2026-07-31', 'Disposition distincte plus favorable, justificatif validé.', 'AUTRE', 'Convention de branche distincte art. 12', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31', basisDocumentId: docId })
  await runAccrual('2026-07')
  const autreOkDays = await creditedFor(eAutreOk.id, '2026-07')
  rec('S54-AUTRE-AVEC-SYNTEC', 'AUTRE valable avec Syntec (document validé) : VALIDATED (2,5 j)', autreOkResp.status === 201 && autreOkResp.data?.basisValidationStatus === 'VALIDATED' && autreOkDays === 2.5, `status=${autreOkResp.status} basis=${autreOkResp.data?.basisValidationStatus} days=${autreOkDays}`)

  // ── 55. P1 — accord couvrant seulement une partie de l'arrêt ────────────
  const accordPartialEntityId = await mkAccordEntity(`ACCORD-PART-${TAG}`, '2026-07-01', '2026-07-15')
  const ePartAccord = await empLogin('PARTACC', { legalEntityId: accordPartialEntityId })
  await registerAbsence(ePartAccord.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  // Accord ENREGISTRÉ valide du 01/07/2026 au 15/07/2026 : seuls les 15 premiers
  // jours de l'arrêt sont assimilés ; les 16 suivants restent au socle légal.
  const partAccordResp = await createMaintenance(ePartAccord.id, '2026-07-01', '2026-07-31', 'Accord partiel.', 'ACCORD_ENTREPRISE', 'Accord recette')
  await runAccrual('2026-07')
  const partAccordDays = await creditedFor(ePartAccord.id, '2026-07')
  const expectedPartAccord = round2((2.5 * 15 + 2 * 16) / 31)
  rec('S55-ACCORD-COUVERTURE-PARTIELLE', 'Accord ne couvrant qu’une partie : seule la période couverte est assimilée', partAccordResp.status === 201 && partAccordResp.data?.basisValidationStatus === 'VALIDATED' && Math.abs(partAccordDays - expectedPartAccord) < 0.01, `status=${partAccordResp.status} basis=${partAccordResp.data?.basisValidationStatus} days=${partAccordDays} expected=${expectedPartAccord}`)

  // ── 56. P1 — modification/annulation du fondement : régularisation tracée ─
  const eMod = await empLogin('MODBAS')
  await registerAbsence(eMod.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const modResp = await createMaintenance(eMod.id, '2026-07-01', '2026-07-31', 'Syntec 5.5.', 'SYNTEC_5_5')
  await runAccrual('2026-07')
  const modBefore = await creditedFor(eMod.id, '2026-07')
  // Modification RÉELLE du fondement : Syntec 5.5 → clause contractuelle sans
  // document vérifié (PROPOSITION). Le droit doit retomber au socle légal (2 j).
  await apiRequest(`/illness-maintenance/${modResp.data.id}`, { method: 'PATCH', token: rhToken, body: { basis: 'CONTRACTUEL', basisReference: 'Clause art. 9' } })
  const modNet = await netFor(eMod.id, '2026-07')
  const [modAudit] = await conn.query(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='ILLNESS_MAINTENANCE_DECISION' AND resource_id=?",
    [modResp.data.id],
  )
  rec('S56-MODIFICATION-TRACEE', 'Modification réelle du fondement : droit révisé (2,5→2) et audit tracé', Math.abs(modBefore - 2.5) < 0.01 && Math.abs(modNet - 2) < 0.01 && Number(modAudit?.[0]?.c) >= 2, `before=${modBefore} net=${modNet} audit=${Number(modAudit?.[0]?.c)}`)

  // ── 57. P3 — mois entièrement historique : aucun retrait automatique ────
  // (déjà couvert par S52 : net reste 2,5, aucune correction négative)

  // ── 58. P3 — mois mixte : correction certaine négative appliquée ────────
  const eMixNeg = await empLogin('MIXNEG')
  // 2024-04 : arrêt maladie 1→23 (historique, provisoire) + jours 24→30 travaillés.
  await registerAbsence(eMixNeg.id, arretMaladie.id, '2024-04-01', '2024-04-23')
  await runAccrual('2024-04')
  const mixNegBefore = await creditedFor(eMixNeg.id, '2024-04')
  // Correction certaine : un arrêt NON MÉDICAL (non assimilé) est ajouté 24→30.
  await registerAbsence(eMixNeg.id, nonMedical.id, '2024-04-24', '2024-04-30')
  const mixNegNet = await netFor(eMixNeg.id, '2024-04')
  rec('S58-MIXTE-CERTAIN-NEGATIF', 'Mois mixte : correction négative certaine appliquée (part non assimilée)', Math.abs(mixNegBefore - round2((2.5 * 7) / 30)) < 0.01 && Math.abs(mixNegNet - 0) < 0.01, `before=${mixNegBefore} net=${mixNegNet}`)

  // ── 59. P3 — relances multiples : aucun doublon de correction ───────────
  const mixNegCount1 = await movementCount(eMixNeg.id, '2024-04')
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eMixNeg.id, startDate: '2024-04-01', endDate: '2024-04-30' } })
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eMixNeg.id, startDate: '2024-04-01', endDate: '2024-04-30' } })
  const mixNegCount2 = await movementCount(eMixNeg.id, '2024-04')
  rec('S59-RELANCES-SANS-DOUBLON', 'Relances multiples : aucun doublon de mouvement', mixNegCount1 === mixNegCount2, `movements ${mixNegCount1}→${mixNegCount2}`)

  // ── 60. P2 — décision antérieure (LEGACY_PENDING) : portée exacte ──────
  // (a) Acquis RÉELLEMENT présent avant requalification : recalcul sans retrait.
  const eLegacyKeep = await empLogin('LEGKEEP')
  await registerAbsence(eLegacyKeep.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const legacyKeepResp = await createMaintenance(eLegacyKeep.id, '2026-07-01', '2026-07-31', 'Maintien historique.', 'AUTRE', 'Disposition historique', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31' })
  await conn.query("UPDATE illness_maintenance_decisions SET basis_validation_status='LEGACY_PENDING' WHERE id=?", [legacyKeepResp.data.id])
  const [keepBal] = await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2026-2027', 'N', 2.5, 0, 0, 2.5)",
    [eLegacyKeep.id],
  )
  await conn.query(
    "INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, accrual_month, reason) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, '2026-07', 'Acquisition antérieure à la structuration')",
    [eLegacyKeep.id, keepBal?.insertId],
  )
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eLegacyKeep.id, startDate: '2026-07-01', endDate: '2026-07-31' } })
  const legacyKeepNet = await netFor(eLegacyKeep.id, '2026-07')
  const [legacyKeepCorr] = await conn.query(
    "SELECT COUNT(*) AS c FROM balance_movements WHERE employee_id=? AND accrual_month='2026-07' AND movement_type='CORRECTION_NEGATIVE'",
    [eLegacyKeep.id],
  )
  rec('S60a-LEGACY-PRESERVE', 'Acquis antérieur + LEGACY_PENDING : recalcul sans retrait injustifié (net 2,5)', Math.abs(legacyKeepNet - 2.5) < 0.01 && Number(legacyKeepCorr?.[0]?.c) === 0, `net=${legacyKeepNet} negCorr=${Number(legacyKeepCorr?.[0]?.c)}`)

  // (b) Aucun crédit antérieur : une décision LEGACY_PENDING non vérifiée
  //     n'attribue AUCUN avantage conventionnel nouveau.
  const eLegacyNew = await empLogin('LEGNEW')
  await registerAbsence(eLegacyNew.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const legacyNewResp = await createMaintenance(eLegacyNew.id, '2026-07-01', '2026-07-31', 'Maintien historique.', 'AUTRE', 'Disposition historique', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31' })
  await conn.query("UPDATE illness_maintenance_decisions SET basis_validation_status='LEGACY_PENDING' WHERE id=?", [legacyNewResp.data.id])
  await runAccrual('2026-07')
  const legacyNewDays = await creditedFor(eLegacyNew.id, '2026-07')
  rec('S60b-LEGACY-SANS-ANTERIEUR', 'LEGACY_PENDING sans crédit antérieur : aucun droit conventionnel nouveau (2 j)', legacyNewDays === 2, `days=${legacyNewDays}`)

  // ── 61. P2 — document appartenant à un autre salarié : refus ────────────
  const eDocOther = await empLogin('DOCOTHER')
  await registerAbsence(eDocOther.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const otherEmp = await empLogin('DOCOTHER2')
  const otherDocId = await createVerifiedDocument(otherEmp.id)
  const docOtherResp = await createMaintenance(eDocOther.id, '2026-07-01', '2026-07-31', 'Document rattaché à un autre salarié.', 'AUTRE', 'Disposition', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31', basisDocumentId: otherDocId })
  await runAccrual('2026-07')
  const docOtherDays = await creditedFor(eDocOther.id, '2026-07')
  rec('S61-DOC-AUTRE-SALARIE', 'Document appartenant à un autre salarié : PROPOSITION (2 j)', docOtherResp.status === 201 && docOtherResp.data?.basisValidationStatus === 'PROPOSED' && docOtherDays === 2, `basis=${docOtherResp.data?.basisValidationStatus} days=${docOtherDays}`)

  // ── 62. P2 — invalidation d'un document après acquisition : réévaluation ─
  const eDocInv = await empLogin('DOCINV')
  await registerAbsence(eDocInv.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const invDocId = await createVerifiedDocument(eDocInv.id)
  await createMaintenance(eDocInv.id, '2026-07-01', '2026-07-31', 'Document valide.', 'AUTRE', 'Disposition', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31', basisDocumentId: invDocId })
  await runAccrual('2026-07')
  const docInvBefore = await creditedFor(eDocInv.id, '2026-07')
  await conn.query("UPDATE documents SET status='SUPPRIME', deleted_at=NOW() WHERE id=?", [invDocId])
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eDocInv.id, startDate: '2026-07-01', endDate: '2026-07-31' } })
  const docInvNet = await netFor(eDocInv.id, '2026-07')
  rec('S62-DOC-INVALIDATION', 'Document invalidé après acquisition : réévaluation contrôlée (2,5→2)', Math.abs(docInvBefore - 2.5) < 0.01 && Math.abs(docInvNet - 2) < 0.01, `before=${docInvBefore} net=${docInvNet}`)

  // ── 63. P3 — classification retenue strictement validée ────────────────
  const eValKind = await empLogin('VALKIND')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-10', '2026-08-10', 'ENREGISTREE', 1), (?, ?, '2026-08-10', '2026-08-10', 'ENREGISTREE', 1)",
    [eValKind.id, arretMaladie.id, eValKind.id, atMp.id],
  )
  await runAccrual('2026-08')
  const [valAn] = await conn.query(
    "SELECT id FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-08' ORDER BY id DESC LIMIT 1",
    [eValKind.id],
  )
  const valAnId = valAn?.[0]?.id
  const valBadKind = await apiRequest(`/leave-balances/accrual-anomalies/${valAnId}/resolve`, { method: 'POST', token: rhToken, body: { decisionReason: 'Test classification.', retainedKind: 'FOO' } })
  const valNonInvolved = await apiRequest(`/leave-balances/accrual-anomalies/${valAnId}/resolve`, { method: 'POST', token: rhToken, body: { decisionReason: 'Test classification.', retainedKind: 'NON_MEDICAL' } })
  rec('S63-RETAINED-KIND-VALIDE', 'Classification retenue : valeur arbitraire ou hors conflit refusée (400)', valBadKind.status === 400 && valNonInvolved.status === 400, `bad=${valBadKind.status} nonInvolved=${valNonInvolved.status}`)

  // ── 64. P3 — deux conflits distincts, une seule décision RH (scope) ─────
  const eTwoConf = await empLogin('TWOCONF')
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-09-05', '2026-09-05', 'ENREGISTREE', 1), (?, ?, '2026-09-05', '2026-09-05', 'ENREGISTREE', 1), (?, ?, '2026-09-20', '2026-09-20', 'ENREGISTREE', 1), (?, ?, '2026-09-20', '2026-09-20', 'ENREGISTREE', 1)",
    [eTwoConf.id, arretMaladie.id, eTwoConf.id, atMp.id, eTwoConf.id, arretMaladie.id, eTwoConf.id, nonMedical.id],
  )
  await runAccrual('2026-09')
  const [twoAnoms] = await conn.query(
    "SELECT id, conflict_key, status FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-09' ORDER BY conflict_key",
    [eTwoConf.id],
  )
  const twoKeys = twoAnoms.map((a) => a.conflict_key).filter(Boolean)
  const firstAnom = twoAnoms.find((a) => a.conflict_key === twoKeys[0])
  const secondAnom = twoAnoms.find((a) => a.conflict_key !== twoKeys[0])
  const twoRes = await apiRequest(`/leave-balances/accrual-anomalies/${firstAnom.id}/resolve`, { method: 'POST', token: rhToken, body: { decisionReason: 'Le 05/09 : la RH retient l’arrêt maladie.', retainedKind: 'ARRET_MALADIE' } })
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: eTwoConf.id, startDate: '2026-09-01', endDate: '2026-09-30' } })
  const twoNet = await netFor(eTwoConf.id, '2026-09')
  const [secondAfter] = await conn.query('SELECT status, retained_kind FROM accrual_anomalies WHERE id=?', [secondAnom.id])
  rec('S64-DEUX-CONFLITS-SCOPE', 'Deux conflits, une décision sur le premier : le second reste OPEN, aucun droit arbitraire', twoKeys.length === 2 && twoRes.status === 201 && secondAfter?.[0]?.status === 'OPEN' && !secondAfter?.[0]?.retained_kind && Math.abs(twoNet - 2.4) < 0.01, `keys=${twoKeys.length} res=${twoRes.status} second=${secondAfter?.[0]?.status} net=${twoNet}`)

  // ── 65. P3 — séparation téléversement / vérification juridique ────────
  const eBasisFlow = await empLogin('BASISFLOW')
  await registerAbsence(eBasisFlow.id, arretMaladie.id, '2026-07-01', '2026-07-31')
  const uploadedDoc = await uploadBasis('/documents/basis', 'employeeId', eBasisFlow.id)
  const [uploadedRow] = await conn.query('SELECT status, verified_by_rh_id, verified_at FROM documents WHERE id=?', [uploadedDoc.id])
  const decBefore = await createMaintenance(eBasisFlow.id, '2026-07-01', '2026-07-31', 'Clause contractuelle.', 'AUTRE', 'Disposition', { basisValidFrom: '2024-01-01', basisValidTo: '2026-12-31', basisDocumentId: uploadedDoc.id })
  await runAccrual('2026-07')
  const basisBefore = await creditedFor(eBasisFlow.id, '2026-07')
  const validatedDoc = await validateBasis(uploadedDoc.id)
  await apiRequest(`/illness-maintenance/${decBefore.data.id}`, { method: 'PATCH', token: rhToken, body: { basis: 'AUTRE', basisDocumentId: uploadedDoc.id } })
  const basisAfter = await netFor(eBasisFlow.id, '2026-07')
  rec('S65-PARCOURS-DOCUMENT', 'Téléversement (EN ATTENTE, fichier seul non probant) → validation RH justifiée → VALIDATED (2,5)', uploadedRow?.[0]?.status === 'EN_ATTENTE' && !uploadedRow?.[0]?.verified_by_rh_id && decBefore.data?.basisValidationStatus === 'PROPOSED' && basisBefore === 2 && validatedDoc?.status === 'ACCEPTE' && Math.abs(basisAfter - 2.5) < 0.01, `upload=${uploadedRow?.[0]?.status} before=${decBefore.data?.basisValidationStatus}/${basisBefore} after=${basisAfter}`)

  // ── 66. P3 — périmètre RH : refus sur un salarié d'une autre entité ──
  const eOtherEnt = await empLogin('OTHERENT', { legalEntityId: effId })
  const pdfBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  const permForm = new FormData()
  permForm.append('employeeId', String(eOtherEnt.id))
  permForm.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'f.pdf')
  const permRes = await fetch(`${config.API_URL}/documents/basis`, { method: 'POST', headers: { Authorization: `Bearer ${rhToken}` }, body: permForm })
  rec('S66-PERIMETRE-RH', 'RH hors périmètre : téléversement refusé (403) pour un salarié d’une autre entité', permRes.status === 403, `status=${permRes.status}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT JUR-025/037 ACQUISITION : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    process.exitCode = failed ? 1 : 0
  } finally {
    await restoreSharedEntities()
    await conn.end()
  }
}

main().catch((e) => { console.error('ERREUR JUR-025/037 ACQUISITION :', e); process.exit(1) })
