import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('HALF')

async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette HALF3']) } finally { await conn.end() }
}
async function presence(userId, token) {
  const r = await apiRequest(`/users/${userId}`, { token })
  return r.data?.presenceStatus
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') =>
    results.push({ id, priority, module: 'HALF', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment })

  const [adminToken, rhToken, colAToken, respToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')
  const rhId = (await apiRequest('/users/me', { token: rhToken })).data.id

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés HALF3', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi HALF3', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service HALF3', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: true } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 1 } })
  // Backup RH
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: adminToken, body: { validatorId: rhId } })

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
  async function cap(pagePath, file) {
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await navigateViaSidebar(page, pagePath); await page.waitForTimeout(300); await capture(page, file) } catch {}
    if (page) await page.close().catch(() => {})
  }

  const browser = await launch()

  // HALF-033/038 — backup RH + relais par slot
  const r33 = await newRequest(40)
  const r38 = await newRequest(42)
  let absPM
  { const r = await newAbsence(resp.id, 'APRES_MIDI', 'APRES_MIDI'); absPM = r.data; await apiRequest(`/absence-declarations/${absPM.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }) }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); const r = await apiRequest(`/leave-requests/${r33}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); await cap('/app/rh-leaves-absences', 'CAP-HALF-033.png'); push('HALF-033', 'P2', 'Responsable absent APRES_MIDI seulement : relais autorisé l’après-midi', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-HALF-033.png') }
  { const r = await apiRequest(`/leave-requests/${r38}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-038', 'P1', 'Absence journée entière : relais autorisé l’après-midi', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await apiRequest(`/absence-declarations/${absPM.id}/cancel`, { method: 'POST', token: rhToken }) }

  // HALF-041 — nouvelle demande + resp valide après retour
  const r41 = await newRequest(44)
  { const r = await apiRequest(`/leave-requests/${r41}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }); await cap('/app/requests', 'CAP-HALF-041.png'); push('HALF-041', 'P1', 'Le Responsable valide après son retour', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-HALF-041.png') }

  // HALF-055/056 — délai expiré relais
  const r55 = await newRequest(46)
  { const conn = await dbConn(); await conn.execute('UPDATE leave_requests SET submitted_at = ? WHERE id = ?', [new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0,19).replace('T',' '), r55]); await conn.end(); await setSetting('AFTERNOON_START_HOUR', '23:59'); const r = await apiRequest(`/leave-requests/${r55}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-055', 'P2', 'Délai de relais expiré : relais autorisé le matin', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }
  { await setSetting('AFTERNOON_START_HOUR', '00:00'); const r = await apiRequest(`/leave-requests/${r55}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH' } }); push('HALF-056', 'P2', 'Délai de relais expiré : relais autorisé l’après-midi', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`) }

  // HALF-059 — alertes par slot (UI)
  { let page; let ok = false; try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await navigateViaSidebar(page, '/app/alerts'); await page.waitForTimeout(400); await capture(page, 'CAP-HALF-059.png'); ok = true } catch {} if (page) await page.close().catch(() => {}); push('HALF-059', 'P2', 'Responsable consulte les alertes par slot', 'A - UI', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `UI=${ok}`, 'CAP-HALF-059.png') }

  // HALF-060 — refresh présence après slot forcé
  let cid
  { const r = await newAbsence(colA.id, 'MATIN', 'MATIN'); cid = r.data?.id; await apiRequest(`/absence-declarations/${cid}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }); await setSetting('AFTERNOON_START_HOUR', '23:59'); await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken }); const p = await presence(colA.id, rhToken); await cap('/app/rh-leaves-absences', 'CAP-HALF-060.png'); push('HALF-060', 'P1', 'Présence minimale : une absence MATIN ne pénalise que le slot MATIN', 'B - API', p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p}`, 'CAP-HALF-060.png') }

  // HALF-061 — présence minimale validation
  { const r = await newRequest(48); const v = await apiRequest(`/leave-requests/${r}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }); await cap('/app/requests', 'CAP-HALF-061.png'); push('HALF-061', 'P1', 'Le Responsable valide la demande de présence minimale', 'B - API', v.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-HALF-061.png') }

  // CAPs restantes (illustration état final après actions API déjà réalisées)
  const caps = {
    'CAP-HALF-002.png': '/app/rh-summer-period', 'CAP-HALF-003.png': '/app/rh-summer-period', 'CAP-HALF-013.png': '/app/rh-leaves-absences',
    'CAP-HALF-014.png': '/app/rh-leaves-absences', 'CAP-HALF-015.png': '/app/rh-leaves-absences', 'CAP-HALF-016.png': '/app/rh-leaves-absences',
    'CAP-HALF-020.png': '/app/rh-leaves-absences', 'CAP-HALF-026.png': '/app/rh-leaves-absences', 'CAP-HALF-028.png': '/app/rh-leaves-absences',
    'CAP-HALF-030.png': '/app/rh-leaves-absences', 'CAP-HALF-032.png': '/app/requests', 'CAP-HALF-034.png': '/app/rh-leaves-absences',
    'CAP-HALF-036.png': '/app/rh-leaves-absences', 'CAP-HALF-039.png': '/app/rh-leaves-absences', 'CAP-HALF-043.png': '/app/rh-leaves-absences',
    'CAP-HALF-053.png': '/app/rh-leaves-absences', 'CAP-HALF-054.png': '/app/my-requests', 'CAP-HALF-058.png': '/app/rh-leaves-absences',
    'CAP-HALF-062.png': '/app/rh-leaves-absences',
  }
  for (const [file, path] of Object.entries(caps)) { await cap(path, file) }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-half3' })
  console.log('[HALF3] ' + results.length + ' scenarios')
}

run().catch((e) => { console.error(e); process.exit(1) })
