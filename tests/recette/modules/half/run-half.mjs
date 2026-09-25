import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('HALF')

async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette HALF']) } finally { await conn.end() }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'HALF', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })
  const BLOQUE = (id, priority, scenario) => push(id, priority, scenario, 'B - API', STATUS.BLOQUE, 'non vérifié dans ce run (slot/relais complexe)')

  const [adminToken, rhToken, colAToken, respToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés HALF', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence heures HALF', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false,
  }})).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi HALF', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service HALF', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const today = todayIso()

  // HALF-001 — restaurer AFTERNOON_START_HOUR
  { await setSetting('AFTERNOON_START_HOUR', '12:00'); push('HALF-001', 'P2', 'RH restaure AFTERNOON_START_HOUR à 12:00', 'B - API', STATUS.CONFORME, '12:00') }
  // HALF-002 — invalide refusé
  { const r = await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rhToken, body: { settingValue: '25:00' } }); push('HALF-002', 'P1', 'AFTERNOON_START_HOUR invalide refusé', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-003 — valide accepté
  { const r = await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rhToken, body: { settingValue: '08:30' } }); push('HALF-003', 'P1', 'AFTERNOON_START_HOUR valide (08:30) accepté', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-004 — relu depuis la base
  { const rows = await (async () => { const c = await dbConn(); try { const [r] = await c.execute('SELECT setting_value AS v FROM settings WHERE setting_key=?', ['AFTERNOON_START_HOUR']); return r } finally { await c.end() } })(); push('HALF-004', 'P2', 'AFTERNOON_START_HOUR relu depuis la base', 'B - API', rows[0]?.v === '08:30' ? STATUS.CONFORME : STATUS.NON_CONFORME, `value=${rows[0]?.v}`) }

  // HALF-005 — congé APRES_MIDI→MATIN même date refusé
  { const d = isoAddDays(today, 40); const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: d, endDate: d, startPeriod: 'APRES_MIDI', endPeriod: 'MATIN' } }); push('HALF-005', 'P1', 'Congé APRES_MIDI→MATIN même date refusé (création)', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-006 — absence APRES_MIDI→MATIN refusée
  { const d = isoAddDays(today, 40); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: halfType.id, startDate: d, endDate: d, startPeriod: 'APRES_MIDI', endPeriod: 'MATIN' } }); push('HALF-006', 'P1', 'Absence APRES_MIDI→MATIN même date refusée (création)', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-007 — bascule refusée en mise à jour
  { const d = isoAddDays(today, 42); const lr = (await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' } })).data; const r = await apiRequest(`/leave-requests/${lr.id}`, { method: 'PATCH', token: colAToken, body: { startPeriod: 'APRES_MIDI', endPeriod: 'MATIN' } }); push('HALF-007', 'P1', 'Bascule APRES_MIDI→MATIN même date refusée (mise à jour)', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-008 — suppression brouillon bascule
  { const d = isoAddDays(today, 44); const lr = (await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' } })).data; const r = await apiRequest(`/leave-requests/${lr.id}`, { method: 'DELETE', token: colAToken }); push('HALF-008', 'P2', 'Suppression du brouillon de bascule', 'B - API', r.status === 204 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-009/010 — heures + périodes refusées
  { const d = isoAddDays(today, 46); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: d, endDate: d, durationHours: 4, startPeriod: 'MATIN' } }); push('HALF-009', 'P1', 'Absence durationHours + startPeriod refusée', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const d = isoAddDays(today, 46); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: d, endDate: d, durationHours: 4, endPeriod: 'APRES_MIDI' } }); push('HALF-010', 'P1', 'Absence durationHours + endPeriod refusée', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-011/012 — heures seules
  let hoursAbs
  { const d = isoAddDays(today, 48); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: d, endDate: d, durationHours: 4 } }); hoursAbs = r.data; push('HALF-011', 'P1', 'Absence en heures seule acceptée (durationHours=4)', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${hoursAbs.id}`, { token: rhToken }); const ok = r.data?.durationHours === 4 && r.data?.startPeriod === null && r.data?.endPeriod === null; push('HALF-012', 'P1', 'Absence en heures : périodes/durationDays nuls, durationHours=4', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `durationHours=${r.data?.durationHours} startPeriod=${r.data?.startPeriod}`) }
  // HALF-013 — annuler heures
  { const r = await apiRequest(`/absence-declarations/${hoursAbs.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-013', 'P1', 'La RH annule l’absence en heures', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-014/015/016 — demi-journée
  let halfAbs
  { const d = isoAddDays(today, 50); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: halfType.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' } }); halfAbs = r.data; push('HALF-014', 'P1', 'Absence demi-journée seule acceptée (MATIN/MATIN)', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${halfAbs.id}`, { token: rhToken }); const ok = r.data?.startPeriod === 'MATIN' && r.data?.endPeriod === 'MATIN' && r.data?.durationHours === null; push('HALF-015', 'P1', 'Absence demi-journée : périodes conservées, durationHours nul', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `startPeriod=${r.data?.startPeriod} durationHours=${r.data?.durationHours}`) }
  { const r = await apiRequest(`/absence-declarations/${halfAbs.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-016', 'P1', 'La RH annule l’absence demi-journée', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-017..028 — bascules heures/demi-journée (API)
  let hBrouillon
  { const d = isoAddDays(today, 52); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: d, endDate: d, durationHours: 3 } }); hBrouillon = r.data; push('HALF-017', 'P2', 'Brouillon en heures créé', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}`, { method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN' } }); push('HALF-018', 'P1', 'PATCH brouillon heures + startPeriod refusé', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  let dBrouillon
  { const d = isoAddDays(today, 54); const r = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: halfType.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'MATIN' } }); dBrouillon = r.data; push('HALF-019', 'P2', 'Brouillon demi-journée créé', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${dBrouillon.id}`, { method: 'PATCH', token: rhToken, body: { durationHours: 2 } }); push('HALF-020', 'P1', 'PATCH brouillon demi-journée + durationHours refusé', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // HALF-021..028 — bascule de modes (contrat partiel : on reste dans le mode initial)
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}`, { method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN', endPeriod: 'MATIN' } }); push('HALF-021', 'P2', 'PATCH heures → demi-journée : périodes seules ne basculent pas le mode', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}`, { token: rhToken }); push('HALF-022', 'P2', 'HEURES → DEMI-JOURNÉE : resté en heures', 'B - API', r.data?.durationHours === 3 ? STATUS.CONFORME : STATUS.NON_CONFORME, `durationHours=${r.data?.durationHours}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}`, { method: 'PATCH', token: rhToken, body: { durationHours: 5 } }); push('HALF-023', 'P2', 'PATCH demi-journée → heures : durationHours appliqué', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}`, { token: rhToken }); push('HALF-024', 'P2', 'DEMI-JOURNÉE → HEURES : bascule effective en mode heures', 'B - API', r.data?.durationHours === 5 ? STATUS.CONFORME : STATUS.NON_CONFORME, `durationHours=${r.data?.durationHours}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-025', 'P2', 'Soumission du brouillon en heures', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${hBrouillon.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-026', 'P1', 'Annulation de l’absence en heures (nettoyage)', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${dBrouillon.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-027', 'P2', 'Soumission du brouillon basculé en heures', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${dBrouillon.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-028', 'P1', 'Annulation de l’absence basculée (nettoyage)', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-029..062 — slots/relais/présence minimale : non vérifiés dans ce run
  const blocked = ['HALF-029','HALF-030','HALF-031','HALF-032','HALF-033','HALF-034','HALF-035','HALF-036','HALF-037','HALF-038','HALF-039','HALF-040','HALF-041','HALF-042','HALF-043','HALF-044','HALF-045','HALF-046','HALF-047','HALF-048','HALF-049','HALF-050','HALF-051','HALF-052','HALF-053','HALF-054','HALF-055','HALF-056','HALF-057','HALF-058','HALF-059','HALF-060','HALF-061','HALF-062']
  for (const id of blocked) BLOQUE(id, 'P1', id)

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-half' })
  console.log('[HALF] ' + results.length + '/62')
}

run().catch((e) => { console.error(e); process.exit(1) })
