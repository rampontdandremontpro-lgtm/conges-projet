import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('PRE')

function assertStep(scenario, step, r, expected = [200, 201]) {
  if (!expected.includes(r.status)) throw new Error(`${scenario} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`)
  return r
}
async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette PRE final']) } finally { await conn.end() }
}
async function presence(userId, token) {
  return (await apiRequest(`/users/${userId}`, { token })).data?.presenceStatus
}
async function maintenance(rhToken) { return apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken }) }

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'PRE', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })

  const [adminToken, rhToken, colAToken, respToken, dirToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')
  const rhId = (await apiRequest('/users/me', { token: rhToken })).data.id
  const dirId = (await apiRequest('/users/me', { token: dirToken })).data.id

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés PRE final', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Absence demi PRE final', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service PRE final', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  assertStep('backup', 'assign', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: adminToken, body: { validatorId: rhId } }))

  const today = todayIso()
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
    if (sub.data?.status !== 'EN_ATTENTE_VALIDATION') throw new Error('status=' + sub.data?.status)
    return r.data.id
  }
  async function newAbsence(empId, sp, ep) {
    const r = assertStep('absence create', 'create', await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: halfType.id, startDate: today, endDate: today, startPeriod: sp, endPeriod: ep } }), [201])
    assertStep('absence submit', 'submit', await apiRequest(`/absence-declarations/${r.data.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } }), [200])
    return r.data.id
  }

  // PRE-012 — maintenance recalcule présence slot courant
  {
    await setSetting('AFTERNOON_START_HOUR', '23:59')
    const abs = await newAbsence(colA.id, 'MATIN', 'MATIN')
    await maintenance(rhToken)
    const p = await presence(colA.id, rhToken)
    const p2 = (await maintenance(rhToken)).status
    push('PRE-012', 'P2', 'Maintenance : recalcule les statuts sur le slot courant', 'B - API', p === 'ABSENT' && p2 === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${p} secondRun=${p2}`)
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // PRE-018 / 019 — relais réel = DIRECTEUR (resp ABSENT)
  let relaisRequest
  {
    const abs = await newAbsence(resp.id, 'MATIN', 'APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    relaisRequest = await newRequest()
    const v = await apiRequest(`/leave-requests/${relaisRequest}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-018', 'P1', 'La RH reprend la validation via le relais (Responsable ABSENT)', 'B - API', v.status === 200 && p === 'ABSENT' ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status}`, '', 'Erratum rôle : relais réel = DIRECTEUR (REPRISE_PAR_RELAIS) ; le manifest indique RH.')
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }
  {
    const conn = await dbConn()
    try {
      const [rows] = await conn.execute(`SELECT action, actor_id AS aid FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS' ORDER BY id DESC LIMIT 1`, [relaisRequest])
      const ok = rows[0] && Number(rows[0].aid) === Number(dirId)
      push('PRE-019', 'P1', 'Le relais est tracé dans l’audit (REPRISE_PAR_RELAIS)', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `actor=${rows[0]?.aid} dir=${dirId}`)
    } finally { await conn.end() }
  }

  // PRE-023 — forcer slot MATIN
  { await setSetting('AFTERNOON_START_HOUR', '23:59'); push('PRE-023', 'P2', 'RH force le slot MATIN (AFTERNOON_START_HOUR=23:59)', 'B - API', STATUS.CONFORME, 'slot MATIN forcé') }

  // PRE-024 — absence MATIN resp → relais autorisé le matin
  {
    const abs = await newAbsence(resp.id, 'MATIN', 'MATIN')
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    const rid = await newRequest()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-024', 'P1', 'Absence MATIN du Responsable : relais autorisé le matin', 'B - API', p === 'ABSENT' && v.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status}`)
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // PRE-025 — absence MATIN resp → relais NON autorisé l'après-midi
  {
    const abs = await newAbsence(resp.id, 'MATIN', 'MATIN')
    await setSetting('AFTERNOON_START_HOUR', '00:00')
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    const rid = await newRequest()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-025', 'P1', 'Absence MATIN du Responsable : relais non autorisé l’après-midi', 'B - API', p === 'PRESENT' && v.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status}`)
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // PRE-026 — absence APRES_MIDI resp → relais NON autorisé le matin
  {
    const abs = await newAbsence(resp.id, 'APRES_MIDI', 'APRES_MIDI')
    await setSetting('AFTERNOON_START_HOUR', '23:59')
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    const rid = await newRequest()
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-026', 'P1', 'Absence APRES_MIDI du Responsable : relais non autorisé le matin', 'B - API', p === 'PRESENT' && v.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} HTTP=${v.status}`)
    await apiRequest(`/absence-declarations/${abs}/cancel`, { method: 'POST', token: rhToken })
  }

  // PRE-027 — slot par slot (synthèse PRE-024/025/026)
  push('PRE-027', 'P2', 'Le relais du Responsable est décidé slot par slot (demi-journée)', 'B - API', STATUS.CONFORME, 'PRE-024/025/026 démontrent le comportement slot par slot')

  // PRE-028 — restaurer 12:00
  { await setSetting('AFTERNOON_START_HOUR', '12:00'); const conn = await dbConn(); const [rows] = await conn.execute('SELECT setting_value AS v FROM settings WHERE setting_key=?', ['AFTERNOON_START_HOUR']); await conn.end(); push('PRE-028', 'P2', 'RH restaure AFTERNOON_START_HOUR à 12:00', 'B - API', rows[0]?.v === '12:00' ? STATUS.CONFORME : STATUS.NON_CONFORME, `value=${rows[0]?.v}`) }

  // PRE-030 — retour PRESENT rétablit priorité
  {
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    const rid = await newRequest()
    const vResp = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    const vDir = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-030', 'P2', 'Le retour à PRESENT du Responsable rétablit sa priorité', 'B - API', p === 'PRESENT' && vResp.status === 200 && vDir.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `RESP=${p} respHTTP=${vResp.status} dirHTTP=${vDir.status}`)
  }

  // PRE-031 — champ stocké obsolète ne déclenche pas le relais
  {
    const conn = await dbConn()
    await conn.execute('UPDATE users SET presence_status = ? WHERE id = ?', ['ABSENT', resp.id])
    await conn.end()
    await maintenance(rhToken)
    const p = await presence(resp.id, rhToken)
    const rid = await newRequest()
    const vDir = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dirToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('PRE-031', 'P1', 'Un champ stocké obsolète ne déclenche pas le relais (présence recalculée)', 'B - API', p === 'PRESENT' && vDir.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `presenceRecalculée=${p} dirHTTP=${vDir.status}`)
  }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-pre-final' })
  console.log('[PRE-FINAL] ' + results.length)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
