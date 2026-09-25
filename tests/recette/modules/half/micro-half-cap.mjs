import { apiRequest, STATUS, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function setSetting(key, value) {
  const conn = await dbConn()
  try { await conn.execute('INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, value, 'Micro CAP']) } finally { await conn.end() }
}

async function run() {
  ensurePreuves()
  const [adminToken, rhToken, colAToken, respToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés CAP', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service CAP', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const today = todayIso()
  function win(off) { let s = isoAddDays(today, off); for (let i=0;i<100;i++){ const e=isoAddDays(s,1); if(utcWeekday(s)>=1&&utcWeekday(s)<=5&&utcWeekday(e)>=1&&utcWeekday(e)<=5) return [s,e]; s=isoAddDays(s,1) } }
  async function makeRequest(off) {
    const [s,e] = win(off)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: paid.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    return r.data.id
  }

  const browser = await launch()

  // ===== HALF-032 — vraie validation Responsable UI =====
  {
    await setSetting('AFTERNOON_START_HOUR', '23:59') // slot MATIN
    const rid = await makeRequest(40)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    await page.locator('.manager-all-requests-row--data').first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const valPromise = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'DR')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const valResp = await valPromise
    await page.waitForTimeout(500)
    await capture(page, 'CAP-HALF-032.png')
    console.log('HALF-032 validate HTTP', valResp.status())
    await page.close().catch(() => {})
  }

  // ===== HALF-054 — vraie tentative annulation COL-A UI =====
  {
    const rid = await makeRequest(44)
    const page = await loginPage(browser, 'col-a.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 10000 })
    await page.locator('.my-request-card').first().click()
    await page.waitForURL('**/my-requests/**', { timeout: 10000 })
    await page.waitForTimeout(500)
    const cancelBtn = page.locator('.request-detail-button--danger-outline', { hasText: 'Annuler la demande' })
    let http = 'no-button'
    if (await cancelBtn.count()) {
      page.on('dialog', (d) => d.accept())
      const cPromise = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-requests\/\d+\/cancel$/.test(new URL(r.url()).pathname), { timeout: 15000 })
      await cancelBtn.click()
      const cResp = await cPromise
      http = String(cResp.status())
      await page.waitForTimeout(400)
    }
    await capture(page, 'CAP-HALF-054.png')
    console.log('HALF-054 cancel', http)
    await page.close().catch(() => {})
  }

  await browser.close()
}

run().catch((e) => { console.error(e.message); process.exit(1) })
