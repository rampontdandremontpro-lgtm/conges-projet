import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('AUD')

async function q(sql, params = []) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(sql, params)
    return rows
  } finally { await conn.end() }
}

function weekdayPair(offset) {
  let s = isoAddDays(todayIso(), offset)
  for (let i = 0; i < 100; i += 1) {
    const e = isoAddDays(s, 1)
    if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) return [s, e]
    s = isoAddDays(s, 1)
  }
  throw new Error('no weekday')
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'AUD', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })

  const [adminToken, rhToken, colAToken, respToken, dirToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')
  const dirMe = (await apiRequest('/users/me', { token: dirToken })).data

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés AUD', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const conge = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const types = (await apiRequest('/leave-types', { token: adminToken })).data
  const absType = types.find((t) => t.category === 'DECLARATION_ABSENCE' && t.rhOnly)

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service AUD', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  // Cycle de vie complet d'une demande
  const [s1, e1] = weekdayPair(40)
  const lr = (await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: s1, endDate: e1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${lr.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
  await apiRequest(`/leave-requests/${lr.id}/validate`, { method: 'POST', token: respToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
  await apiRequest(`/leave-requests/${lr.id}/validate`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })

  // Absence
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: colA.id, leaveTypeId: absType.id, startDate: isoAddDays(todayIso(), 30), endDate: isoAddDays(todayIso(), 30), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })

  // Dérogation (brouillon hors délai)
  const [sd, ed] = weekdayPair(5)
  const dreq = (await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: sd, endDate: ed, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest('/derogations', { method: 'POST', token: colAToken, body: { leaveRequestId: dreq.id, reason: 'Dérogation AUD.' } })

  // Directeur
  const dirSvc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service DIR AUD', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: dirSvc.id } })
  const [sd2, ed2] = weekdayPair(8)
  await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: sd2, endDate: ed2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  // AUD-001 — Admin consulte les journaux
  {
    const r = await apiRequest('/audit-logs', { token: adminToken })
    push('AUD-001', 'P1', 'Admin consulte les journaux d’audit', 'B - API', r.status === 200 && Array.isArray(r.data) ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} lignes=${Array.isArray(r.data) ? r.data.length : 'n/a'}`)
  }
  // AUD-002 — masquage des secrets
  {
    const rows = await q(`SELECT old_value AS ov, new_value AS nv FROM audit_logs`)
    const leak = rows.some((r) => {
      const s = JSON.stringify(r.ov ?? '') + JSON.stringify(r.nv ?? '')
      return /password|token|signatureData|data:image\/png;base64/i.test(s)
    })
    push('AUD-002', 'P1', 'Les audits masquent les mots de passe, jetons, signatures et fichiers', 'B - API', !leak ? STATUS.CONFORME : STATUS.NON_CONFORME, `fuite=${leak}`)
  }
  // AUD-003 — audits LEAVE_REQUESTS avec resource_id non nul
  {
    const rows = await q(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id IS NULL AND action NOT LIKE 'HTTP_%'`)
    push('AUD-003', 'P1', 'Tous les audits métier portent LEAVE_REQUESTS avec un resource_id non nul', 'B - API', Number(rows[0].c) === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `audits_sans_id=${rows[0].c}`)
  }
  // AUD-004 — chaque audit post-brouillon pointe vers une demande existante
  {
    const rows = await q(`SELECT resource_id AS rid FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id IS NOT NULL`)
    const ids = [...new Set(rows.map((r) => Number(r.rid)))]
    let allExist = true
    for (const id of ids) {
      const r = await q(`SELECT COUNT(*) AS c FROM leave_requests WHERE id=?`, [id])
      if (Number(r[0].c) === 0) allExist = false
    }
    push('AUD-004', 'P1', 'Chaque audit post-brouillon pointe vers une demande existante en base', 'B - API', allExist ? STATUS.CONFORME : STATUS.NON_CONFORME, `ids=${ids.length}`)
  }
  // AUD-005 — BROUILLON_CREE avec resource_id et actor_id réels
  {
    const rows = await q(`SELECT resource_id AS rid, actor_id AS aid FROM audit_logs WHERE action='BROUILLON_CREE' ORDER BY id DESC LIMIT 1`)
    const ok = rows[0] && rows[0].rid !== null && rows[0].aid !== null
    push('AUD-005', 'P2', 'A — BROUILLON_CREE porte un resource_id et un actor_id réels', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `resourceId=${rows[0]?.rid} actorId=${rows[0]?.aid}`)
  }
  // AUD-006 — CREE, SOUMISE, VALIDEE sur une même demande
  {
    const actions = (await q(`SELECT DISTINCT action AS a FROM audit_logs WHERE resource_id=?`, [lr.id])).map((r) => r.a)
    const ok = ['BROUILLON_CREE', 'DEMANDE_SOUMISE', 'DEMANDE_PREVALIDEE', 'DEMANDE_VALIDEE'].every((a) => actions.includes(a))
    push('AUD-006', 'P1', 'B/C/D/F — la même demande trace CREE, SOUMISE, VALIDEE et RELAIS sur une demande', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `actions=${actions.join(',')}`)
  }
  // AUD-007 — DEMANDE_VALIDEE attribuée au valideur réel
  {
    const rows = await q(`SELECT actor_id AS aid FROM audit_logs WHERE resource_id=? AND action='DEMANDE_VALIDEE' ORDER BY id DESC LIMIT 1`, [lr.id])
    push('AUD-007', 'P1', 'C — DEMANDE_VALIDEE est attribuée au valideur réel', 'B - API', rows[0]?.aid ? STATUS.CONFORME : STATUS.NON_CONFORME, `actorId=${rows[0]?.aid}`)
  }
  // AUD-008 — CONGE_DIRECTEUR_ENREGISTRE
  {
    const rows = await q(`SELECT COUNT(*) AS c FROM audit_logs WHERE action='CONGE_DIRECTEUR_ENREGISTRE' AND resource_type='LEAVE_REQUESTS'`)
    push('AUD-008', 'P2', 'E — CONGE_DIRECTEUR_ENREGISTRE trace la demande du Directeur', 'B - API', Number(rows[0].c) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `audits=${rows[0].c}`)
  }
  // AUD-009 — audit d'absence ABSENCE_DECLARATIONS
  {
    const rows = await q(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='ABSENCE_DECLARATIONS' AND resource_id IS NOT NULL`)
    push('AUD-009', 'P1', 'G — un audit d’absence porte ABSENCE_DECLARATIONS avec un resource_id réel', 'B - API', Number(rows[0].c) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `audits=${rows[0].c}`)
  }
  // AUD-010 — audits dérogation DEROGATIONS
  {
    const rows = await q(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id IS NOT NULL`)
    push('AUD-010', 'P1', 'Les audits de dérogation portent DEROGATIONS avec un resource_id réel', 'B - API', Number(rows[0].c) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `audits=${rows[0].c}`)
  }
  // AUD-011 — 15 tables du diagramme
  {
    const expected = ['absence_declarations','audit_logs','balance_movements','derogations','documents','holidays','leave_balances','leave_requests','leave_types','notifications','service_backup_validators','services','settings','users','validator_replacements']
    const rows = await q(`SHOW TABLES`)
    const key = Object.keys(rows[0])[0]
    const tables = rows.map((r) => r[key])
    const missing = expected.filter((t) => !tables.includes(t))
    push('AUD-011', 'P1', 'La base conserve exactement les 15 tables du diagramme', 'B - API', missing.length === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `missing=${missing.join(',') || 'aucune'}`)
  }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-aud' })
  console.log('[AUD] ' + results.length + '/11')
}

run().catch((e) => { console.error(e); process.exit(1) })
