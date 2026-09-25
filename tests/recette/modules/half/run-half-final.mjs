import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('HALF')

function assertStep(scenario, step, r, expected = [200, 201]) {
  if (!expected.includes(r.status)) {
    throw new Error(`${scenario} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`)
  }
  return r
}
async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette HALF final']) } finally { await conn.end() }
}
async function presence(userId, token) {
  return (await apiRequest(`/users/${userId}`, { token })).data?.presenceStatus
}
async function capAs(browser, email, path, file) {
  let page
  try { page = await loginPage(browser, email); await navigateViaSidebar(page, path); await page.waitForTimeout(300); await capture(page, file) } catch {}
  if (page) await page.close().catch(() => {})
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
    name: 'Congés payés HALF final', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi HALF final', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data
  const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence heures HALF final', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service HALF final', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: true } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 1 } })
  const backup = assertStep('backup', 'assign', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: adminToken, body: { validatorId: rhId } }), [201, 200])

  const today = todayIso()
  const browser = await launch()
  let off = 40
  function nextWindow() {
    for (let i = 0; i < 300; i += 1) {
      const s = isoAddDays(today, off); const e = isoAddDays(s, 1)
      if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) { off += 3; return [s, e] }
      off += 1
    }
    throw new Error('no window')
  }
  async function newRequest() {
    const [s, e] = nextWindow()
    const r = assertStep('create', 'create', await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }), [201])
    const sub = assertStep('submit', 'submit', await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } }), [200])
    if (sub.data?.status !== 'EN_ATTENTE_VALIDATION') throw new Error('submit status=' + sub.data?.status)
    return r.data.id
  }
  async function newAbsence(empId, sp, ep) {
    const r = assertStep('absence create', 'create', await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: halfType.id, startDate: today, endDate: today, startPeriod: sp, endPeriod: ep } }), [201])
    const s = assertStep('absence submit', 'submit', await apiRequest(`/absence-declarations/${r.data.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }), [200])
    return r.data.id
  }

  // HALF-033 — APRES_MIDI, backup RH
  {
    const rid = await newRequest()
    const abs = await newAbsence(resp.id, 'APRES_MIDI', 'APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const p = await presence(resp.id, rhToken)
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    await capAs(browser, 'rh.recette@gmes.fr', '/app/rh-leaves-absences', 'CAP-HALF-033.png')
    push('HALF-033', 'P2', 'Responsable absent APRES_MIDI seulement : relais autorisé l’après-midi', 'C - UI + API', v.status === 200 && p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p} HTTP=${v.status}`, 'CAP-HALF-033.png', '', JSON.stringify(v.data?.message ?? ''))
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // HALF-038 — journée entière, backup RH après-midi
  {
    const rid = await newRequest()
    const abs = await newAbsence(resp.id, 'MATIN', 'APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const p = await presence(resp.id, rhToken)
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    push('HALF-038', 'P1', 'Absence journée entière : relais autorisé l’après-midi', 'C - UI + API', v.status === 200 && p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p} HTTP=${v.status}`, '', '', JSON.stringify(v.data?.message ?? ''))
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // HALF-041 — Responsable présent valide
  {
    const rid = await newRequest()
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR', minimumPresenceJustification: 'Justification recette.' } })
    await capAs(browser, 'responsable.recette@gmes.fr', '/app/requests', 'CAP-HALF-041.png')
    push('HALF-041', 'P1', 'Le Responsable valide après son retour', 'C - UI + API', v.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, 'CAP-HALF-041.png', '', JSON.stringify(v.data?.message ?? ''))
  }

  // HALF-055 / 056 — délai expiré
  {
    const rid = await newRequest()
    const conn = await dbConn()
    await conn.execute('UPDATE leave_requests SET submitted_at = ? WHERE id = ?', [new Date(Date.now() - 2*24*3600*1000).toISOString().slice(0,19).replace('T',' '), rid])
    await conn.end()
    await setSetting('AFTERNOON_START_HOUR', '23:59')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    push('HALF-055', 'P2', 'Délai de relais expiré : relais autorisé le matin', 'B - API', v.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, '', '', JSON.stringify(v.data?.message ?? ''))
  }
  {
    const rid = await newRequest()
    const conn = await dbConn()
    await conn.execute('UPDATE leave_requests SET submitted_at = ? WHERE id = ?', [new Date(Date.now() - 2*24*3600*1000).toISOString().slice(0,19).replace('T',' '), rid])
    await conn.end()
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    push('HALF-056', 'P2', 'Délai de relais expiré : relais autorisé l’après-midi', 'B - API', v.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${v.status}`, '', '', JSON.stringify(v.data?.message ?? ''))
  }

  // HALF-061 — présence minimale
  {
    const abs = await newAbsence(colA.id, 'MATIN', 'MATIN')
    await setSetting('AFTERNOON_START_HOUR', '23:59')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    const p = await presence(colA.id, rhToken)
    const rid = await newRequest()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR', minimumPresenceJustification: 'Justification recette HALF-061.' } })
    await capAs(browser, 'responsable.recette@gmes.fr', '/app/requests', 'CAP-HALF-061.png')
    push('HALF-061', 'P1', 'Le Responsable valide la demande de présence minimale', 'C - UI + API', v.status === 200 && p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p} HTTP=${v.status}`, 'CAP-HALF-061.png', '', JSON.stringify(v.data?.message ?? ''))
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // ANO-015 retest indépendant
  {
    const s = isoAddDays(today, 80)
    const A = assertStep('HALF-018', 'create A', await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: s, endDate: s, durationHours: 4 } }), [201])
    const before = (await apiRequest(`/absence-declarations/${A.data.id}`, { token: rhToken })).data
    const p18 = await apiRequest(`/absence-declarations/${A.data.id}`, { method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN' } })
    const after18 = (await apiRequest(`/absence-declarations/${A.data.id}`, { token: rhToken })).data
    const ok18 = p18.status === 400 && before.durationHours === after18.durationHours && before.startPeriod === after18.startPeriod
    push('HALF-018', 'P1', 'PATCH brouillon heures + startPeriod refusé', 'B - API', ok18 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${p18.status} durationHours ${before.durationHours}→${after18.durationHours}`)
  }
  {
    const s2 = isoAddDays(today, 82)
    const B = assertStep('HALF-022', 'create B', await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: s2, endDate: s2, durationHours: 3 } }), [201])
    const before = (await apiRequest(`/absence-declarations/${B.data.id}`, { token: rhToken })).data
    const p21 = await apiRequest(`/absence-declarations/${B.data.id}`, { method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN', endPeriod: 'MATIN' } })
    const after = (await apiRequest(`/absence-declarations/${B.data.id}`, { token: rhToken })).data
    const ok22 = before.durationHours === 3 && after.durationHours === 3
    push('HALF-022', 'P2', 'HEURES → DEMI-JOURNÉE : resté en heures', 'B - API', ok22 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${p21.status} durationHours ${before.durationHours}→${after.durationHours}`)
  }

  await capAs(browser, 'responsable.recette@gmes.fr', '/app/requests', 'CAP-HALF-032.png')
  await capAs(browser, 'col-a.recette@gmes.fr', '/app/my-requests', 'CAP-HALF-054.png')
  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-half-final' })
  console.log('[HALF-FINAL] ' + results.length)
}

run().catch((e) => { console.error('FINAL ERR', e.message); process.exit(1) })
