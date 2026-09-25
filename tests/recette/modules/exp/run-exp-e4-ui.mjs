import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function setSetting(k, v) { const c = await dbConn(); try { await c.execute('INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[k,v,'UI smoke']) } finally { await c.end() } }

async function run() {
  ensurePreuves()
  const [admin, rh, colA] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const col = users.find(u => u.email === 'col-a.recette@gmes.fr')

  const absType = (await apiRequest('/leave-types', { method:'POST', token:admin, body:{ name:'Absence UI smoke', category:'DECLARATION_ABSENCE', deductsPaidLeaveBalance:false, documentRequired:false, documentCanBeAddedLater:false, employeeCanCreate:false, rhOnly:true, allowsDays:true, allowsHalfDays:true, allowsHours:false, requiresValidation:false }})).data
  const svc = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:'Svc UI smoke', serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false }})).data
  await apiRequest(`/users/${col.id}`, { method:'PATCH', token:admin, body:{ serviceId: svc.id } })

  const browser = await launch()
  const today = todayIso()

  // ===== EXP-002 — vraie action UI export Absences XLSX =====
  {
    // fixture : une absence pour activer le bouton
    const a = await apiRequest('/absence-declarations', { method:'POST', token:rh, body:{ employeeId:col.id, leaveTypeId:absType.id, startDate:today, endDate:today, startPeriod:'MATIN', endPeriod:'APRES_MIDI' } })
    await apiRequest(`/absence-declarations/${a.data.id}/submit`, { method:'POST', token:rh, body:{ certifiedAccurate:true } })

    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-exports')
    await page.waitForSelector('.rh-export-card', { timeout: 10000 })
    const btn = page.locator('.rh-export-card', { hasText: 'Absences' }).locator('.rh-export-format--excel')
    await btn.waitFor({ state: 'visible', timeout: 10000 })
    const respPromise = page.waitForResponse((r) => r.request().method()==='GET' && /\/exports\/absence-declarations/.test(new URL(r.url()).pathname), { timeout: 15000 })
    const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    await btn.click()
    const resp = await respPromise
    await page.waitForTimeout(400)
    await capture(page, 'CAP-EXP-002.png')
    const dl = await dlPromise
    console.log('EXP-002', resp.status(), dl ? dl.suggestedFilename() : 'no-download')
    await page.close().catch(() => {})
  }

  // ===== E4 UI smoke : rappel individuel + récapitulatif =====
  {
    await apiRequest('/leave-balances/initialize', { method:'POST', token:rh, body:{ employeeId:col.id, referencePeriod:'2025-2026', counterType:'N-1', acquiredDays:10, reason:'E4 UI smoke' } })
    await setSetting('REFERENCE_PERIOD_START', isoAddDays(today, 8).slice(5))
    await apiRequest('/leave-requests/maintenance/run', { method:'POST', token:rh })

    const pCol = await loginPage(browser, 'col-a.recette@gmes.fr')
    await navigateViaSidebar(pCol, '/app/notifications')
    await pCol.waitForSelector('.notifications-page-card', { timeout: 10000 }).catch(() => {})
    const colBody = await pCol.locator('body').innerText()
    const reminderVisible = colBody.includes('Congés à utiliser avant')
    await capture(pCol, 'CAP-E4-005.png')
    await pCol.close().catch(() => {})

    const pRh = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(pRh, '/app/notifications')
    await pRh.waitForSelector('.notifications-page-card', { timeout: 10000 }).catch(() => {})
    const rhBody = await pRh.locator('body').innerText()
    const recapVisible = rhBody.includes('Récapitulatif des congés à utiliser')
    await capture(pRh, 'CAP-E4-020.png')
    await pRh.close().catch(() => {})

    console.log('E4 reminder visible', reminderVisible, '| recap visible', recapVisible)
  }

  await browser.close()
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
