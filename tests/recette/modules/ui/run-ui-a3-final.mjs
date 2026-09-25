import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, config, ensurePreuves, navigateViaSidebar } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

const ROLES = [
  { role: 'COLLABORATEUR', account: 'col-a.recette@gmes.fr', list: '/app/my-requests', listEndpoint: '**/api/leave-requests/my' },
  { role: 'RESPONSABLE_SERVICE', account: 'responsable.recette@gmes.fr', list: '/app/requests', listEndpoint: '**/api/leave-requests/management/all' },
  { role: 'RH', account: 'rh.recette@gmes.fr', list: '/app/rh-leaves-absences', listEndpoint: '**/api/leave-requests/management/all' },
  { role: 'DIRECTEUR', account: 'directeur.recette@gmes.fr', list: '/app/director-all-requests', listEndpoint: '**/api/leave-requests/management/all' },
  { role: 'ADMIN', account: 'admin.recette@gmes.fr', list: '/app/admin-users', listEndpoint: '**/api/users' },
]

async function run() {
  ensurePreuves()
  const reportPath = path.resolve(__dirname, '../../reports/recette-results-ui-a3.json')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const update = (id, ok, resultText, comment = '') => {
    const entry = report.find((r) => r.id === id)
    entry.status = ok ? STATUS_OK : STATUS_KO
    entry.result = resultText
    entry.date = new Date().toISOString()
    entry.error = ok ? '' : 'NC'
    entry.comment = comment
    return entry
  }

  // Fixture
  const [admin, rh, colA] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service UI A3F', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId]) await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  const lt = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP UI A3F', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const req = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: lt.id, startDate: '2026-11-05', endDate: '2026-11-05', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
  const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'ABS UI A3F', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })).data
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colBId, leaveTypeId: absType.id, startDate: '2026-11-06', endDate: '2026-11-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'ABS UI A3F' } })).data
  await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })

  const browser = await chromium.launch({ headless: true })

  async function loginAt(email, w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
    await page.fill('#login-email', email)
    await page.fill('#login-password', 'RecetteGMES@2026!')
    await page.click('.login-submit')
    await page.waitForURL('**/app/**', { timeout: 15000 })
    return page
  }
  async function goTo(page, href) { await navigateViaSidebar(page, href); await page.waitForTimeout(350) }
  async function mobileGoTo(page, href) {
    await page.locator('.header__mobile-menu').click(); await page.waitForTimeout(300)
    const link = page.locator(`a[href="${href}"]`).first()
    await link.click()
    await page.waitForURL(`**${href}`, { timeout: 10000 })
    await page.waitForTimeout(400)
  }
  async function overflow(page) { return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) }
  function inViewport(box, vw) { return box && box.x >= -1 && box.x + box.width <= vw + 1 }

  // =====================================================================
  // UI-015 — 1366×768, panels réellement ouverts
  // =====================================================================
  {
    const summary = []
    const page = await loginAt('rh.recette@gmes.fr', 1366, 768)
    await goTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'ABS UI A3F' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForTimeout(400)
    const rhDrawerBox = await page.locator('.rh-absence-drawer--detail').boundingBox()
    const rhFooter = await page.locator('.rh-absence-detail-actions .rh-absence-button').count()
    const rhOk = rhDrawerBox && inViewport(rhDrawerBox, 1366) && rhFooter >= 1
    summary.push(`RH:drawer open=${rhOk},footerActions=${rhFooter}`)
    await page.close().catch(() => {})

    const page2 = await loginAt('admin.recette@gmes.fr', 1366, 768)
    await goTo(page2, '/app/admin-users')
    await page2.waitForSelector('.admin-users-new', { timeout: 10000 })
    await page2.click('.admin-users-new')
    await page2.waitForSelector('.admin-users-drawer', { timeout: 10000 })
    await page2.waitForTimeout(400)
    const adminDrawerBox = await page2.locator('.admin-users-drawer').boundingBox()
    const adminActions = await page2.locator('.admin-users-drawer__actions button').count()
    const adminOk = adminDrawerBox && inViewport(adminDrawerBox, 1366) && adminActions >= 1
    summary.push(`ADMIN:drawer open=${adminOk},actions=${adminActions}`)
    await page2.close().catch(() => {})

    const page3 = await loginAt('responsable.recette@gmes.fr', 1366, 768)
    await goTo(page3, '/app/requests')
    await page3.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    await page3.locator('.manager-all-requests-row--data').first().click()
    await page3.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    const mgrActions = await page3.locator('.manager-request-action--validate').count()
    summary.push(`RESPONSABLE:detail open=true,validate=${mgrActions}`)
    await page3.close().catch(() => {})

    const page4 = await loginAt('directeur.recette@gmes.fr', 1366, 768)
    await goTo(page4, '/app/director-all-requests')
    await page4.waitForSelector('.director-all-requests-row--data', { timeout: 10000 })
    await page4.locator('.director-all-requests-row--data').first().click()
    await page4.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    summary.push('DIRECTEUR:detail open=true')
    await page4.close().catch(() => {})

    const page5 = await loginAt('col-a.recette@gmes.fr', 1366, 768)
    await goTo(page5, '/app/new-request')
    await page5.waitForSelector('.nr-grid', { timeout: 10000 })
    const formOpenedCollab = await page5.locator('.nr-grid').count() === 1
    summary.push(`COLLABORATEUR:form open=${formOpenedCollab}`)
    await page5.close().catch(() => {})

    const ok = rhOk && adminOk && mgrActions >= 1 && formOpenedCollab
    update('UI-015', ok, summary.join(' | '), '1366×768')
    console.log('UI-015', JSON.stringify({ ok, summary }))
  }

  // =====================================================================
  // UI-016 — 768×1024, quatre familles
  // =====================================================================
  {
    const dashRoles = []; const listRoles = []
    for (const r of ROLES) {
      const page = await loginAt(r.account, 768, 1024)
      await goTo(page, '/app/dashboard'); const dashOv = await overflow(page); dashRoles.push(`${r.role}:${dashOv}`)
      await goTo(page, r.list); const listOv = await overflow(page); listRoles.push(`${r.role}:${listOv}`)
      await page.close().catch(() => {})
    }
    // Form collaborateur
    const pf = await loginAt('col-a.recette@gmes.fr', 768, 1024)
    await goTo(pf, '/app/new-request')
    await pf.waitForSelector('.nr-grid', { timeout: 10000 })
    const formOpened = await pf.locator('.nr-grid').count() === 1
    const cal = await pf.locator('.nr-cal').count()
    const formBtn = await pf.locator('.nr-col--side button').count()
    const formOv = await overflow(pf)
    const formFieldOverflowCount = formOv ? 1 : 0
    await pf.close().catch(() => {})
    // Détail RH absence
    const pd = await loginAt('rh.recette@gmes.fr', 768, 1024)
    await goTo(pd, '/app/rh-leaves-absences')
    await pd.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await pd.locator('.rh-events-row--data', { hasText: 'ABS UI A3F' }).first().click()
    await pd.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await pd.waitForTimeout(400)
    const detailOpened = await pd.locator('.rh-absence-drawer--detail').count() === 1
    const footerVisible = await pd.locator('.rh-absence-detail-actions .rh-absence-button').count()
    const drawerBox = await pd.locator('.rh-absence-drawer--detail').boundingBox()
    const drawerOverflowCount = drawerBox && drawerBox.x + drawerBox.width > 768 + 1 ? 1 : 0
    await pd.close().catch(() => {})

    const ok = dashRoles.every((s) => s.endsWith(':false')) && listRoles.every((s) => s.endsWith(':false')) && formOpened && cal >= 1 && formFieldOverflowCount === 0 && detailOpened && footerVisible >= 1 && drawerOverflowCount === 0
    update('UI-016', ok, `dash=${dashRoles.join(',')} | list=${listRoles.join(',')} | form=${formOpened}(cal=${cal},btn=${formBtn},overflow=${formFieldOverflowCount}) | detail=${detailOpened}(footer=${footerVisible},drawerOv=${drawerOverflowCount})`, '768×1024')
    console.log('UI-016', JSON.stringify({ ok, dashRoles, listRoles, formOpened, cal, formBtn, formFieldOverflowCount, detailOpened, footerVisible, drawerOverflowCount }))
  }

  // =====================================================================
  // UI-017 — 390×844, notifications + formulaires
  // =====================================================================
  {
    const summary = []
    let allOk = true
    for (const r of ROLES) {
      const page = await loginAt(r.account, 390, 844)
      await page.waitForSelector('.header__mobile-menu', { timeout: 10000 })
      // notifications
      await page.locator('.header__mobile-menu').click(); await page.waitForTimeout(300)
      const notifEntry = await page.locator('.sidebar__nav-item[href="/app/notifications"]').count()
      if (notifEntry >= 1) {
        await page.locator('.sidebar__nav-item[href="/app/notifications"]').first().click()
        await page.waitForURL('**/notifications**', { timeout: 10000 })
      }
      const notifOpened = notifEntry >= 1 && !page.url().includes('/login')
      const ov = await overflow(page)
      const okR = notifEntry >= 1 && notifOpened && !ov
      if (!okR) allOk = false
      summary.push(`${r.role}:login=ok,notifEntry=${notifEntry},notifOpened=${notifOpened},overflow=${ov}`)
      await page.close().catch(() => {})
    }
    // formulaire collaborateur mobile
    const fc = await loginAt('col-a.recette@gmes.fr', 390, 844)
    await mobileGoTo(fc, '/app/new-request')
    await fc.waitForSelector('.nr-grid', { timeout: 10000 })
    const collabFormOk = (await fc.locator('.nr-grid').count()) === 1 && !(await overflow(fc))
    await fc.close().catch(() => {})
    // drawer RH absence mobile
    const fr = await loginAt('rh.recette@gmes.fr', 390, 844)
    await fr.locator('.header__mobile-menu').click(); await fr.waitForTimeout(300)
    await fr.locator('.sidebar__nav-item[href="/app/rh-leaves-absences"]').first().click()
    await fr.waitForURL('**/rh-leaves-absences**', { timeout: 10000 })
    await fr.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await fr.locator('.rh-events-row--data', { hasText: 'ABS UI A3F' }).first().click()
    await fr.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    const rhDrawerOk = (await fr.locator('.rh-absence-detail-actions .rh-absence-button').count()) >= 1
    await fr.close().catch(() => {})
    // drawer admin mobile
    const fa = await loginAt('admin.recette@gmes.fr', 390, 844)
    await fa.locator('.header__mobile-menu').click(); await fa.waitForTimeout(300)
    await fa.locator('.sidebar__nav-item[href="/app/admin-users"]').first().click()
    await fa.waitForURL('**/admin-users**', { timeout: 10000 })
    await fa.waitForSelector('.admin-users-new', { timeout: 10000 })
    await fa.click('.admin-users-new')
    await fa.waitForSelector('.admin-users-drawer', { timeout: 10000 })
    const adminDrawerOk = (await fa.locator('.admin-users-drawer__actions button').count()) >= 1
    await fa.close().catch(() => {})

    const ok = allOk && collabFormOk && rhDrawerOk && adminDrawerOk
    update('UI-017', ok, `notifications: ${summary.join(' | ')} | formCollab=${collabFormOk}, drawerRH=${rhDrawerOk}, drawerAdmin=${adminDrawerOk}`, '390×844')
    console.log('UI-017', JSON.stringify({ ok, summary, collabFormOk, rhDrawerOk, adminDrawerOk }))
  }

  // =====================================================================
  // UI-019 — focus 5 rôles + overlay
  // =====================================================================
  {
    const focusSummary = []
    let allFocusOk = true
    for (const r of ROLES) {
      const page = await loginAt(r.account, 1366, 768)
      await goTo(page, r.list)
      await page.waitForTimeout(400)
      const seq = []
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(120)
        seq.push(await page.evaluate(() => {
          const el = document.activeElement
          const cs = getComputedStyle(el)
          return { tag: el?.tagName, cls: typeof el?.className === 'string' ? String(el.className).slice(0, 40) : '', outline: cs.outlineStyle + '/' + cs.outlineWidth, shadow: cs.boxShadow !== 'none' }
        }))
      }
      const hasFocusIndicator = seq.some((s) => (s.outline !== 'none/0px') || s.shadow)
      if (!hasFocusIndicator) allFocusOk = false
      focusSummary.push(`${r.role}:[${seq.map((s) => s.tag + '.' + s.cls).join('>')}] focus=${hasFocusIndicator}`)
      await page.close().catch(() => {})
    }
    // overlay RH + ADMIN
    const pr = await loginAt('rh.recette@gmes.fr', 1366, 768)
    await goTo(pr, '/app/rh-leaves-absences')
    await pr.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await pr.locator('.rh-events-row--data', { hasText: 'ABS UI A3F' }).first().click()
    await pr.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await pr.locator('.rh-absence-drawer__close').click()
    await pr.waitForSelector('.rh-absence-drawer--detail', { state: 'detached', timeout: 10000 })
    const rhClosed = await pr.locator('.rh-absence-drawer--detail').count() === 0
    await pr.close().catch(() => {})

    const pa = await loginAt('admin.recette@gmes.fr', 1366, 768)
    await goTo(pa, '/app/admin-users')
    await pa.waitForSelector('.admin-users-new', { timeout: 10000 })
    await pa.click('.admin-users-new')
    await pa.waitForSelector('.admin-users-drawer', { timeout: 10000 })
    await pa.locator('.admin-users-close').click()
    await pa.waitForSelector('.admin-users-drawer', { state: 'detached', timeout: 10000 })
    const adminClosed = await pa.locator('.admin-users-drawer').count() === 0
    await pa.close().catch(() => {})

    const ok = allFocusOk && rhClosed && adminClosed
    update('UI-019', ok, `focus: ${focusSummary.join(' | ')} | overlay RH close=${rhClosed}, ADMIN close=${adminClosed} (autres rôles: N/A pas de drawer autonome sur parcours principal)`, '')
    console.log('UI-019', JSON.stringify({ ok, focusSummary, rhClosed, adminClosed }))
  }

  // =====================================================================
  // UI-020 — RH cycle acquis + 4 autres rôles erreur/reprise
  // =====================================================================
  {
    const others = ROLES.filter((r) => r.role !== 'RH')
    const res = []
    let allOk = true
    for (const r of others) {
      const page = await loginAt(r.account, 1366, 768)
      await page.route(r.listEndpoint, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Erreur simulée"}' }))
      await goTo(page, r.list)
      await page.waitForTimeout(600)
      const stillAuth = !page.url().includes('/login')
      const errorVisible = await page.evaluate(() => /Impossible|charger|erreur|Réessayer|réessayer/i.test(document.body.innerText))
      const pageNotBlank = await page.evaluate(() => document.body.innerText.trim().length > 0)
      await page.unroute(r.listEndpoint)
      // reprise : navigation away/back
      await navigateViaSidebar(page, '/app/dashboard')
      await navigateViaSidebar(page, r.list)
      await page.waitForTimeout(600)
      const stillAuthAfter = !page.url().includes('/login')
      const recovered = await page.evaluate(() => document.body.innerText.trim().length > 0)
      const okR = stillAuth && errorVisible && pageNotBlank && stillAuthAfter && recovered
      if (!okR) allOk = false
      res.push(`${r.role}:${r.listEndpoint}:http=500,err=${errorVisible},auth=${stillAuth},recovery=${recovered},authAfter=${stillAuthAfter}`)
      await page.close().catch(() => {})
    }
    const ok = allOk
    update('UI-020', ok, `RH (cycle acquis): loading=true, 500, erreur visible, reprise ok | AUTRES: ${res.join(' | ')}`, '')
    console.log('UI-020', JSON.stringify({ ok, res }))
  }

  await browser.close()

  report.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(report, { label: 'recette-results-ui-a3' })
  const st = {}
  for (const r of report) st[r.status] = (st[r.status] || 0) + 1
  console.log('UI-A3-FINAL', report.length, JSON.stringify(st))
  for (const r of report) console.log(r.id, r.status, '|', r.result.slice(0, 80))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
