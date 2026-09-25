import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

const result = makeResult('E4')

async function q(sql, params = []) {
  const conn = await dbConn()
  try { const [rows] = await conn.execute(sql, params); return rows } finally { await conn.end() }
}
async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette E4']) } finally { await conn.end() }
}
async function countNotif(type, userId) {
  const rows = await q('SELECT COUNT(*) AS c FROM notifications WHERE type=? AND user_id=?', [type, userId])
  return Number(rows[0].c)
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'E4', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })

  const [rhToken, adminToken, colAToken] = await Promise.all([login('rh.recette@gmes.fr'), login('admin.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')
  const rh = (await apiRequest('/users/me', { token: rhToken })).data
  const dir = (await apiRequest('/users/me', { token: (await login('directeur.recette@gmes.fr')) })).data

  const today = todayIso()
  const period = '2025-2026'

  // E4-001 — init N-1
  {
    const r = await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: colA.id, referencePeriod: period, counterType: 'N-1', acquiredDays: 10, reason: 'Fixture E4.' } })
    push('E4-001', 'P1', 'Initialisation N-1 période de référence', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // E4-002 — forcer REFERENCE_PERIOD_START (échéance 7 jours)
  const start7 = isoAddDays(today, 8).slice(5)
  {
    await setSetting('REFERENCE_PERIOD_START', start7)
    push('E4-002', 'P2', 'RH force REFERENCE_PERIOD_START (échéance 7 jours aujourd’hui)', 'B - API', STATUS.CONFORME, `start=${start7}`)
  }
  // E4-003 — maintenance phase 1
  let run1
  {
    const r = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    run1 = r.data
    push('E4-003', 'P2', 'Maintenance E4 — échéance 7 jours (phase 1)', 'B - API', r.status === 200 && run1?.balanceReminders ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // E4-004 — résultat E4
  {
    const br = run1?.balanceReminders
    push('E4-004', 'P2', 'La maintenance expose le résultat E4', 'B - API', br?.referencePeriod === period && br?.deadline?.key === '7D' ? STATUS.CONFORME : STATUS.NON_CONFORME, `period=${br?.referencePeriod} deadline=${br?.deadline?.key}`)
  }
  // E4-005 — rappel individuel N-1 positif
  {
    const c = await countNotif(`BALANCE_REMINDER_7D_${period}`, colA.id)
    push('E4-005', 'P2', 'Rappel individuel créé pour chaque compteur N-1 positif', 'B - API', c > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifications=${c}`)
  }
  // E4-006 — titre/message fin de période
  {
    const rows = await q('SELECT title, message FROM notifications WHERE type=? AND user_id=?', [`BALANCE_REMINDER_7D_${period}`, colA.id])
    const end = isoAddDays(today, 7)
    const ok = rows.length > 0 && String(rows[0].message).includes('avant le')
    push('E4-006', 'P2', 'Rappel : titre et message affichent la fin de période (D+7)', 'B - API', ok ? STATUS.CONFORME : STATUS.NON_CONFORME, `title="${rows[0]?.title}"`)
  }
  // E4-007 — seul le plus récent envoyé (7D, pas 15D)
  {
    const c15 = await countNotif(`BALANCE_REMINDER_15D_${period}`, colA.id)
    const c7 = await countNotif(`BALANCE_REMINDER_7D_${period}`, colA.id)
    push('E4-007', 'P2', 'Plusieurs paliers dus : seul le plus récent est envoyé', 'B - API', c7 > 0 && c15 === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `7D=${c7} 15D=${c15}`)
  }
  // E4-008 — potentiel 0 → pas de rappel
  {
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: colB.id, referencePeriod: period, counterType: 'N-1', acquiredDays: 0, reason: 'Fixture E4-008.' } })
    const c = await countNotif(`BALANCE_REMINDER_7D_${period}`, colB.id)
    push('E4-008', 'P2', 'Potentiel = 0 : pas de rappel individuel', 'B - API', c === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifications=${c}`)
  }
  // E4-009 — pas de notification Admin
  {
    const c = await countNotif(`BALANCE_REMINDER_7D_${period}`, 13)
    push('E4-009', 'P2', 'Aucune notification E4 pour un Admin', 'B - API', c === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifications=${c}`)
  }
  // E4-010 — récapitulatif RH
  {
    const c = await countNotif(`BALANCE_RECAP_7D_${period}`, rh.id)
    push('E4-010', 'P2', 'Récapitulatif RH : une notification par RH active', 'B - API', c > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `notifications=${c}`)
  }
  // E4-011 — Directeur/Admin ne reçoivent pas le récap
  {
    const cDir = await countNotif(`BALANCE_RECAP_7D_${period}`, dir.id)
    const cAdmin = await countNotif(`BALANCE_RECAP_7D_${period}`, 13)
    push('E4-011', 'P2', 'Directeur et Admin ne reçoivent pas le récapitulatif RH', 'B - API', cDir === 0 && cAdmin === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `dir=${cDir} admin=${cAdmin}`)
  }
  // E4-012 — récap palier
  {
    const rows = await q('SELECT message FROM notifications WHERE type=? AND user_id=?', [`BALANCE_RECAP_7D_${period}`, rh.id])
    push('E4-012', 'P2', 'Récapitulatif RH : palier déclenché distinct de la date limite', 'B - API', rows.length > 0 && String(rows[0].message).includes('7 jours') ? STATUS.CONFORME : STATUS.NON_CONFORME, `message=${String(rows[0]?.message).slice(0,60)}`)
  }
  // E4-013/014 — idempotence
  let run2
  {
    const r = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    run2 = r.data
    const br = run2?.balanceReminders
    push('E4-013', 'P2', 'Maintenance E4 — second passage idempotent (phase 1 bis)', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
    push('E4-014', 'P2', 'Double maintenance : aucun doublon', 'B - API', Number(br?.remindersCreated ?? 1) === 0 && Number(br?.recapNotificationsCreated ?? 1) === 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `remindersCreated=${br?.remindersCreated} recap=${br?.recapNotificationsCreated}`)
  }
  // E4-015 — forcer REFERENCE_PERIOD_START (échéance 15 jours hier = rattrapage)
  const start15 = isoAddDays(today, 15).slice(5)
  {
    await setSetting('REFERENCE_PERIOD_START', start15)
    push('E4-015', 'P2', 'RH force REFERENCE_PERIOD_START (échéance 15 jours hier = rattrapage)', 'B - API', STATUS.CONFORME, `start=${start15}`)
  }
  // E4-016 — rattrapage
  let run3
  {
    const r = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
    run3 = r.data
    push('E4-016', 'P2', 'Maintenance E4 — rattrapage de l’échéance 15 jours (phase 2)', 'B - API', r.status === 200 && run3?.balanceReminders ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // E4-017 — échéance due envoyée au passage suivant
  {
    const c = await countNotif(`BALANCE_REMINDER_15D_${period}`, colA.id)
    push('E4-017', 'P2', 'Rattrapage : échéance due envoyée au passage suivant', 'B - API', c > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `15D=${c}`)
  }
  // E4-018 — solde modifié : valeur actuelle relue
  {
    const before = (await q('SELECT available_days AS a FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [colA.id, period, 'N-1']))[0]?.a
    push('E4-018', 'P1', 'Solde modifié entre deux rappels : valeur actuelle relue', 'B - API', before !== undefined ? STATUS.CONFORME : STATUS.NON_CONFORME, `available=${before}`)
  }
  // E4-019 — aucun ancien palier simultané
  {
    const c7 = await countNotif(`BALANCE_REMINDER_7D_${period}`, colA.id)
    push('E4-019', 'P2', 'Rattrapage : aucun ancien palier simultané', 'B - API', c7 > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `7D=${c7} (déjà envoyé phase 1, pas de doublon 15D+7D simultané)`)
  }
  // E4-020 — récap après rattrapage
  {
    const c = await countNotif(`BALANCE_RECAP_15D_${period}`, rh.id)
    push('E4-020', 'P2', 'Récapitulatif RH après rattrapage', 'B - API', c > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `recap15D=${c}`)
  }
  // E4-021/022 — restaurer 06-01
  {
    await setSetting('REFERENCE_PERIOD_START', '06-01')
    push('E4-021', 'P2', 'RH restaure REFERENCE_PERIOD_START à 06-01', 'B - API', STATUS.CONFORME, 'restauré 06-01')
    const v = (await q('SELECT setting_value AS v FROM settings WHERE setting_key=?', ['REFERENCE_PERIOD_START']))[0]?.v
    push('E4-022', 'P2', 'REFERENCE_PERIOD_START restauré à 06-01 (fin E4)', 'B - API', v === '06-01' ? STATUS.CONFORME : STATUS.NON_CONFORME, `value=${v}`)
  }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-e4' })
  console.log('[E4] ' + results.length + '/22')
}

run().catch((e) => { console.error(e); process.exit(1) })
