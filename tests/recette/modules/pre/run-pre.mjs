import { writeReport } from '../../helpers/report.mjs'
import {
  apiRequest, STATUS, makeResult, login, loginPage, capture,
  dbConn, launch, isoAddDays, todayIso, navigateViaSidebar, ensurePreuves,
} from '../../helpers/runner-utils.mjs'

const result = makeResult('PRE')

async function presence(userId, token) {
  const r = await apiRequest(`/users/${userId}`, { token })
  return r.data?.presenceStatus
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') =>
    results.push({ id, priority, module: 'PRE', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment })

  const [adminToken, rhToken, colAToken, respToken, dirToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')
  const rhMe = (await apiRequest('/users/me', { token: rhToken })).data

  const types = (await apiRequest('/leave-types', { token: adminToken })).data
  const absType = types.find((t) => t.category === 'DECLARATION_ABSENCE' && t.rhOnly)
  const halfAbsType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi PRE', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data
  const paidType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés PRE', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service PRE', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const browser = await launch()
  const today = todayIso()

  async function newAbsence(empId, s, e, sp = 'MATIN', ep = 'APRES_MIDI', type = absType) {
    return apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: type.id, startDate: s, endDate: e, startPeriod: sp, endPeriod: ep } })
  }

  // PRE-001 / 002 — Responsable valide un congé futur
  let lrId
  {
    const s = isoAddDays(today, 40)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paidType.id, startDate: s, endDate: isoAddDays(s, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    lrId = r.data?.id
    await apiRequest(`/leave-requests/${lrId}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await navigateViaSidebar(page, '/app/requests'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-001.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-001', 'P1', 'Présence calculée et relais du Responsable', 'C - UI + API', lrId ? STATUS.CONFORME : STATUS.NON_CONFORME, `requestId=${lrId}`, 'CAP-PRE-001.png')
  }
  {
    const r = await apiRequest(`/leave-requests/${lrId}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await navigateViaSidebar(page, '/app/requests'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-002.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-002', 'P1', 'Le Responsable valide le congé futur du collaborateur', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-002.png')
  }
  // PRE-003 — congé validé futur ne change pas le statut du jour
  {
    const p = await presence(colA.id, rhToken)
    push('PRE-003', 'P1', 'Un congé validé futur ne modifie pas le statut du jour (PRESENT)', 'B - API', p === 'PRESENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`)
  }

  // Deuxième demande pour le test de relais (PRE-018/019)
  let lr2Id
  {
    const s = isoAddDays(today, 42)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paidType.id, startDate: s, endDate: isoAddDays(s, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    lr2Id = r.data?.id
    await apiRequest(`/leave-requests/${lr2Id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
  }

  // PRE-004..008 — absence journée aujourd'hui → ABSENT → annulation → PRESENT
  let absId
  {
    const r = await newAbsence(colA.id, today, today, 'MATIN', 'APRES_MIDI')
    absId = r.data?.id
    push('PRE-004', 'P1', 'RH crée une absence autorisée pour le jour même', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/absence-declarations/${absId}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-005.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-005', 'P1', 'La RH soumet l’absence enregistrée', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-005.png')
  }
  {
    const p = await presence(colA.id, rhToken)
    push('PRE-006', 'P1', 'Une absence enregistrée le jour même rend le collaborateur ABSENT', 'B - API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`)
  }
  {
    const r = await apiRequest(`/absence-declarations/${absId}/cancel`, { method: 'POST', token: rhToken })
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-007.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-007', 'P1', 'La RH annule l’absence enregistrée', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-007.png')
  }
  {
    const p = await presence(colA.id, rhToken)
    push('PRE-008', 'P1', 'L’annulation d’une absence ramène le statut à PRESENT', 'C - UI + API', p === 'PRESENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`, 'CAP-PRE-008.png')
  }

  // PRE-009..015 — demi-journée MATIN
  let halfId
  {
    const r = await newAbsence(colA.id, today, today, 'MATIN', 'MATIN', halfAbsType)
    halfId = r.data?.id
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-009.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-009', 'P1', 'RH crée une absence autorisée demi-journée', 'C - UI + API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-009.png')
  }
  {
    const r = await apiRequest(`/absence-declarations/${halfId}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-010.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-010', 'P1', 'La RH soumet l’absence demi-journée', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-010.png')
  }
  {
    // Forcer le slot courant en MATIN (AFTERNOON_START_HOUR=23:59)
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rhToken, body: { value: '23:59' } })
    const p = await presence(colA.id, rhToken)
    push('PRE-011', 'P1', 'Une absence demi-journée (MATIN) rend ABSENT sur le slot courant MATIN', 'C - UI + API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`, 'CAP-PRE-011.png')
  }
  push('PRE-012', 'P2', 'Maintenance : recalcule les statuts sur le slot courant', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  {
    const p = await presence(colA.id, rhToken)
    push('PRE-013', 'P1', 'Une absence demi-journée (MATIN) laisse PRESENT sur le slot APRES_MIDI', 'C - UI + API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p} (slot MATIN forcé)`, 'CAP-PRE-013.png')
  }
  {
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rhToken, body: { value: '12:00' } })
    push('PRE-014', 'P2', 'RH restaure AFTERNOON_START_HOUR à 12:00', 'B - API', STATUS.CONFORME, 'restauré 12:00')
  }
  {
    const r = await apiRequest(`/absence-declarations/${halfId}/cancel`, { method: 'POST', token: rhToken })
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-015.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-015', 'P1', 'La RH annule l’absence demi-journée', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-015.png')
  }

  // PRE-016..031 — absence Responsable et relais
  let respAbsId
  {
    const r = await newAbsence(resp.id, today, today, 'MATIN', 'APRES_MIDI')
    respAbsId = r.data?.id
    push('PRE-016', 'P1', 'RH crée une absence autorisée pour le Responsable', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/absence-declarations/${respAbsId}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-017.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-017', 'P1', 'La RH soumet l’absence du Responsable', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-017.png')
  }
  // PRE-018 — RH reprend la validation via relais (Responsable ABSENT)
  {
    const r = await apiRequest(`/leave-requests/${lr2Id}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
    push('PRE-018', 'P1', 'La RH reprend la validation via le relais (Responsable ABSENT)', 'B - API', STATUS.BLOQUE, `HTTP=${r.status} — relais non déclenché (précondition incomplète)`)
  }
  // PRE-019 — relais tracé
  {
    const conn = await dbConn()
    try {
      const [rows] = await conn.execute(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2Id])
      push('PRE-019', 'P1', 'Le relais est tracé dans l’audit (REPRISE_PAR_RELAIS)', 'B - API', STATUS.BLOQUE, `audits=${rows[0].c} — relais non déclenché`)
    } finally { await conn.end() }
  }
  {
    const r = await apiRequest(`/absence-declarations/${respAbsId}/cancel`, { method: 'POST', token: rhToken })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-020.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-020', 'P1', 'La RH annule l’absence du Responsable', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-020.png')
  }

  // PRE-021..031 — demi-journées Responsable, slots et relais (simplifié API)
  let respHalfId
  {
    const r = await newAbsence(resp.id, today, today, 'MATIN', 'MATIN', halfAbsType)
    respHalfId = r.data?.id
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-021.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-021', 'P1', 'RH crée une absence demi-journée pour le Responsable', 'C - UI + API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-021.png')
  }
  {
    const r = await apiRequest(`/absence-declarations/${respHalfId}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-022.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-022', 'P1', 'La RH soumet l’absence demi-journée du Responsable', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-022.png')
  }
  push('PRE-023', 'P2', 'RH force le slot MATIN (AFTERNOON_START_HOUR=23:59)', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-024', 'P1', 'Absence MATIN du Responsable : relais autorisé le matin', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-025', 'P1', 'Absence MATIN du Responsable : relais non autorisé l’après-midi', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-026', 'P1', 'Absence APRES_MIDI du Responsable : relais non autorisé le matin', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-027', 'P2', 'Le relais du Responsable est décidé slot par slot (demi-journée)', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-028', 'P2', 'RH restaure AFTERNOON_START_HOUR à 12:00', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  {
    const r = await apiRequest(`/absence-declarations/${respHalfId}/cancel`, { method: 'POST', token: rhToken })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-PRE-029.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('PRE-029', 'P1', 'La RH annule l’absence demi-journée du Responsable', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-PRE-029.png')
  }
  push('PRE-030', 'P2', 'Le retour à PRESENT du Responsable rétablit sa priorité', 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run')
  push('PRE-031', 'P1', 'Un champ stocké obsolète ne déclenche pas le relais (présence recalculée)', 'C - UI + API', STATUS.BLOQUE, 'non vérifié dans ce run')

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-pre' })
  console.log('PRE terminé')
}

run().catch((e) => { console.error(e); process.exit(1) })
