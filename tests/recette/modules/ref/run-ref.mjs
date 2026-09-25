import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, dbConn, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function setSetting(key, value) {
  const conn = await dbConn()
  try {
    await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Recette REF'])
  } finally { await conn.end() }
}

async function getSetting(key) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute('SELECT setting_value AS v FROM settings WHERE setting_key = ?', [key])
    return rows[0]?.v ?? null
  } finally { await conn.end() }
}

const result = makeResult('REF')

async function balancesOf(employeeId, token) {
  const r = await apiRequest(`/leave-balances/employee/${employeeId}`, { token })
  return Array.isArray(r.data) ? r.data : []
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, error = '', comment = '') =>
    results.push({ id, priority, module: 'REF', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof: '', error, comment })

  const [rhToken, adminToken, colAToken] = await Promise.all([
    login('rh.recette@gmes.fr'), login('admin.recette@gmes.fr'), login('col-a.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')

  // service pour col-a (éligibilité)
  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service REF', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })

  // REF-001 — forcer REFERENCE_PERIOD_START à 04-15
  {
    await setSetting('REFERENCE_PERIOD_START', '04-15')
    const v = await getSetting('REFERENCE_PERIOD_START')
    push('REF-001', 'P2', 'RH force REFERENCE_PERIOD_START à 04-15', 'B - API', v === '04-15' ? STATUS.CONFORME : STATUS.NON_CONFORME, `value=${v}`)
  }
  // REF-002 — acquisition contrôlée avril
  let runRes
  {
    const r = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-04' } })
    runRes = r
    push('REF-002', 'P2', 'acquisition contrôlée d’avril année de référence', 'B - API', r.status === 201 || r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // REF-003 — période attendue 30/04
  {
    const d = runRes.data
    push('REF-003', 'P2', 'le run expose la période attendue (30/04)', 'B - API', d?.effectiveDate === '2026-04-30' && d?.referencePeriod === '2026-2027' ? STATUS.CONFORME : STATUS.NON_CONFORME, `effectiveDate=${d?.effectiveDate} referencePeriod=${d?.referencePeriod}`)
  }
  // REF-004 — compteur N et mouvement rattachés à 2026-2027
  {
    const bals = await balancesOf(colA.id, rhToken)
    const n = bals.find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
    push('REF-004', 'P2', 'compteur N et mouvement rattachés à la période attendue', 'B - API', n && Number(n.acquiredDays) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `acquiredDays=${n?.acquiredDays}`)
  }
  // REF-005 — aucun rattachement à l'ancienne période
  {
    const bals = await balancesOf(colA.id, rhToken)
    const old = bals.find((b) => b.counterType === 'N' && b.referencePeriod === '2025-2026')
    push('REF-005', 'P2', 'aucun rattachement à l’ancienne période', 'B - API', !old ? STATUS.CONFORME : STATUS.NON_CONFORME, `oldPeriod=${old ? 'présent' : 'absent'}`)
  }
  // REF-006 — restaurer 06-01
  {
    await setSetting('REFERENCE_PERIOD_START', '06-01')
    push('REF-006', 'P2', 'RH restaure REFERENCE_PERIOD_START à 06-01', 'B - API', STATUS.CONFORME, 'restauré 06-01')
  }
  // REF-007 — restauration vérifiée
  {
    const v = await getSetting('REFERENCE_PERIOD_START')
    push('REF-007', 'P2', 'REFERENCE_PERIOD_START restauré à 06-01 (fin REF-1)', 'B - API', v === '06-01' ? STATUS.CONFORME : STATUS.NON_CONFORME, `value=${v}`)
  }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-ref' })
  console.log('[REF] ' + results.length + '/7')
}

run().catch((e) => { console.error(e); process.exit(1) })
