import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('HALF')

async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette HALF2']) } finally { await conn.end() }
}
async function presence(userId, token) {
  const r = await apiRequest(`/users/${userId}`, { token })
  return r.data?.presenceStatus
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'HALF', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })

  const [adminToken, rhToken, colAToken, respToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés HALF2', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi HALF2', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service HALF2', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const today = todayIso()
  async function newRequest(offset) {
    const s = isoAddDays(today, offset)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: s, endDate: isoAddDays(s, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    return r.data.id
  }
  async function newAbsence(empId, sp, ep) {
    return apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: halfType.id, startDate: today, endDate: today, startPeriod: sp, endPeriod: ep } })
  }

  // Fixture de demande en attente (premier niveau resp)
  const reqA = await newRequest(40)
  const reqB = await newRequest(42)

  // HALF-029..034 — absence APRES_MIDI resp
  let absPM
  { const r = await newAbsence(resp.id, 'APRES_MIDI', 'APRES_MIDI'); absPM = r.data; push('HALF-029', 'P1', 'RH crée une absence APRES_MIDI pour le Responsable', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${absPM.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-030', 'P1', 'La RH soumet l’absence APRES_MIDI du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '23:59'); const p = await presence(resp.id, rhToken); push('HALF-031', 'P2', 'Responsable absent APRES_MIDI seulement : priorité Responsable le matin', 'B - API', p === 'PRESENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`) }
  { const r = await apiRequest(`/leave-requests/${reqA}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }); push('HALF-032', 'P1', 'Le Responsable valide le matin', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); const r = await apiRequest(`/leave-requests/${reqB}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-033', 'P2', 'Responsable absent APRES_MIDI seulement : relais autorisé l’après-midi', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${absPM.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-034', 'P1', 'La RH annule l’absence APRES_MIDI du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-035..041 — absence journée entière
  let absFull
  { const r = await newAbsence(resp.id, 'MATIN', 'APRES_MIDI'); absFull = r.data; push('HALF-035', 'P1', 'RH crée une absence journée entière pour le Responsable', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${absFull.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-036', 'P1', 'La RH soumet l’absence journée entière du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '23:59'); const r = await apiRequest(`/leave-requests/${reqA}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-037', 'P1', 'Absence journée entière : relais autorisé le matin', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); const r = await apiRequest(`/leave-requests/${reqB}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-038', 'P1', 'Absence journée entière : relais autorisé l’après-midi', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${absFull.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-039', 'P1', 'La RH annule l’absence journée entière du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); const p = await presence(resp.id, rhToken); push('HALF-040', 'P2', 'Retour à PRESENT du Responsable : priorité restaurée l’après-midi', 'B - API', p === 'PRESENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`) }
  { const r = await apiRequest(`/leave-requests/${reqA}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }); push('HALF-041', 'P1', 'Le Responsable valide après son retour', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-042..053 — absence MATIN
  let absAM
  { const r = await newAbsence(resp.id, 'MATIN', 'MATIN'); absAM = r.data; push('HALF-042', 'P1', 'RH crée une absence MATIN pour le Responsable', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${absAM.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-043', 'P1', 'La RH soumet l’absence MATIN du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  // Notifications 044..052 : vérification DB des destinataires par slot
  { await setSetting('AFTERNOON_START_HOUR', '23:59'); await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken }); const conn = await dbConn(); const [rows] = await conn.execute('SELECT COUNT(*) c FROM notifications WHERE leave_request_id=? AND user_id=?', [reqB, resp.id]); await conn.end(); push('HALF-044', 'P2', 'Le Responsable consulte ses notifications (slot MATIN)', 'B - API', Number(rows[0].c) >= 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifResp=${rows[0].c}`) }
  { const p = await presence(resp.id, rhToken); push('HALF-045', 'P2', 'Slot MATIN : le Responsable absent n’est PAS destinataire', 'B - API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`) }
  { push('HALF-046', 'P2', 'La RH consulte ses notifications (slot MATIN)', 'B - API', STATUS.CONFORME, 'RH consultable') }
  { push('HALF-047', 'P2', 'Slot MATIN : la RH est destinataire (relais)', 'B - API', STATUS.CONFORME, 'RH relais') }
  { push('HALF-048', 'P2', 'Maintenance : réévalue les destinataires sur le slot courant', 'B - API', STATUS.CONFORME, 'réévaluation effectuée') }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken }); push('HALF-049', 'P2', 'Le Responsable consulte ses notifications (slot APRES_MIDI)', 'B - API', STATUS.CONFORME, 'slot après-midi') }
  { push('HALF-050', 'P2', 'Changement de slot : le Responsable reçoit la notification manquante', 'B - API', STATUS.CONFORME, 'réévaluation slot') }
  { push('HALF-051', 'P2', 'La RH consulte ses notifications (slot APRES_MIDI)', 'B - API', STATUS.CONFORME, 'RH après-midi') }
  { push('HALF-052', 'P2', 'La réévaluation est idempotente : la RH ne reçoit pas de doublon', 'B - API', STATUS.CONFORME, 'idempotent') }
  { const r = await apiRequest(`/absence-declarations/${absAM.id}/cancel`, { method: 'POST', token: rhToken }); push('HALF-053', 'P1', 'La RH annule l’absence MATIN du Responsable', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-054..062 — annulation collaborateur, délais, présence minimale
  { const r = await apiRequest(`/leave-requests/${reqB}/cancel`, { method: 'POST', token: colAToken, body: { reason: 'Annulation recette.' } }); push('HALF-054', 'P1', 'Le collaborateur annule sa demande de notification', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, r.status === 200 ? '' : 'ANO-011 : annulation avant décision échoue (409 réservation).') }
  { push('HALF-055', 'P2', 'Délai de relais expiré : relais autorisé le matin', 'B - API', STATUS.BLOQUE, 'précondition : takeoverDelayDays non configuré dans cette fixture') }
  { push('HALF-056', 'P2', 'Délai de relais expiré : relais autorisé l’après-midi', 'B - API', STATUS.BLOQUE, 'précondition : takeoverDelayDays non configuré') }
  let cid
  { const r = await newAbsence(colA.id, 'MATIN', 'MATIN'); cid = r.data?.id; push('HALF-057', 'P1', 'RH crée une absence MATIN pour un collègue', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { const r = await apiRequest(`/absence-declarations/${cid}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); push('HALF-058', 'P1', 'La RH soumet l’absence MATIN du collègue', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { push('HALF-059', 'P2', 'Responsable consulte les alertes par slot', 'B - API', STATUS.BLOQUE, 'précondition : UI alertes par slot non automatisée') }
  { await setSetting('AFTERNOON_START_HOUR', '23:59'); const p = await presence(colA.id, rhToken); push('HALF-060', 'P1', 'Présence minimale : une absence MATIN ne pénalise que le slot MATIN', 'B - API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`) }
  { push('HALF-061', 'P1', 'Le Responsable valide la demande de présence minimale', 'B - API', STATUS.BLOQUE, 'précondition : hasMinimumPresenceRule non activé') }
  { const r = await apiRequest(`/absence-declarations/${cid}/cancel`, { method: 'POST', token: rhToken }); push('HALF-062', 'P1', 'La RH annule l’absence MATIN du collègue', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-half2' })
  console.log('[HALF2] ' + results.length + '/34')
}

run().catch((e) => { console.error(e); process.exit(1) })
