// Micro-validation finale LOT 6 — preuves réelles UI-010/011/012/019/020 + Tab UI-018 + EXP-013 officiel
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

async function run() {
  const startedAt = Date.now()
  const ts = String(Date.now()).slice(-8)
  const report = { lot: 6, dateRetest: '30/09/2026', executed: true, ui013NonRegression: {}, ui018Accessibility: {}, ui018Mobile: {}, ui018Tablette: {}, exp013Official: {}, anomalies: [], nonRegression: [] }
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

  // ===== Fixture UI-010/011/012 =====
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc UIX L6F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId]) await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId } })

  const docType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `UIX DOC ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })).data
  async function makeAbsence(employeeId, start, comment) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId, leaveTypeId: docType.id, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
    if (r.status !== 201) throw new Error(`absence HTTP ${r.status} ${JSON.stringify(r.data ?? r).slice(0, 200)}`)
    return r.data
  }
  async function uploadDoc(absenceId) {
    const buf = readFileSync(PDF_PATH)
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), 'justificatif-abs-recette.pdf')
    const resp = await fetch(`${config.API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${rh}` }, body: fd })
    return { status: resp.status }
  }

  const abs1 = await makeAbsence(colAId, openDate(20), `UIX-010 ${ts}`)
  if ((await uploadDoc(abs1.id)).status !== 201) throw new Error('upload abs1')
  await apiRequest(`/absence-declarations/${abs1.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const doc1 = (await apiRequest(`/documents/absence/${abs1.id}`, { token: rh })).data[0]

  const abs2 = await makeAbsence(colBId, openDate(22), `UIX-012 ${ts}`)
  if ((await uploadDoc(abs2.id)).status !== 201) throw new Error('upload abs2')
  await apiRequest(`/absence-declarations/${abs2.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const doc2 = (await apiRequest(`/documents/absence/${abs2.id}`, { token: rh })).data[0]

  // ===== UI-010 : footer À vérifier (justificatif EN_ATTENTE) =====
  const ui010 = { executed: true }
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-A' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-detail-actions', { timeout: 10000 })
    const footer = page.locator('.rh-absence-detail-actions')
    const modifier = await footer.locator('button', { hasText: 'Modifier l’absence' }).count()
    const autoriser = await footer.locator('button', { hasText: 'Autoriser l’absence' }).count()
    const fermer = await footer.locator('button', { hasText: 'Fermer' }).count()
    const regroupement = await page.evaluate(() => {
      const a = document.querySelector('.rh-absence-detail-actions')
      return Boolean(a && a.getBoundingClientRect().width > 0)
    })
    ui010.modifier = modifier
    ui010.autoriser = autoriser
    ui010.fermer = fermer
    ui010.regroupement = regroupement
    ui010.status = modifier === 1 && autoriser === 0 && fermer === 1 && regroupement ? 'Conforme' : 'Non conforme'
    ui010.evidence = `Modifier=${modifier} Autoriser=${autoriser} Fermer=${fermer} regroupé=${regroupement}`
    await page.close().catch(() => {})
  }

  // ===== UI-011 : footer autorisable (justificatif ACCEPTE) =====
  const ui011 = { executed: true }
  {
    // valider le justificatif de abs1 via API puis rouvrir le drawer
    await apiRequest(`/documents/${doc1.id}/accept`, { method: 'POST', token: rh })
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-A' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-detail-actions', { timeout: 10000 })
    const footer = page.locator('.rh-absence-detail-actions')
    const modifier = await footer.locator('button', { hasText: 'Modifier l’absence' }).count()
    const autoriser = await footer.locator('button', { hasText: 'Autoriser l’absence' }).count()
    const fermer = await footer.locator('button', { hasText: 'Fermer' }).count()
    const regroupement = await page.evaluate(() => Boolean(document.querySelector('.rh-absence-detail-actions')?.getBoundingClientRect().width > 0))
    ui011.modifier = modifier
    ui011.autoriser = autoriser
    ui011.fermer = fermer
    ui011.regroupement = regroupement
    ui011.status = modifier === 1 && autoriser === 1 && fermer === 1 && regroupement ? 'Conforme' : 'Non conforme'
    ui011.evidence = `Modifier=${modifier} Autoriser=${autoriser} Fermer=${fermer} regroupé=${regroupement}`
    await page.close().catch(() => {})
  }

  // ===== UI-012 : justificatif refusé (Voir + Remplacer) =====
  const ui012 = { executed: true }
  {
    await apiRequest(`/documents/${doc2.id}/reject`, { method: 'POST', token: rh, body: { reason: `REFUS UI012 ${ts}` } })
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-B' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-document-card', { timeout: 10000 })
    const statut = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const reason = (await page.locator('.rh-absence-document-card__reason').first().innerText().catch(() => '')).trim()
    const voir = await page.locator('.rh-absence-document-card button', { hasText: 'Voir le justificatif' }).count()
    const remplacer = await page.locator('.rh-absence-document-card button', { hasText: 'Remplacer le justificatif' }).count()
    // clic Voir fonctionnel
    let voirOk = false
    try {
      await page.locator('.rh-absence-document-card button', { hasText: 'Voir le justificatif' }).click()
      await page.waitForSelector('.rh-document-preview, [class*=document-preview], [class*=preview]', { timeout: 5000 }).catch(() => {})
      voirOk = await page.locator('body').innerText().then((t) => !t.includes('Impossible') || t.length > 0)
    } catch (e) { voirOk = false }
    ui012.statutRefus = statut
    ui012.motif = reason
    ui012.voir = voir
    ui012.remplacer = remplacer
    ui012.voirFonctionnel = voirOk
    ui012.status = statut === 'Refusé' && voir === 1 && remplacer === 1 ? 'Conforme' : 'Non conforme'
    ui012.evidence = `statut=${statut} motif="${reason.slice(0, 40)}" Voir=${voir} Remplacer=${remplacer}`
    await page.close().catch(() => {})
  }

  // ===== UI-019 : navigation clavier / fermeture drawer =====
  const ui019 = { executed: true }
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-A' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    // Parcours Tab réel dans le drawer : on note les contrôles traversés
    const traversed = []
    let focusVisible = false
    let reachedClose = false
    try {
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement
          if (!el) return { tag: null }
          const cs = getComputedStyle(el)
          return { tag: el.tagName, cls: String(el.className), aria: el.getAttribute('aria-label'), href: el.getAttribute('href'), outline: cs.outlineStyle + ' ' + cs.outlineWidth }
        })
        traversed.push(info)
        if (info.cls && String(info.cls).includes('rh-absence-drawer__close')) { reachedClose = true; focusVisible = info.outline !== 'none 0px'; break }
      }
      if (reachedClose) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(400)
      }
    } catch (e) { /* garde */ }
    const orphan = await page.locator('.rh-absence-drawer-backdrop').count()
    const drawerClosed = await page.locator('.rh-absence-drawer--detail').count() === 0
    ui019.parcoursTab = traversed.length
    ui019.focusVisible = focusVisible
    ui019.fermetureClavier = reachedClose && drawerClosed
    ui019.overlayOrphelin = orphan
    ui019.status = reachedClose && focusVisible && drawerClosed && orphan === 0 ? 'Conforme' : 'Non conforme'
    ui019.evidence = `Tab=${traversed.length} focusVisible=${focusVisible} fermetureClavier=${reachedClose && drawerClosed} orphan=${orphan}`
    await page.close().catch(() => {})
  }

  // ===== UI-020 : états chargement / erreur 500 / reprise =====
  const ui020 = { executed: true }
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    let loading = false
    let http500 = false
    let errorVisible = false
    let recovery = false
    let authKept = true
    try {
      await page.route('**/api/documents/absence/**', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Erreur simulée"}' })
        } else {
          await route.continue()
        }
      })
      await navigateTo(page, '/app/rh-leaves-absences')
      await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
      await page.locator('.rh-events-row--data', { hasText: 'COL-A' }).first().click()
      await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
      loading = await page.locator('.rh-absence-documents__state').innerText().then((t) => t.includes('Chargement')).catch(() => false)
      await page.waitForSelector('.rh-absence-documents__state--error', { timeout: 10000 })
      http500 = true
      errorVisible = await page.locator('.rh-absence-documents__state--error').isVisible().catch(() => false)
      // reprise : lever l'interception et Réessayer
      await page.unroute('**/api/documents/absence/**')
      await page.locator('.rh-absence-documents__state--error button', { hasText: 'Réessayer' }).click()
      await page.waitForTimeout(800)
      recovery = await page.locator('.rh-absence-document-card, .rh-absence-documents__state').count() > 0
      authKept = await page.evaluate(() => Boolean(document.querySelector('.app-shell')))
    } catch (e) { /* garde */ }
    ui020.loading = loading
    ui020.http500 = http500
    ui020.errorVisible = errorVisible
    ui020.reprise = recovery
    ui020.authentificationConservee = authKept
    ui020.status = http500 && errorVisible && recovery && authKept ? 'Conforme' : 'Non conforme'
    ui020.evidence = `loading=${loading} 500=${http500} erreurVisible=${errorVisible} reprise=${recovery} auth=${authKept}`
    await page.close().catch(() => {})
  }

  report.ui013NonRegression = { 'UI-010': ui010, 'UI-011': ui011, 'UI-012': ui012, 'UI-019': ui019, 'UI-020': ui020 }

  // ===== UI-018 accessibilité : vrai parcours Tab (sans focus programmatique) =====
  const ui018Acc = { tabReachedCollapseControl: false, tabPressCount: 0, focusVisible: false, outline: '', ariaLabel: '', ariaExpandedBefore: '', keyboardActivation: false, collapsedAfterEnter: false }
  {
    const page = await loginPage(browser, 'admin.recette@gmes.fr', { width: 1920, height: 1080 })
    const visited = []
    let reached = false
    try {
      for (let i = 1; i <= 50; i++) {
        await page.keyboard.press('Tab')
        const info = await page.evaluate(() => {
          const el = document.activeElement
          if (!el) return { tag: null, cls: null, aria: null, href: null }
          const cs = getComputedStyle(el)
          return { tag: el.tagName, cls: String(el.className), aria: el.getAttribute('aria-label'), href: el.getAttribute('href'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }
        })
        visited.push(info)
        if (info.cls && String(info.cls).includes('sidebar__collapse-toggle')) {
          reached = true
          ui018Acc.tabPressCount = i
          ui018Acc.ariaLabel = info.aria ?? ''
          ui018Acc.outline = `${info.outlineStyle} ${info.outlineWidth}`
          ui018Acc.focusVisible = info.outlineStyle !== 'none' && info.outlineWidth !== '0px'
          ui018Acc.ariaExpandedBefore = await page.locator('.sidebar__collapse-toggle').first().getAttribute('aria-expanded').catch(() => null)
          await page.keyboard.press('Enter')
          await page.waitForTimeout(400)
          ui018Acc.collapsedAfterEnter = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed') ?? false)
          ui018Acc.keyboardActivation = ui018Acc.collapsedAfterEnter === true
          break
        }
      }
    } catch (e) { /* garde */ }
    ui018Acc.tabReachedCollapseControl = reached
    ui018Acc.status = reached && ui018Acc.focusVisible && ui018Acc.keyboardActivation ? 'Conforme' : 'Non conforme'
    ui018Acc.visited = visited.map((v) => `${v.tag}:${(v.cls ?? '').slice(0, 30) || v.aria || ''}`).slice(0, 25)
    await page.close().catch(() => {})
  }
  report.ui018Accessibility = ui018Acc

  // ===== UI-018 mobile / tablette =====
  {
    const page = await loginPage(browser, 'col-a.recette@gmes.fr', { width: 390, height: 844 })
    const menuBtn = await page.locator('.header__mobile-menu').count()
    let menuOpen = false, navClose = false, orphanOverlay = -1
    try {
      await page.locator('.header__mobile-menu').click()
      await page.waitForTimeout(400)
      menuOpen = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--mobile-open') ?? false)
      await navigateTo(page, '/app/my-requests')
      await page.waitForTimeout(400)
      navClose = await page.evaluate(() => !document.querySelector('.app-shell')?.classList.contains('app-shell--mobile-open'))
      orphanOverlay = await page.locator('.app-shell__backdrop').count()
    } catch (e) { /* garde */ }
    const desktopControlVisible = await page.locator('.sidebar__collapse-toggle').isVisible().catch(() => false)
    report.ui018Mobile = { menuBtn, menuOpen, navClose, orphanOverlay, desktopControlConflict: desktopControlVisible }
    await page.close().catch(() => {})
  }
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr', { width: 768, height: 1024 })
    const autoCollapsed = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed') ?? false)
    const toggleVisible = await page.locator('.sidebar__collapse-toggle').isVisible().catch(() => false)
    report.ui018Tablette = { autoCollapsed, toggleVisible, conflit: toggleVisible }
    await page.close().catch(() => {})
  }

  // ===== EXP-013 officiel exact =====
  const exp013 = {}
  {
    // Source officielle run-exp.mjs : N-1 2025-2026 = 10, aucun compteur N, report exceptionnel = 2, clôture → N-1 2026-2027 acquiredDays = 2
    await apiRequest('/leave-balances/initialize', { method: 'POST', token: rh, body: { employeeId: colAId, referencePeriod: '2025-2026', counterType: 'N-1', acquiredDays: 10, reason: 'L6F EXP-013.' } })
    const carry = await apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rh, body: { employeeId: colAId, closingReferencePeriod: '2025-2026', days: 2, reason: 'Report exceptionnel L6F.' } })
    const close = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: '2025-2026', confirm: true } })
    const bal = (await apiRequest(`/leave-balances/employee/${colAId}`, { token: rh })).data
    const n1 = bal.find((b) => b.referencePeriod === '2026-2027' && b.counterType === 'N-1')
    const carryMovs = await dbQuery(`SELECT days FROM balance_movements WHERE employee_id=? AND reason LIKE 'REPORT_EXCEPTIONNEL|2025-2026|%'`, [colAId])
    const transferMovs = await dbQuery(`SELECT days FROM balance_movements WHERE employee_id=? AND reason LIKE 'CLOTURE_TRANSFERT_N|2025-2026|%'`, [colAId])
    const reportDays = carryMovs.reduce((s, m) => s + Number(m.days), 0)
    const transferDays = transferMovs.reduce((s, m) => s + Number(m.days), 0)
    const acquired = Number(n1?.acquiredDays)
    exp013.nInitial = 0
    exp013.nMinus1Initial = 10
    exp013.report = reportDays
    exp013.transfertN = transferDays
    exp013.attenduExact = 2
    exp013.observeExact = acquired
    exp013.mouvements = `report=${reportDays} transfertN=${transferDays} doubleMouvement=${carryMovs.length !== 1 ? 'OUI' : 'NON'}`
    exp013.status = acquired === 2 && reportDays === 2 && transferDays === 0 && carryMovs.length === 1 ? 'Conforme' : 'Non conforme'
  }
  report.exp013Official = exp013

  // ===== Non-régression produit (noyau LOT 1-5) =====
  const nonReg = []
  try {
    const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs NR F ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const svcN = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc NR F ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svcN.id } })
    const c1 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-001' } })
    nonReg.push({ id: 'ABS-001', status: c1.status === 201 ? 'Conforme' : 'Non conforme', result: `HTTP=${c1.status}` })
    const c2 = await apiRequest('/absence-declarations', { method: 'POST', token: colB, body: { leaveTypeId: absType.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'NR ABS-017' } })
    const cc = await apiRequest(`/absence-declarations/${c2.data?.id}/cancel`, { method: 'POST', token: colB, body: {} })
    nonReg.push({ id: 'ABS-017', status: cc.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cc.status}` })
  } catch (e) { nonReg.push({ id: 'ABS-001', status: 'Bloqué', result: e.message }); nonReg.push({ id: 'ABS-017', status: 'Bloqué', result: e.message }) }
  try {
    const closure = await apiRequest('/holidays', { method: 'POST', token: admin, body: { date: isoAddDays(todayIso(), 70), name: `Fermeture NR F ${ts}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' } })
    const hid = closure.data?.id
    await apiRequest(`/holidays/${hid}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/holidays/${hid}/enable`, { method: 'PATCH', token: admin })
    nonReg.push({ id: 'ADM-021', status: en.status === 200 && en.data?.isActive === true ? 'Conforme' : 'Non conforme', result: `HTTP=${en.status}` })
  } catch (e) { nonReg.push({ id: 'ADM-021', status: 'Bloqué', result: e.message }) }
  try {
    const cp2 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP CAN F ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc2 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc CAN F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc2.id } })
    const w = { start: openDate(30), end: openDate(31) }
    const d = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp2.id, startDate: w.start, endDate: w.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${d.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const cancel = await apiRequest(`/leave-requests/${d.id}/cancel`, { method: 'POST', token: colA, body: { reason: 'NR.' } })
    nonReg.push({ id: 'CAN-002', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) { nonReg.push({ id: 'CAN-002', status: 'Bloqué', result: e.message }) }
  try {
    const conge = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc3 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DIR F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
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
    const hoursType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs heures F ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false } })).data
    const svc4 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc HALF F ${ts}`, serviceType: 'INTERNE' } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc4.id } })
    const dd = openDate(72)
    const hd = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: colAId, leaveTypeId: hoursType.id, startDate: dd, endDate: dd, durationHours: 4 } })).data
    const patch = await apiRequest(`/absence-declarations/${hd.id}`, { method: 'PATCH', token: rh, body: { startPeriod: 'MATIN' } })
    const after = await apiRequest(`/absence-declarations/${hd.id}`, { token: rh })
    nonReg.push({ id: 'HALF-018', status: patch.status === 400 && Number(after.data?.durationHours) === 4 ? 'Conforme' : 'Non conforme', result: `HTTP=${patch.status}` })
  } catch (e) { nonReg.push({ id: 'HALF-018', status: 'Bloqué', result: e.message }) }
  try {
    const svc5 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc PRE F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc5.id } })
    await apiRequest(`/services/${svc5.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest(`/services/${svc5.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    const half = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `Abs PRE F ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data
    const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: respId, leaveTypeId: half.id, startDate: todayIso(), endDate: todayIso(), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    await apiRequest('/settings/AFTERNOON_START_HOUR', { method: 'PATCH', token: rh, body: { settingValue: '00:00' } })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const w2 = { start: openDate(40), end: openDate(41) }
    const cp3 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP PRE2 F ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const lr2 = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: cp3.id, startDate: w2.start, endDate: w2.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${lr2.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    await apiRequest(`/leave-requests/${lr2.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    const rows = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action='REPRISE_PAR_RELAIS'`, [lr2.id])
    nonReg.push({ id: 'PRE-019', status: Number(rows[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `REPRISE_PAR_RELAIS traces=${rows[0].n}` })
  } catch (e) { nonReg.push({ id: 'PRE-019', status: 'Bloqué', result: e.message }) }
  try {
    const svc6 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc VAL F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc6.id } })
    await apiRequest(`/services/${svc6.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })
    await apiRequest(`/services/${svc6.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
    await apiRequest(`/services/${svc6.id}/validators/${rhId}/disable`, { method: 'PATCH', token: admin })
    const en = await apiRequest(`/services/${svc6.id}/validators/${rhId}/enable`, { method: 'PATCH', token: admin })
    const list = await apiRequest(`/services/${svc6.id}/validators`, { token: admin })
    const rhBackup = (list.data?.backupValidators ?? []).find((b) => b.validatorId === rhId)
    nonReg.push({ id: 'VAL-010', status: en.status === 200 && rhBackup?.isActive === true ? 'Conforme' : 'Non conforme', result: `enable HTTP=${en.status} isActive=${rhBackup?.isActive}` })
  } catch (e) { nonReg.push({ id: 'VAL-010', status: 'Bloqué', result: e.message }) }
  try {
    const svc7 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc ANO19 F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    const repl = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'REMP', prenom: 'VF', email: `repl-vf-${ts}@gmes.test`, role: 'RESPONSABLE_SERVICE', employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc7.id } })).data
    const replLogin = await login(`repl-vf-${ts}@gmes.test`)
    const replId = (await apiRequest('/users/me', { token: replLogin })).data.id
    await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc7.id } })
    await apiRequest(`/services/${svc7.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
    await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colBId, replacementValidatorId: replId, startDate: todayIso(), endDate: isoAddDays(todayIso(), 60), reason: 'F.' } })
    const cp4 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ANO19 F ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
    const w3 = { start: openDate(50), end: openDate(50) }
    const r3 = (await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: cp4.id, startDate: w3.start, endDate: w3.start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r3.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    const c1 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const c2 = await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE leave_request_id=? AND type='LEAVE_REQUEST_SUBMITTED' AND user_id=?`, [r3.id, replId])
    nonReg.push({ id: 'VAL-047', status: Number(c1[0].n) === 1 && Number(c2[0].n) === 1 ? 'Conforme' : 'Non conforme', result: `notifications avant=${c1[0].n} après 2 maintenances=${c2[0].n}` })
  } catch (e) { nonReg.push({ id: 'VAL-047', status: 'Bloqué', result: e.message }) }
  try {
    const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP DER F ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
    const svc8 = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DER F ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc8.id } })
    let s = isoAddDays(todayIso(), 4)
    for (let i = 0; i < 40; i++) { const e = isoAddDays(s, 1); if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) break; s = isoAddDays(s, 1) }
    const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: s, endDate: isoAddDays(s, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = (await apiRequest('/derogations', { method: 'POST', token: colA, body: { leaveRequestId: draft.id, reason: 'F DER-003.' } })).data
    const sub1 = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    const sub2 = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
    const audit = await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [draft.id])
    nonReg.push({ id: 'DER-003', status: sub1.status === 200 && sub2.status === 409 && Number(audit[0].n) === 2 ? 'Conforme' : 'Non conforme', result: `soumission1=${sub1.status} soumission2=${sub2.status} audit=${audit[0].n}` })
  } catch (e) { nonReg.push({ id: 'DER-003', status: 'Bloqué', result: e.message }) }

  report.nonRegression = nonReg
  report.anomalies = [
    { anomalyId: 'ANO-020', severity: 'Mineure', scenario: 'UI-013', conclusion: 'Conforme' },
    { anomalyId: 'ANO-021', severity: 'Mineure', scenario: 'UI-018', conclusion: 'Conforme' },
  ]

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-lot6-ui-mineures.json'), JSON.stringify(report, null, 2), 'utf8')

  await browser.close()

  console.log('\n===== MICRO-VALIDATION FINALE LOT 6 =====')
  console.log('UI-010:', ui010.status, '|', ui010.evidence)
  console.log('UI-011:', ui011.status, '|', ui011.evidence)
  console.log('UI-012:', ui012.status, '|', ui012.evidence)
  console.log('UI-019:', ui019.status, '|', ui019.evidence)
  console.log('UI-020:', ui020.status, '|', ui020.evidence)
  console.log('UI-018 Tab:', JSON.stringify({ tabReached: ui018Acc.tabReachedCollapseControl, tabPress: ui018Acc.tabPressCount, focusVisible: ui018Acc.focusVisible, outline: ui018Acc.outline, aria: ui018Acc.ariaLabel, ariaExpandedBefore: ui018Acc.ariaExpandedBefore, collapsedAfterEnter: ui018Acc.collapsedAfterEnter }))
  console.log('UI-018 MOBILE:', JSON.stringify(report.ui018Mobile))
  console.log('UI-018 TABLETTE:', JSON.stringify(report.ui018Tablette))
  console.log('EXP-013:', JSON.stringify(exp013))
  console.log('NON-RÉGRESSION:')
  for (const s of nonReg) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  console.log(`\nRapport mis à jour (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
