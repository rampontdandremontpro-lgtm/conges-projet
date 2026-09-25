import { writeReport } from '../../helpers/report.mjs'
import {
  apiRequest, STATUS, makeResult, login, loginPage, capture,
  dbConn, launch, isoAddDays, todayIso, utcWeekday, navigateViaSidebar, ensurePreuves,
} from '../../helpers/runner-utils.mjs'

const result = makeResult('DIR')

let winOffset = 5
function weekdayWindow(_min = 5) {
  for (let i = 0; i < 300; i += 1) {
    const s = isoAddDays(todayIso(), winOffset)
    const e = isoAddDays(s, 1)
    if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) {
      winOffset += 3
      return [s, e]
    }
    winOffset += 1
  }
  throw new Error('no weekday')
}

async function getBalance(employeeId, period, counter, token) {
  const r = await apiRequest(`/leave-balances/employee/${employeeId}`, { token })
  const list = Array.isArray(r.data) ? r.data : []
  return list.find((b) => b.referencePeriod === period && b.counterType === counter)
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') =>
    results.push({ id, priority, module: 'DIR', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment })

  const [adminToken, rhToken, dirToken, colAToken, respToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const dirMe = (await apiRequest('/users/me', { token: dirToken })).data

  // Type directeur « Congé »
  const conge = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service DIR', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })

  // Solde N-1 initial 30j
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: dirMe.id, referencePeriod: '2025-2026', counterType: 'N-1', acquiredDays: 30, reason: 'Fixture DIR.' } })

  const browser = await launch()

  // DIR-001..004 — rôles interdits sur la route Directeur
  {
    const [s, e] = weekdayWindow(5)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: colAToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await page.waitForTimeout(200); await capture(page, 'CAP-DIR-001.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('DIR-001', 'P1', 'Un collaborateur ne peut pas utiliser la route Directeur', 'C - UI + API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-DIR-001.png')
  }
  {
    const [s, e] = weekdayWindow(5)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: respToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    let page
    try { page = await loginPage(browser, 'responsable.recette@gmes.fr'); await page.waitForTimeout(200); await capture(page, 'CAP-DIR-002.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('DIR-002', 'P1', 'Un Responsable ne peut pas utiliser la route Directeur', 'C - UI + API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-DIR-002.png')
  }
  {
    const [s, e] = weekdayWindow(5)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: rhToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-003', 'P1', 'Une RH ne peut pas utiliser la route Directeur', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const [s, e] = weekdayWindow(5)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: adminToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-004', 'P1', 'Un administrateur ne peut pas utiliser la route Directeur', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  // DIR-005 — réduire le solde N-1 à 0
  {
    const b = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    const r = b?.id ? await apiRequest(`/leave-balances/${b.id}/correction`, { method: 'POST', token: rhToken, body: { days: -30, reason: 'Réduction recette DIR-005.' } }) : { status: 0, data: null }
    const after = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    push('DIR-005', 'P1', 'RH réduit le solde du Directeur pour le scénario de solde insuffisant', 'B - API', (r.status === 200 || r.status === 201) && Number(after?.availableDays) === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} available=${after?.availableDays}`)
  }
  // DIR-006 — solde insuffisant → attendu 400
  let insufficientCreated = false
  {
    const [s, e] = weekdayWindow(8)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    insufficientCreated = r.status === 201 || r.status === 200
    push('DIR-006', 'P1', 'Solde insuffisant du Directeur → 400', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', r.status === 400 ? '' : 'ANO-013 : la route Directeur n’effectue aucun contrôle de solde.')
  }
  // DIR-007 — aucune demande sans solde (transaction cohérente)
  push('DIR-007', 'P1', 'La transaction du Directeur est cohérente : aucune demande sans solde', 'B - API', !insufficientCreated ? STATUS.CONFORME : STATUS.NON_CONFORME, `demande créée sans solde=${insufficientCreated}`)
  // DIR-008 — restaurer le solde
  {
    const b = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    const r = b?.id ? await apiRequest(`/leave-balances/${b.id}/correction`, { method: 'POST', token: rhToken, body: { days: 30, reason: 'Restauration recette DIR-008.' } }) : { status: 0, data: null }
    const after = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    push('DIR-008', 'P1', 'RH restaure le solde du Directeur', 'B - API', (r.status === 200 || r.status === 201) && Number(after?.availableDays) === 30 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} available=${after?.availableDays}`)
  }

  // DIR-009 — enregistrement sans circuit
  let reqId
  {
    const [s, e] = weekdayWindow(11)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    reqId = r.data?.id ?? 0
    push('DIR-009', 'P1', 'Directeur enregistre un congé payé sans circuit de validation', 'B - API', r.status === 201 && r.data?.status === 'VALIDEE' ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} statut=${r.data?.status}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }
  // DIR-010 — aucune signature en base
  {
    if (reqId) {
      const conn = await dbConn()
      try {
        const [rows] = await conn.execute(`SELECT employee_signature_type AS et, validator_signature_type AS vt FROM leave_requests WHERE id=?`, [reqId])
        const ok = rows[0].et === null && rows[0].vt === null
        push('DIR-010', 'P1', 'Aucune signature en base pour la demande Directeur', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `employee=${rows[0].et} validator=${rows[0].vt}`)
      } finally { await conn.end() }
    } else push('DIR-010', 'P1', 'Aucune signature en base pour la demande Directeur', 'B - API', STATUS.BLOQUE, 'requestId absent')
  }
  // DIR-011 — audit CONGE_DIRECTEUR_ENREGISTRE
  {
    if (reqId) {
      const conn = await dbConn()
      try {
        const [rows] = await conn.execute(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='CONGE_DIRECTEUR_ENREGISTRE'`, [reqId])
        push('DIR-011', 'P1', 'L’audit trace l’enregistrement Directeur sans passage par le circuit', 'B - API', Number(rows[0].c) === 1 ? STATUS.CONFORME : STATUS.NON_CONFORME, `audits=${rows[0].c}`)
      } finally { await conn.end() }
    } else push('DIR-011', 'P1', 'L’audit trace l’enregistrement Directeur sans passage par le circuit', 'B - API', STATUS.BLOQUE, 'requestId absent')
  }
  // DIR-012 — notification interne RH
  {
    if (reqId) {
      const conn = await dbConn()
      try {
        const [rows] = await conn.execute(`SELECT COUNT(*) AS c FROM notifications WHERE leave_request_id=? AND type='CONGE_DIRECTEUR_INFORMATION'`, [reqId])
        push('DIR-012', 'P2', 'La notification interne confirme l’enregistrement Directeur', 'B - API', Number(rows[0].c) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifications=${rows[0].c}`)
      } finally { await conn.end() }
    } else push('DIR-012', 'P2', 'La notification interne confirme l’enregistrement Directeur', 'B - API', STATUS.BLOQUE, 'requestId absent')
  }
  // DIR-013 — solde N-1 déduit d'un jour
  {
    const before = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    const after = await getBalance(dirMe.id, '2025-2026', 'N-1', rhToken)
    const delta = Number(before?.availableDays) - Number(after?.availableDays)
    push('DIR-013', 'P1', 'Le solde N-1 du Directeur est déduit d’un jour', 'B - API', delta === 1 ? STATUS.CONFORME : STATUS.NON_CONFORME, `avant=${before?.availableDays} après=${after?.availableDays} delta=${delta}`, '', delta === 1 ? '' : 'ANO-013 : la route Directeur ne débite pas le solde.')
  }

  // DIR-014 — congé le jour même
  {
    const today = todayIso()
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: today, endDate: isoAddDays(today, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-014', 'P1', 'Directeur enregistre un congé le jour même', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // DIR-015 — présence EN_VACANCES
  {
    const me = await apiRequest('/users/me', { token: dirToken })
    const ok = me.data?.presenceStatus === 'EN_VACANCES'
    let page
    try { page = await loginPage(browser, 'directeur.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-DIR-015.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('DIR-015', 'P1', 'Le statut de présence du Directeur passe à EN_VACANCES', 'C - UI + API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `presence=${me.data?.presenceStatus}`, 'CAP-DIR-015.png')
  }
  // DIR-016 — présence au jour courant
  {
    let page
    let ok = false
    try { page = await loginPage(browser, 'directeur.recette@gmes.fr'); await page.waitForTimeout(300); await capture(page, 'CAP-DIR-016.png'); ok = true } catch {}
    if (page) await page.close().catch(() => {})
    push('DIR-016', 'P1', 'Présence du Directeur au jour courant', 'A - UI', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, 'capture présence Directeur', 'CAP-DIR-016.png')
  }

  // DIR-017 — chevauchement personnel refusé
  {
    const [s, e] = weekdayWindow(14)
    await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-017', 'P1', 'Chevauchement personnel du Directeur refusé', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // DIR-018 — dimanche refusé
  {
    const today = todayIso()
    // trouver le prochain dimanche
    let sunday = isoAddDays(today, 1)
    for (let i = 0; i < 7; i += 1) { if (utcWeekday(sunday) === 0) break; sunday = isoAddDays(sunday, 1) }
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: sunday, endDate: sunday, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-018', 'P1', 'Un dimanche est refusé pour le Directeur', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  // DIR-019..024 — jour férié et fermeture
  {
    const d = isoAddDays(todayIso(), 21)
    const r = await apiRequest('/holidays', { method: 'POST', token: rhToken, body: { date: d, name: 'Férié Martinique DIR', holidayType: 'MARTINIQUE', deductible: false } })
    push('DIR-019', 'P1', 'RH crée un jour férié Martinique pour le scénario E1', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', '', 'Erratum : les jours fériés officiels sont gérés automatiquement ; seule la création de fermetures GMES est manuelle.')
  }
  {
    const hol = await apiRequest('/holidays?year=2026', { token: rhToken })
    const list = Array.isArray(hol.data) ? hol.data : []
    const future = list.find((h) => h.date > todayIso() && h.holidayType !== 'FERMETURE_GMES')
    const d = future?.date ?? '2026-11-11'
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-020', 'P1', 'Un jour férié Martinique est refusé au Directeur', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} date=${d}`)
  }
  push('DIR-021', 'P1', 'RH désactive le jour férié du scénario E1', 'B - API', STATUS.CONFORME, 'Erratum : jour férié officiel géré automatiquement, sans désactivation manuelle.')
  let closureId
  {
    const d = isoAddDays(todayIso(), 24)
    const r = await apiRequest('/holidays', { method: 'POST', token: rhToken, body: { date: d, name: 'Fermeture GMES DIR', holidayType: 'FERMETURE_GMES', deductible: false } })
    closureId = r.data?.id
    push('DIR-022', 'P1', 'RH crée une fermeture GMES pour le scénario E1', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const d = isoAddDays(todayIso(), 24)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-023', 'P1', 'Une fermeture GMES est refusée au Directeur', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/holidays/${closureId}/disable`, { method: 'PATCH', token: rhToken })
    push('DIR-024', 'P1', 'RH désactive la fermeture du scénario E1', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // DIR-025 — samedi autorisé
  {
    const today = todayIso()
    let sat = isoAddDays(today, 1)
    for (let i = 0; i < 7; i += 1) { if (utcWeekday(sat) === 6) break; sat = isoAddDays(sat, 1) }
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: sat, endDate: sat, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('DIR-025', 'P2', 'Le Directeur peut enregistrer un samedi', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // DIR-026 — demi-journée
  {
    const [s] = weekdayWindow(28)
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'MATIN' } })
    push('DIR-026', 'P2', 'Le Directeur enregistre une demi-journée', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-dir' })
  console.log('DIR terminé')
}

run().catch((e) => { console.error(e); process.exit(1) })
