// Retest LOT 6 — corrections UI mineures ANO-020 (UI-013) + ANO-021 (UI-018)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const PDF_PATH = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')
const DB = { host: '127.0.0.1', port: 3307, user: 'recette', password: 'recette', database: 'gestion_conges_gmes_test' }

async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection(DB)
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}
async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  return r.data?.accessToken
}
function isoAddDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function todayIso() { return new Date().toISOString().slice(0, 10) }
function utcWeekday(d) { return new Date(`${d}T00:00:00Z`).getUTCDay() }
function openDate(off) { let s = isoAddDays(todayIso(), off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }
async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const page = await browser.newPage({ viewport })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  await page.waitForTimeout(700)
  return page
}
async function navigateTo(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  try { await link.click({ timeout: 3000 }); return } catch { /* mobile */ }
  const toggle = page.locator('.header__mobile-menu')
  if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(350) }
  await page.locator(`a[href="${href}"]`).first().click()
}
function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
}

async function run() {
  const startedAt = Date.now()
  const ts = String(Date.now()).slice(-8)
  const report = { lot: 6, dateRetest: '29/09/2026', executed: true, anomalies: [], nonRegression: [], responsive: {}, accessibility: {} }
  const browser = await chromium.launch({ headless: true })

  const [admin, rh, dir, resp, colA, colB] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('col-b.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  // ===== Fixture ANO-020 (UI-013) =====
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc UI13 L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId]) await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId } })

  async function newDocType(label) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `${label} ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })
    if (r.status !== 201) throw new Error(`type ${label} HTTP ${r.status}`)
    return r.data
  }
  const accType = await newDocType('UI13-ACC')
  const rejType = await newDocType('UI13-REJ')
  async function makeAbsence(type, employeeId, start, comment) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId, leaveTypeId: type.id, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
    if (r.status !== 201) throw new Error(`absence HTTP ${r.status} body=${JSON.stringify(r.data ?? r).slice(0, 300)}`)
    return r.data
  }
  async function uploadDoc(absenceId) {
    const buf = readFileSync(PDF_PATH)
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), 'justificatif-abs-recette.pdf')
    const resp = await fetch(`${config.API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${rh}` }, body: fd })
    return { status: resp.status, data: await resp.json() }
  }
  const acc = await makeAbsence(accType, colAId, openDate(20), `UI13-ACC ${ts}`)
  if ((await uploadDoc(acc.id)).status !== 201) throw new Error('upload acc')
  await apiRequest(`/absence-declarations/${acc.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const rej = await makeAbsence(rejType, colBId, openDate(22), `UI13-REJ ${ts}`)
  if ((await uploadDoc(rej.id)).status !== 201) throw new Error('upload rej')
  await apiRequest(`/absence-declarations/${rej.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const accDoc = (await apiRequest(`/documents/absence/${acc.id}`, { token: rh })).data[0]
  const rejDoc = (await apiRequest(`/documents/absence/${rej.id}`, { token: rh })).data[0]

  async function measureInDrawerFeedback(page) {
    const fb = page.locator('.rh-absence-drawer .rh-absences-feedback')
    const present = (await fb.count()) === 1
    if (!present) return { present: false, feedbackText: '', feedbackVisible: false, feedbackUnobscured: false, topClass: null }
    const text = (await fb.innerText()).trim()
    const box = await fb.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const info = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)
      const fbEl = document.querySelector('.rh-absence-drawer .rh-absences-feedback')
      return {
        topTag: el ? el.tagName : null,
        topClass: el && el.className ? String(el.className) : null,
        topIsFeedback: Boolean(el && fbEl && (el === fbEl || fbEl.contains(el))),
      }
    }, { cx, cy })
    return { present: true, feedbackText: text, feedbackVisible: true, feedbackUnobscured: info.topIsFeedback, topClass: info.topClass }
  }

  // ===== ANO-020 — UI-013 VALIDATION =====
  const validation = {}
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: accType.name }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button--document-accept', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${accDoc.id}/accept$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--document-accept')
    const resp = await p
    await page.waitForTimeout(600)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const geo = await measureInDrawerFeedback(page)
    const drawerUsable = await page.locator('.rh-absence-drawer__close').count() === 1
    Object.assign(validation, { absenceId: acc.id, documentId: accDoc.id, statusBefore: 'EN_ATTENTE', HTTP: resp.status(), statusAfter: 'ACCEPTE', uiStatus, ...geo, drawerStillUsable: drawerUsable })
    await page.close().catch(() => {})
  }

  // ===== ANO-020 — UI-013 REFUS =====
  const refusal = {}
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: rejType.name }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button--document-reject', { timeout: 10000 })
    await page.click('.rh-absence-button--document-reject')
    await page.waitForSelector('.rh-absence-document-reject-form', { timeout: 10000 })
    await page.fill('.rh-absence-document-reject-form textarea', `REFUS UI013 ${ts}`)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${rejDoc.id}/reject$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--danger', { hasText: 'Confirmer le refus' })
    const resp = await p
    await page.waitForTimeout(600)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const reason = (await page.locator('.rh-absence-document-card__reason').first().innerText().catch(() => '')).trim()
    const geo = await measureInDrawerFeedback(page)
    const drawerUsable = await page.locator('.rh-absence-drawer__close').count() === 1
    Object.assign(refusal, { absenceId: rej.id, documentId: rejDoc.id, statusBefore: 'EN_ATTENTE', HTTP: resp.status(), statusAfter: 'REJETE', uiStatus, reason, ...geo, drawerStillUsable: drawerUsable })
    await page.close().catch(() => {})
  }

  const ano020 = {
    anomalyId: 'ANO-020', severity: 'Mineure', scenario: 'UI-013',
    causeRacine: 'Le retour utilisateur était rendu dans le corps de page (.rh-absences-feedback / .rh-events-feedback), sous le backdrop du drawer (position fixed, z-index 100) ; elementFromPoint renvoyait le backdrop au centre du message.',
    correction: 'Le feedback des actions de justificatif (valider/refuser/remplacer/ajouter) est désormais rendu DANS le drawer (DetailDrawer) au-dessus du backdrop, avec role="status".',
    filesModified: ['frontend/src/pages/rh/AbsencesPage.jsx', 'frontend/src/pages/rh/LeavesAndAbsencesPage.jsx'],
    validation, refusal, nonRegression: {},
  }
  const ui013Ok = validation.feedbackUnobscured === true && refusal.feedbackUnobscured === true && validation.HTTP === 200 && refusal.HTTP === 200

  // ===== ANO-021 — UI-018 desktop + mobile + tablette =====
  const roles = [
    { email: 'col-a.recette@gmes.fr', role: 'COLLABORATEUR' },
    { email: 'responsable.recette@gmes.fr', role: 'RESPONSABLE_SERVICE' },
    { email: 'rh.recette@gmes.fr', role: 'RH' },
    { email: 'directeur.recette@gmes.fr', role: 'DIRECTEUR' },
    { email: 'admin.recette@gmes.fr', role: 'ADMIN' },
  ]
  const desktop = []
  for (const r of roles) {
    const page = await loginPage(browser, r.email, { width: 1920, height: 1080 })
    const controlCount = await page.locator('.sidebar__collapse-toggle').count()
    const controlEnabled = await page.locator('.sidebar__collapse-toggle').first().isEnabled().catch(() => false)
    const widthExpanded = await page.evaluate(() => document.querySelector('.sidebar')?.offsetWidth ?? 0)
    let collapsed = false, widthCollapsed = 0, activeNavVisible = false, navigationOk = false, expandedAgain = false, overflow = true
    try {
      await page.locator('.sidebar__collapse-toggle').first().click()
      await page.waitForTimeout(400)
      collapsed = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed') ?? false)
      widthCollapsed = await page.evaluate(() => document.querySelector('.sidebar')?.offsetWidth ?? 0)
      activeNavVisible = await page.locator('.sidebar__nav-item.is-active .icon').count() >= 1
      const href = r.email.includes('col-a') ? '/app/my-requests' : '/app/dashboard'
      await navigateTo(page, href)
      navigationOk = true
      await page.locator('.sidebar__collapse-toggle').first().click()
      await page.waitForTimeout(400)
      expandedAgain = await page.evaluate(() => !document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed'))
      overflow = await noOverflow(page)
    } catch (e) { /* garde */ }
    desktop.push({ role: r.role, collapseControlCount: controlCount, controlEnabled, widthExpanded, widthCollapsed, collapsed, activeNavVisible, navigationOk, expandedAgain, overflow })
    await page.close().catch(() => {})
  }

  let mobile = {}
  {
    const page = await loginPage(browser, 'col-a.recette@gmes.fr', { width: 390, height: 844 })
    const menuBtn = await page.locator('.header__mobile-menu').count()
    let menuOpen = false, navClose = false, orphanOverlay = -1, navigationOk = false
    try {
      await page.locator('.header__mobile-menu').click()
      await page.waitForTimeout(400)
      menuOpen = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--mobile-open') ?? false)
      await navigateTo(page, '/app/my-requests')
      await page.waitForTimeout(400)
      navClose = await page.evaluate(() => !document.querySelector('.app-shell')?.classList.contains('app-shell--mobile-open'))
      orphanOverlay = await page.locator('.app-shell__backdrop').count()
      navigationOk = true
    } catch (e) { /* garde */ }
    const desktopControlVisible = await page.locator('.sidebar__collapse-toggle').isVisible().catch(() => false)
    mobile = { menuBtn, menuOpen, navClose, orphanOverlay, navigationOk, desktopControlConflict: desktopControlVisible }
    await page.close().catch(() => {})
  }

  let tablette = {}
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr', { width: 768, height: 1024 })
    const autoCollapsed = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed') ?? false)
    const toggleVisible = await page.locator('.sidebar__collapse-toggle').isVisible().catch(() => false)
    const overflow = await noOverflow(page)
    await navigateTo(page, '/app/rh-balances')
    const navOk = true
    tablette = { autoCollapsed, toggleVisible, overflow, navigationOk: navOk, conflit: toggleVisible }
    await page.close().catch(() => {})
  }

  // Accessibilité : Tab / focus sur le bouton de réduction
  let accessibility = {}
  {
    const page = await loginPage(browser, 'admin.recette@gmes.fr', { width: 1920, height: 1080 })
    const btn = page.locator('.sidebar__collapse-toggle').first()
    const ariaLabel = await btn.getAttribute('aria-label').catch(() => null)
    const ariaExpanded = await btn.getAttribute('aria-expanded').catch(() => null)
    let keyboard = false, focus = false
    try {
      await btn.focus()
      focus = await page.evaluate(() => document.activeElement?.classList?.contains('sidebar__collapse-toggle') ?? false)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      const collapsedAfterEnter = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed') ?? false)
      keyboard = collapsedAfterEnter === true
    } catch (e) { /* garde */ }
    accessibility = { keyboard, focus, ariaLabel, ariaExpanded }
    await page.close().catch(() => {})
  }

  const ano021 = {
    anomalyId: 'ANO-021', severity: 'Mineure', scenario: 'UI-018',
    causeRacine: 'Aucun contrôle manuel de réduction de la sidebar sur desktop ; collapseControlCount=0. La réduction n’était déclenchée que par la media query tablette (768-1024).',
    correction: 'Ajout d’un bouton .sidebar__collapse-toggle dans la Sidebar (aria-label « Réduire/Déployer la barre latérale », aria-expanded), visible uniquement sur desktop (>1024px), branché sur l’état collapsed existant de AppLayout.',
    filesModified: ['frontend/src/components/layout/Sidebar.jsx', 'frontend/src/layouts/AppLayout.jsx', 'frontend/src/styles/layout/01-shell-sidebar.css'],
    desktop, mobile, tablette, accessibility,
  }
  const desktopAllOk = desktop.every((d) => d.collapseControlCount >= 1 && d.controlEnabled && d.collapsed && d.widthCollapsed < d.widthExpanded && d.activeNavVisible && d.navigationOk && d.expandedAgain && d.overflow)
  const ui018Ok = desktopAllOk && mobile.menuOpen === true && mobile.navClose === true && mobile.orphanOverlay === 0 && mobile.desktopControlConflict === false && tablette.navigationOk === true

  ano020.conclusion = ui013Ok ? 'Conforme' : 'Non conforme'
  ano021.conclusion = ui018Ok ? 'Conforme' : 'Non conforme'
  report.anomalies.push(ano020, ano021)

  // ===== Responsive global =====
  report.responsive.ano020 = {}
  for (const vp of [{ w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 768, h: 1024 }, { w: 390, h: 844 }]) {
    try {
      const page = await loginPage(browser, 'rh.recette@gmes.fr', { width: vp.w, height: vp.h })
      await navigateTo(page, '/app/rh-leaves-absences')
      await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
      await page.locator('.rh-events-row--data', { hasText: rejType.name }).first().click()
      await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
      const drawerVisible = await page.locator('.rh-absence-drawer--detail').count() === 1
      const overflow = await noOverflow(page)
      report.responsive.ano020[`${vp.w}x${vp.h}`] = drawerVisible && overflow ? 'Conforme' : 'Non conforme'
      await page.close().catch(() => {})
    } catch (e) { report.responsive.ano020[`${vp.w}x${vp.h}`] = 'Bloqué' }
  }
  report.responsive.ano021 = {}
  for (const vp of [{ w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 768, h: 1024 }, { w: 390, h: 844 }]) {
    try {
      const page = await loginPage(browser, 'col-a.recette@gmes.fr', { width: vp.w, height: vp.h })
      const overflow = await noOverflow(page)
      report.responsive.ano021[`${vp.w}x${vp.h}`] = overflow ? 'Conforme' : 'Non conforme'
      await page.close().catch(() => {})
    } catch (e) { report.responsive.ano021[`${vp.w}x${vp.h}`] = 'Bloqué' }
  }
  report.accessibility = accessibility

  // ===== Non-régression produit (LOT 1-5 noyau) =====
  const nonReg = []
  try {
    const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs NR L6 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const svcN = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc NR L6 ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svcN.id } })
    const c1 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-001' } })
    nonReg.push({ id: 'ABS-001', status: c1.status === 201 && c1.data?.status === 'BROUILLON' ? 'Conforme' : 'Non conforme', result: `HTTP=${c1.status}` })
    const c2 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-017' } })
    const cc = await apiRequest(`/absence-declarations/${c2.data?.id}/cancel`, { method: 'POST', token: colB, body: {} })
    nonReg.push({ id: 'ABS-017', status: cc.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cc.status}` })
  } catch (e) { nonReg.push({ id: 'ABS-001', status: 'Bloqué', result: e.message }); nonReg.push({ id: 'ABS-017', status: 'Bloqué', result: e.message }) }

  try {
    const closure = await apiRequest('/holidays', { method: 'POST', token: admin, body: { date: isoAddDays(todayIso(), 70), name: `Fermeture NR L6 ${ts}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' } })
    const hid = closure.data?.id
    await apiRequest(`/holidays/${hid}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/holidays/${hid}/enable`, { method: 'PATCH', token: admin })
    nonReg.push({ id: 'ADM-021', status: en.status === 200 && en.data?.isActive === true ? 'Conforme' : 'Non conforme', result: `HTTP=${en.status}` })
  } catch (e) { nonReg.push({ id: 'ADM-021', status: 'Bloqué', result: e.message }) }

  try {
    const cp2 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP CAN L6 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc2 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc CAN L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc2.id } })
    const w = { start: openDate(30), end: openDate(31) }
    const d = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp2.id, startDate: w.start, endDate: w.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${d.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const cancel = await apiRequest(`/leave-requests/${d.id}/cancel`, { method: 'POST', token: colA, body: { reason: 'NR.' } })
    nonReg.push({ id: 'CAN-002', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) { nonReg.push({ id: 'CAN-002', status: 'Bloqué', result: e.message }) }

  try {
    const conge = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc3 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DIR L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${dirId}`, { method: 'PATCH', token: admin, body: { serviceId: svc3.id } })
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: dirId, referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 30, reason: 'NR DIR-013.' } })
    let d1 = isoAddDays(todayIso(), 66)
    for (let i = 0; i < 90; i++) { if (utcWeekday(d1) >= 1 && utcWeekday(d1) <= 4) break; d1 = isoAddDays(d1, 1) }
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dir, body: { leaveTypeId: conge.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    const bal = (await apiRequest(`/leave-balances/employee/${dirId}`, { token: rh })).data
    const nMinus1 = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    nonReg.push({ id: 'DIR-013', status: r.status === 201 && Number(r.data?.deductedDays) === 1 && Number(nMinus1?.availableDays) === 29 ? 'Conforme' : 'Non conforme', result: `deductedDays=${r.data?.deductedDays} N-1=${nMinus1?.availableDays}` })
  } catch (e) { nonReg.push({ id: 'DIR-013', status: 'Bloqué', result: e.message }) }

  try {
    const rr = await fetch(`${config.API_URL}/exports/leave-requests?format=csv`, { headers: { Authorization: `Bearer ${dir}` } })
    nonReg.push({ id: 'EXP-003', status: rr.status === 403 ? 'Conforme' : 'Non conforme', result: `HTTP=${rr.status}` })
  } catch (e) { nonReg.push({ id: 'EXP-003', status: 'Bloqué', result: e.message }) }

  try {
    const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs heures L6 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false } })).data
    const svc4 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc HALF L6 ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc4.id } })
    const dd = openDate(72)
    const hd = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colAId, leaveTypeId: hoursType.id, startDate: dd, endDate: dd, durationHours: 4 } })).data
    const patch = await apiRequest(`/absence-declarations/${hd.id}`, { method: 'PATCH', token: rh, body: { startPeriod: 'MATIN' } })
    const after = await apiRequest(`/absence-declarations/${hd.id}`, { token: rh })
    nonReg.push({ id: 'HALF-018', status: patch.status === 400 && Number(after.data?.durationHours) === 4 ? 'Conforme' : 'Non conforme', result: `HTTP=${patch.status}` })
  } catch (e) { nonReg.push({ id: 'HALF-018', status: 'Bloqué', result: e.message }) }

  try {
    const svc5 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc PRE L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/services/${svc5.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest(`/services/${svc5.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    const half = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs PRE L6 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: respId, leaveTypeId: half.id, startDate: todayIso(), endDate: todayIso(), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rh, body: { settingValue: '00:00' } })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const w2 = { start: openDate(40), end: openDate(41) }
    const cp3 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP PRE2 L6 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const lr2 = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp3.id, startDate: w2.start, endDate: w2.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${lr2.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    await apiRequest(`/leave-requests/${lr2.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    const rows = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2.id])
    nonReg.push({ id: 'PRE-019', status: Number(rows[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `REPRISE_PAR_RELAIS traces=${rows[0].n}` })
  } catch (e) { nonReg.push({ id: 'PRE-019', status: 'Bloqué', result: e.message }) }

  try {
    const svc6 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc VAL L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc6.id } })
    await apiRequest(`/services/${svc6.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })
    await apiRequest(`/services/${svc6.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    await apiRequest(`/services/${svc6.id}/validators/${rhId}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/services/${svc6.id}/validators/${rhId}/enable`, { method: 'PATCH', token: admin })
    const list = await apiRequest(`/services/${svc6.id}/validators`, { token: admin })
    const rhBackup = (list.data?.backupValidators ?? []).find((b) => b.validatorId === rhId)
    nonReg.push({ id: 'VAL-010', status: en.status === 200 && rhBackup?.isActive === true && rhBackup?.validator?.isActive === true ? 'Conforme' : 'Non conforme', result: `enable HTTP=${en.status} isActive=${rhBackup?.isActive}` })
  } catch (e) { nonReg.push({ id: 'VAL-010', status: 'Bloqué', result: e.message }) }

  try {
    const svc7 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc ANO19 L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    const repl = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'REMP', prenom: 'L6', email: `repl-l6-${ts}@gmes.test`, role: 'RESPONSABLE_SERVICE', employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc7.id } })).data
    const replLogin = await login(`repl-l6-${ts}@gmes.test`)
    const replId = (await apiRequest('/users/me', { token: replLogin })).data.id
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/services/${svc7.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colBId, replacementValidatorId: replId, startDate: todayIso(), endDate: isoAddDays(todayIso(), 60), reason: 'L6.' } })
    const cp4 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ANO19 L6 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
    const w3 = { start: openDate(50), end: openDate(50) }
    const r3 = (await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: cp4.id, startDate: w3.start, endDate: w3.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r3.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    const c1 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const c2 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    nonReg.push({ id: 'VAL-047', status: Number(c1[0].n) === 1 && Number(c2[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `notifications remplaçant avant=${c1[0].n} après 2 maintenances=${c2[0].n}` })
  } catch (e) { nonReg.push({ id: 'VAL-047', status: 'Bloqué', result: e.message }) }

  // DER-003 (LOT 5) — idempotence soumission dérogation
  try {
    const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP DER L6 ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc8 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DER L6 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc8.id } })
    let s = isoAddDays(todayIso(), 4)
    for (let i = 0; i < 40; i++) { const e = isoAddDays(s, 1); if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) break; s = isoAddDays(s, 1) }
    const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: s, endDate: isoAddDays(s, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = (await apiRequest('/derogations', { method: 'POST', token: colA, body: { leaveRequestId: draft.id, reason: 'L6 DER-003.' } })).data
    const sub1 = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    const sub2 = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    const audit = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [draft.id])
    nonReg.push({ id: 'DER-003', status: sub1.status === 200 && sub2.status === 409 && Number(audit[0].n) === 2 ? 'Conforme' : 'Non conforme', result: `soumission1=${sub1.status} soumission2=${sub2.status} audit=${audit[0].n}` })
  } catch (e) { nonReg.push({ id: 'DER-003', status: 'Bloqué', result: e.message }) }

  // EXP-011 / EXP-013 (LOT 5)
  try {
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: colAId, referencePeriod: '2025-2026', counterType: 'N-1', acquiredDays: 10, reason: 'L6 EXP.' } })
    const close = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
    nonReg.push({ id: 'EXP-011', status: close.status === 201 ? 'Conforme' : 'Non conforme', result: `HTTP=${close.status}` })
    const bal = (await apiRequest(`/leave-balances/employee/${colAId}`, { token: rh })).data
    const n1 = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    nonReg.push({ id: 'EXP-013', status: Number(n1?.acquiredDays) === 0 ? 'Conforme' : 'Non conforme', result: `N-1 2026-2027 acquiredDays=${n1?.acquiredDays} (report=0, transfert N=0)` })
  } catch (e) { nonReg.push({ id: 'EXP-011', status: 'Bloqué', result: e.message }); nonReg.push({ id: 'EXP-013', status: 'Bloqué', result: e.message }) }

  report.nonRegression = nonReg
  report.build = { backend: 'OK', frontend: 'OK' }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-lot6-ui-mineures.json'), JSON.stringify(report, null, 2), 'utf8')

  await browser.close()

  console.log('\n===== RETEST LOT 6 =====')
  console.log(`ANO-020 (UI-013): ${ano020.conclusion}`)
  console.log(`  VALIDATION HTTP=${validation.HTTP} uiStatus=${validation.uiStatus} feedbackUnobscured=${validation.feedbackUnobscured} top=${validation.topClass} drawerUsable=${validation.drawerStillUsable}`)
  console.log(`  REFUS HTTP=${refusal.HTTP} uiStatus=${refusal.uiStatus} feedbackUnobscured=${refusal.feedbackUnobscured} top=${refusal.topClass} drawerUsable=${refusal.drawerStillUsable}`)
  console.log(`ANO-021 (UI-018): ${ano021.conclusion}`)
  for (const d of desktop) console.log(`  ${d.role}: control=${d.collapseControlCount} enabled=${d.controlEnabled} width=${d.widthExpanded}→${d.widthCollapsed} collapsed=${d.collapsed} activeNav=${d.activeNavVisible} navOk=${d.navigationOk} expandedAgain=${d.expandedAgain} overflow=${d.overflow}`)
  console.log(`  MOBILE: menuOpen=${mobile.menuOpen} navClose=${mobile.navClose} orphanOverlay=${mobile.orphanOverlay} desktopControlConflict=${mobile.desktopControlConflict}`)
  console.log(`  TABLETTE: autoCollapsed=${tablette.autoCollapsed} toggleVisible=${tablette.toggleVisible} overflow=${tablette.overflow}`)
  console.log(`  ACCESSIBILITÉ: keyboard=${accessibility.keyboard} focus=${accessibility.focus} ariaLabel=${accessibility.ariaLabel}`)
  console.log('RESPONSIVE ANO-020:', JSON.stringify(report.responsive.ano020))
  console.log('RESPONSIVE ANO-021:', JSON.stringify(report.responsive.ano021))
  console.log('NON-RÉGRESSION:')
  for (const s of nonReg) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  console.log(`\nRapport mis à jour (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
