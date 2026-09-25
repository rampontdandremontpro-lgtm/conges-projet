import { writeReport } from '../../helpers/report.mjs'
import { apiRequest, STATUS, makeResult, login, ensurePreuves, config, loginPage, capture, navigateViaSidebar, launch } from '../../helpers/runner-utils.mjs'

const result = makeResult('EXP')

async function download(token, path) {
  const r = await fetch(`${config.API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, contentType: r.headers.get('content-type') ?? '', size: buf.length, buf }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') =>
    results.push({ id, priority, module: 'EXP', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment })

  const [rhToken, dirToken, colAToken] = await Promise.all([
    login('rh.recette@gmes.fr'), login('directeur.recette@gmes.fr'), login('col-a.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const browser = await launch()
  async function capRh(pagePath, fileName) {
    let page
    try { page = await loginPage(browser, 'rh.recette@gmes.fr'); await navigateViaSidebar(page, pagePath); await page.waitForTimeout(400); await capture(page, fileName) } catch {}
    if (page) await page.close().catch(() => {})
  }

  // EXP-001 — CSV demandes
  {
    const d = await download(rhToken, '/exports/leave-requests?format=csv')
    push('EXP-001', 'P2', 'RH exporte les demandes en CSV', 'B - API', d.status === 200 && d.contentType.includes('csv') && d.size > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${d.status} type=${d.contentType} size=${d.size}`)
  }
  // EXP-002 — XLSX absences
  {
    const d = await download(rhToken, '/exports/absence-declarations?format=xlsx')
    await capRh('/app/rh-exports', 'CAP-EXP-002.png')
    push('EXP-002', 'P1', 'RH exporte les absences en XLSX', 'B - API', d.status === 200 && d.contentType.includes('spreadsheetml') && d.size > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${d.status} type=${d.contentType} size=${d.size}`, 'CAP-EXP-002.png')
  }
  // EXP-003 — Directeur ne télécharge pas export nominatif
  {
    const d = await download(dirToken, '/exports/leave-requests?format=csv')
    push('EXP-003', 'P2', 'Directeur ne télécharge pas un export nominatif', 'B - API', d.status === 403 || d.status === 401 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${d.status}`, '', d.status !== 403 ? 'ANO-014 : le Directeur peut télécharger un export nominatif.' : '')
  }
  // EXP-004 — Directeur consulte statistiques agrégées
  {
    const r = await apiRequest('/reports/director/statistics', { token: dirToken })
    push('EXP-004', 'P2', 'Directeur consulte les statistiques agrégées', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // EXP-005 — aucune donnée nominative
  {
    const r = await apiRequest('/reports/director/statistics', { token: dirToken })
    const s = JSON.stringify(r.data ?? {})
    const nominative = /@|COL-|Recette|prenom/i.test(s)
    push('EXP-005', 'P2', 'Les statistiques Directeur ne contiennent aucune donnée nominative', 'B - API', !nominative ? STATUS.CONFORME : STATUS.NON_CONFORME, `nominative=${nominative}`)
  }

  // Préparer une période passée avec un solde N pour la clôture/report
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: colA.id, referencePeriod: '2025-2026', counterType: 'N-1', acquiredDays: 10, reason: 'Fixture EXP.' } })

  // EXP-006 — prévisualiser clôture
  {
    const r = await apiRequest('/leave-balances/period/2025-2026/preview', { token: rhToken })
    await capRh('/app/rh-balances', 'CAP-EXP-006.png')
    push('EXP-006', 'P1', 'RH prévisualise la clôture', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-EXP-006.png')
  }
  // EXP-007 — Collaborateur ne décide pas report exceptionnel
  {
    const r = await apiRequest('/leave-balances/period/carryover', { method: 'POST', token: colAToken, body: { employeeId: colA.id, closingReferencePeriod: '2025-2026', days: 2, reason: 'Tentative collaborateur.' } })
    push('EXP-007', 'P1', 'Collaborateur ne décide pas un report exceptionnel', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // EXP-008 — RH accorde report exceptionnel
  {
    const r = await apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rhToken, body: { employeeId: colA.id, closingReferencePeriod: '2025-2026', days: 2, reason: 'Report exceptionnel recette EXP-008.' } })
    push('EXP-008', 'P1', 'RH accorde un report exceptionnel', 'B - API', r.status === 201 || r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // EXP-009 — report supérieur au reliquat refusé
  {
    const r = await apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rhToken, body: { employeeId: colA.id, closingReferencePeriod: '2025-2026', days: 999, reason: 'Report excessif recette.' } })
    push('EXP-009', 'P1', 'Un report supérieur au reliquat est refusé', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  // EXP-010 — Directeur ne clôture pas
  {
    const r = await apiRequest('/leave-balances/period/close', { method: 'POST', token: dirToken, body: { referencePeriod: '2025-2026', confirm: true } })
    await capRh('/app/rh-balances', 'CAP-EXP-010.png')
    push('EXP-010', 'P1', 'Directeur ne clôture pas les compteurs', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-EXP-010.png')
  }
  // EXP-011 — RH clôture transactionnellement
  {
    const r = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026', confirm: true } })
    await capRh('/app/rh-balances', 'CAP-EXP-011.png')
    push('EXP-011', 'P1', 'RH clôture transactionnellement la période', 'B - API', r.status === 201 || r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-EXP-011.png')
  }
  // EXP-012 — seconde clôture refusée
  {
    const r = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026', confirm: true } })
    await capRh('/app/rh-balances', 'CAP-EXP-012.png')
    push('EXP-012', 'P1', 'Une seconde clôture de la même période est refusée', 'B - API', r.status >= 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-EXP-012.png')
  }
  // EXP-013 — N-1 contient report + droits N transférés
  {
    const r = await apiRequest(`/leave-balances/employee/${colA.id}`, { token: rhToken })
    const list = Array.isArray(r.data) ? r.data : []
    const n1 = list.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    push('EXP-013', 'P1', 'Le nouveau N-1 contient le report exceptionnel et les droits N transférés', 'B - API', n1 && Number(n1.acquiredDays) > 0 ? STATUS.CONFORME : STATUS.NON_CONFORME, `N-1 2026-2027 acquiredDays=${n1?.acquiredDays}`)
  }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-exp' })
  console.log('[EXP] ' + results.length + '/13')
}

run().catch((e) => { console.error(e); process.exit(1) })
