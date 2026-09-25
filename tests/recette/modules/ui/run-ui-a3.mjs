import { apiRequest, login, config, ensurePreuves, navigateViaSidebar } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'
import { chromium } from 'playwright'

const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'UI', scenario, type: 'C - UI + API', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

const ROLE_MATRIX = [
  { role: 'COLLABORATEUR', account: 'col-a.recette@gmes.fr', paths: ['/app/dashboard', '/app/my-requests', '/app/new-request'] },
  { role: 'RESPONSABLE_SERVICE', account: 'responsable.recette@gmes.fr', paths: ['/app/dashboard', '/app/requests'] },
  { role: 'RH', account: 'rh.recette@gmes.fr', paths: ['/app/dashboard', '/app/rh-leaves-absences', '/app/rh-validators'] },
  { role: 'DIRECTEUR', account: 'directeur.recette@gmes.fr', paths: ['/app/dashboard', '/app/director-all-requests'] },
  { role: 'ADMIN', account: 'admin.recette@gmes.fr', paths: ['/app/dashboard', '/app/admin-users', '/app/admin-services'] },
]

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, ok, resultText, comment = '') =>
    results.push(makeResult(id, priority, scenario, ok ? STATUS_OK : STATUS_KO, resultText, ok ? '' : 'NC', comment))

  // ===== Fixture minimale =====
  const [admin, rh, colA] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service UI A3', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId]) await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  const lt = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP UI A3', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const req = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: lt.id, startDate: '2026-11-05', endDate: '2026-11-05', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
  const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'ABS UI A3', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })).data
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colBId, leaveTypeId: absType.id, startDate: '2026-11-06', endDate: '2026-11-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'ABS UI A3' } })).data
  await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })

  const browser = await chromium.launch({ headless: true })

  async function loginAt(email, width, height) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
    await page.fill('#login-email', email)
    await page.fill('#login-password', 'RecetteGMES@2026!')
    await page.click('.login-submit')
    await page.waitForURL('**/app/**', { timeout: 15000 })
    return page
  }

  async function goTo(page, href) {
    await navigateViaSidebar(page, href)
    await page.waitForTimeout(350)
  }

  async function mobileGoTo(page, href) {
    const menuBtn = page.locator('.header__mobile-menu')
    await menuBtn.click()
    await page.waitForTimeout(300)
    await page.locator(`.sidebar__nav-item[href="${href}"]`).first().click()
    await page.waitForURL(`**${href}`, { timeout: 10000 })
    await page.waitForTimeout(400)
  }

  async function overflow(page) {
    return page.evaluate(() => {
      const de = document.documentElement
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, horizontalOverflow: de.scrollWidth > de.clientWidth + 1 }
    })
  }

  async function offscreenSelectors(page, selectors) {
    const vw = await page.evaluate(() => window.innerWidth)
    let count = 0
    for (const sel of selectors) {
      const el = page.locator(sel).first()
      if (await el.count()) {
        const box = await el.boundingBox()
        if (box && (box.x < -1 || box.x + box.width > vw + 1)) count += 1
      }
    }
    return count
  }

  const CRITICAL = ['.header', '#gmes-main-sidebar', '.app-shell__content']
  const CRITICAL_MOBILE = ['.header', '.app-shell__content']

  // ===== UI-014 : 1920×1080 =====
  {
    const summary = []; let allOk = true
    for (const r of ROLE_MATRIX) {
      const page = await loginAt(r.account, 1920, 1080)
      for (const p of r.paths) {
        await goTo(page, p)
        const ov = await overflow(page)
        const cut = await offscreenSelectors(page, CRITICAL)
        const loaded = await page.locator('.app-shell__content').count() === 1
        if (ov.horizontalOverflow || cut > 0 || !loaded) allOk = false
        summary.push(`${r.role}@${p}:overflow=${ov.horizontalOverflow},cut=${cut},loaded=${loaded}`)
      }
      await page.close().catch(() => {})
    }
    push('UI-014', 'P1', 'Affichage bureau 1920×1080', allOk, summary.join(' | '), '')
    console.log('UI-014', JSON.stringify({ ok: allOk, summary }))
  }

  // ===== UI-015 : 1366×768 =====
  {
    const summary = []; let allOk = true
    for (const r of ROLE_MATRIX) {
      const page = await loginAt(r.account, 1366, 768)
      await goTo(page, r.paths[0]); const dashOv = await overflow(page)
      await goTo(page, r.paths[1]); const listOv = await overflow(page)
      const cut = await offscreenSelectors(page, CRITICAL)
      if (dashOv.horizontalOverflow || listOv.horizontalOverflow || cut > 0) allOk = false
      summary.push(`${r.role}:dash=${dashOv.horizontalOverflow},list=${listOv.horizontalOverflow},cut=${cut}`)
      await page.close().catch(() => {})
    }
    push('UI-015', 'P1', 'Affichage bureau 1366×768', allOk, summary.join(' | '), '')
    console.log('UI-015', JSON.stringify({ ok: allOk, summary }))
  }

  // ===== UI-016 : 768×1024 =====
  {
    const summary = []; let allOk = true
    for (const r of ROLE_MATRIX) {
      const page = await loginAt(r.account, 768, 1024)
      await goTo(page, r.paths[0]); const ov = await overflow(page)
      const navLinks = await page.locator('.sidebar__nav-item').count()
      const cut = await offscreenSelectors(page, CRITICAL)
      if (ov.horizontalOverflow || navLinks === 0 || cut > 0) allOk = false
      summary.push(`${r.role}:overflow=${ov.horizontalOverflow},navLinks=${navLinks},cut=${cut}`)
      await page.close().catch(() => {})
    }
    push('UI-016', 'P1', 'Affichage tablette 768×1024', allOk, summary.join(' | '), '')
    console.log('UI-016', JSON.stringify({ ok: allOk, summary }))
  }

  // ===== UI-017 : 390×844 =====
  {
    const summary = []; let allOk = true
    for (const r of ROLE_MATRIX) {
      const page = await loginAt(r.account, 390, 844)
      await page.waitForSelector('.header__mobile-menu', { timeout: 10000 })
      const menuBtn = page.locator('.header__mobile-menu')
      const menuOk = await menuBtn.count() === 1
      await menuBtn.click(); await page.waitForTimeout(300)
      const menuOpen = await page.locator('.app-shell--mobile-open').count() === 1
      const navLinks = await page.locator('.sidebar__nav-item').count()
      await page.locator('.sidebar__mobile-close').click(); await page.waitForTimeout(300)
      const menuClosed = await page.locator('.app-shell--mobile-open').count() === 0
      await mobileGoTo(page, r.paths[1])
      const ov = await overflow(page)
      const cut = await offscreenSelectors(page, CRITICAL_MOBILE)
      const ok = menuOk && menuOpen && navLinks > 0 && menuClosed && !ov.horizontalOverflow && cut === 0
      if (!ok) allOk = false
      summary.push(`${r.role}:menu=${menuOk},open=${menuOpen},links=${navLinks},closed=${menuClosed},overflow=${ov.horizontalOverflow},cut=${cut}`)
      await page.close().catch(() => {})
    }
    push('UI-017', 'P1', 'Affichage mobile 390×844', allOk, summary.join(' | '), '')
    console.log('UI-017', JSON.stringify({ ok: allOk, summary }))
  }

  // ===== UI-018 : sidebar réduite + navigation mobile =====
  {
    const page = await loginAt('rh.recette@gmes.fr', 1366, 768)
    await goTo(page, '/app/dashboard')
    const collapseControlCount = await page.locator('[aria-label*="réduire" i], [aria-label*="collapse" i], [title*="réduire" i]').count()
    const sidebarCollapsedDesktop = await page.locator('.app-shell--collapsed').count() === 1
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300)
    const menuBtn = page.locator('.header__mobile-menu')
    await menuBtn.click(); await page.waitForTimeout(300)
    const mobileOpen = await page.locator('.app-shell--mobile-open').count() === 1
    await page.locator('.sidebar__nav-item', { hasText: 'Congés et Absences' }).first().click()
    await page.waitForURL('**/rh-leaves-absences**', { timeout: 10000 })
    const menuClosedAfterNav = await page.locator('.app-shell--mobile-open').count() === 0
    const orphanOverlay = await page.locator('.app-shell__backdrop').count()
    const desktopCollapseOk = collapseControlCount > 0 && sidebarCollapsedDesktop
    const ok = desktopCollapseOk && mobileOpen && menuClosedAfterNav && orphanOverlay === 0
    push('UI-018', 'P1', 'Sidebar réduite et navigation mobile', ok, `DESKTOP: collapseControl=${collapseControlCount}, collapsed=${sidebarCollapsedDesktop} | MOBILE: menuOpen=${mobileOpen}, navClose=${menuClosedAfterNav}, orphanOverlay=${orphanOverlay}`, '')
    console.log('UI-018', JSON.stringify({ collapseControlCount, sidebarCollapsedDesktop, mobileOpen, menuClosedAfterNav, orphanOverlay, ok }))
    await page.close().catch(() => {})
  }

  // ===== UI-019 : clavier / focus / fermeture =====
  {
    const page = await loginAt('rh.recette@gmes.fr', 1366, 768)
    await goTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-create', { timeout: 10000 })
    await page.keyboard.press('Tab'); await page.waitForTimeout(200)
    const focus1 = await page.evaluate(() => {
      const el = document.activeElement
      const cs = getComputedStyle(el)
      return { tag: el?.tagName, cls: typeof el?.className === 'string' ? el.className : '', outline: cs.outlineStyle + '/' + cs.outlineWidth, boxShadow: cs.boxShadow !== 'none' }
    })
    await page.click('.rh-events-create')
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    const drawerOpen = await page.locator('.rh-declaration-drawer').count()
    await page.locator('.rh-declaration-head button[aria-label="Fermer"]').click()
    await page.waitForSelector('.rh-declaration-drawer', { state: 'detached', timeout: 10000 })
    const drawerClosed = await page.locator('.rh-declaration-drawer').count()
    const focusIndicatorOk = (focus1.outline !== 'none/0px') || focus1.boxShadow
    const ok = drawerOpen === 1 && drawerClosed === 0 && focusIndicatorOk
    push('UI-019', 'P1', 'Navigation clavier, focus et fermeture des modales/drawers', ok, `focus=${focus1.tag}.${focus1.cls} outline=${focus1.outline} shadow=${focus1.boxShadow}, drawer open=${drawerOpen} close=${drawerClosed}`, '')
    console.log('UI-019', JSON.stringify({ focus1, drawerOpen, drawerClosed, focusIndicatorOk, ok }))
    await page.close().catch(() => {})
  }

  // ===== UI-020 : chargement / erreur / reprise =====
  {
    const page = await loginAt('rh.recette@gmes.fr', 1366, 768)
    // A. lente
    await page.route('**/api/leave-requests/management/all', async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.continue() })
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForTimeout(500)
    const loadingVisible = await page.locator('.rh-events-state').count() === 1
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.unroute('**/api/leave-requests/management/all')
    // B. erreur : re-monter la page via navigation client (le reload perdrait le token mémoire)
    await page.route('**/api/leave-requests/management/all', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Erreur simulée"}' }))
    await navigateViaSidebar(page, '/app/rh-validators')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-state.is-error', { timeout: 10000 })
    const errorText = (await page.locator('.rh-events-state.is-error').innerText()).trim()
    const stillAuthenticated = !page.url().includes('/login')
    await page.unroute('**/api/leave-requests/management/all')
    // C. reprise
    await page.click('.rh-events-state.is-error button')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const errorVisibleAfter = await page.locator('.rh-events-state.is-error').count()
    const stillAuth2 = !page.url().includes('/login')
    const ok = loadingVisible && errorText.length > 0 && stillAuthenticated && stillAuth2 && errorVisibleAfter === 0
    push('UI-020', 'P1', 'États de chargement, erreurs réseau et messages de retour', ok, `loading=${loadingVisible}, errorHttp=500, errorText="${errorText}", stillAuth=${stillAuthenticated}, recovery=liste restaurée, errorAfter=${errorVisibleAfter}`, '')
    console.log('UI-020', JSON.stringify({ loadingVisible, errorText, stillAuthenticated, stillAuth2, errorVisibleAfter, ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-ui-a3' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('UI-A3', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
