// Test UI réel BAL-009 — Admin (Date de sortie) + RH (solde & correction).
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PASSWORD = 'RecetteGMES@2026!'

async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return r.data?.accessToken
}
async function loginPage(browser, email) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(800)
  return page
}
async function go(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  if (await link.count()) {
    await link.click()
  } else {
    const toggle = page.locator('.header__mobile-menu')
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(350) }
    await page.locator(`a[href="${href}"]`).first().click()
  }
  await page.waitForTimeout(700)
}

async function main() {
  const ts = String(Date.now()).slice(-8)
  const report = {
    purpose: 'Retest UI BAL-009 — Admin Date de sortie + RH solde/correction',
    dateRetest: '30/09/2026',
    adminUi: {},
    rhUi: {},
    executed: true,
  }

  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')

  // Setup : service + collaborateur UI-A (arrivée 16/07) + acquisition juillet.
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SRV UI BAL009 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const uiA = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: `BAL009UIA-${ts}`, prenom: 'Recette', email: `bal009-uia.${ts}@gmes.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-07-16' } })).data
  const run = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rh, body: { accrualMonth: '2026-07' } })
  report.setup = { uiAId: uiA.id, serviceId: svc.id, accrualRunStatus: run.status }

  const browser = await chromium.launch({ headless: true })

  // ============ ÉTAPE 14 — UI Admin : Date de sortie ============
  {
    const page = await loginPage(browser, 'admin.recette@gmes.fr')
    await go(page, '/app/admin-users')
    await page.waitForSelector('.admin-users-new', { timeout: 10000 })

    // Création : entrée 01/07 + sortie 15/07
    await page.click('.admin-users-new')
    await page.waitForSelector('.admin-users-form', { timeout: 5000 })
    await page.locator('.admin-users-form input').first().fill('Recette')
    await page.locator('.admin-users-form input').nth(1).fill(`UIBAL-${ts}`)
    await page.locator('.admin-users-form input[type="email"]').fill(`uibal-${ts}@gmes.fr`)
    await page.locator('.admin-users-form input[type="date"]').nth(0).fill('2026-07-01')
    await page.locator('.admin-users-form input[type="date"]').nth(1).fill('2026-07-15')
    // Service (Rôle nth0, Type nth1, Service nth2) — premier service actif.
    const svcSel = page.locator('.admin-users-form select').nth(2)
    await svcSel.selectOption({ index: 1 })
    await page.click('.admin-users-form .admin-users-primary')
    await page.waitForSelector('.admin-users-view', { timeout: 8000 })
    const viewText = await page.locator('.admin-users-view').innerText()
    const createdOk = viewText.toLowerCase().includes('date de sortie') && viewText.includes('15 juillet 2026')
    report.adminUi.create = { ok: createdOk, exitDateVisible: viewText.toLowerCase().includes('date de sortie') }

    // Modifier : sortie → 20/07
    await page.click('.admin-users-view .admin-users-primary')
    await page.waitForSelector('.admin-users-form', { timeout: 5000 })
    await page.locator('.admin-users-form input[type="date"]').nth(1).fill('2026-07-20')
    await page.click('.admin-users-form .admin-users-primary')
    await page.waitForSelector('.admin-users-view', { timeout: 8000 })
    const view2 = await page.locator('.admin-users-view').innerText()
    report.adminUi.edit = { ok: view2.includes('20 juillet 2026'), exitDateShown: view2.includes('20 juillet 2026') }

    // Vider le champ → null
    await page.click('.admin-users-view .admin-users-primary')
    await page.waitForSelector('.admin-users-form', { timeout: 5000 })
    await page.locator('.admin-users-form input[type="date"]').nth(1).fill('')
    await page.click('.admin-users-form .admin-users-primary')
    await page.waitForSelector('.admin-users-view', { timeout: 8000 })
    const view3 = await page.locator('.admin-users-view').innerText()
    report.adminUi.clear = { ok: view3.toLowerCase().includes('date de sortie') && view3.includes('Non renseignée'), exitDateNull: view3.includes('Non renseignée') }

    // Erreur : sortie < entrée
    await page.click('.admin-users-view .admin-users-primary')
    await page.waitForSelector('.admin-users-form', { timeout: 5000 })
    await page.locator('.admin-users-form input[type="date"]').nth(0).fill('2026-07-20')
    await page.locator('.admin-users-form input[type="date"]').nth(1).fill('2026-07-15')
    await page.click('.admin-users-form .admin-users-primary')
    await page.waitForSelector('.admin-users-form__feedback', { timeout: 5000 })
    const feedback = await page.locator('.admin-users-form__feedback').innerText()
    report.adminUi.error = { ok: feedback.includes('ne peut pas être antérieure'), feedback }
    await page.close().catch(() => {})
  }

  // ============ ÉTAPE 16 — UI RH : solde + correction ============
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await go(page, '/app/rh-balances')
    await page.waitForSelector('.rh-balances-row--body', { timeout: 10000 })

    // Sélectionner le collaborateur et la période N
    const empSel = page.locator('.rh-balances-filters select').nth(1)
    await empSel.selectOption({ label: `BAL009UIA-${ts} Recette` })
    await page.waitForTimeout(500)
    const periodSel = page.locator('.rh-balances-filters select').nth(2)
    const periodOptions = await periodSel.locator('option').allInnerTexts()
    const nOption = periodOptions.find((t) => t.includes('01/06/2026'))
    await periodSel.selectOption({ label: nOption })
    await page.waitForTimeout(600)

    const row = page.locator('.rh-balances-row--body').filter({ hasText: `BAL009UIA-${ts}` }).first()
    await row.click()
    await page.waitForSelector('.rh-balances-drawer__body', { timeout: 8000 })
    await page.waitForTimeout(600)
    const summary1 = await page.locator('.rh-balances-summary-card').innerText()
    const acquiredVisible = summary1.includes('1,29')
    report.rhUi.balanceBefore = { ok: acquiredVisible, acquired: '1,29' }

    // Correction +0,21 via UI
    await page.click('.rh-balances-correction-btn')
    await page.waitForSelector('.rh-balances-correction', { timeout: 5000 })
    await page.locator('.rh-balances-correction input[type="number"]').fill('0.21')
    await page.locator('.rh-balances-correction textarea').fill(`Correction UI BAL-009 ${ts}`)
    await page.click('.rh-balances-correction button[type="submit"]')
    await page.waitForTimeout(1200)

    const summary2 = await page.locator('.rh-balances-summary-card').innerText()
    const finalVisible = summary2.includes('1,5')
    report.rhUi.balanceAfter = { ok: finalVisible, acquired: '1,50' }

    // Historique : Acquisition 1,29 + Correction crédit 0,21
    const historyText = await page.locator('.rh-balances-history-card').innerText()
    const hasAcq = historyText.includes('Acquisition') && historyText.includes('+1,29')
    const hasCorr = historyText.includes('Correction crédit') && historyText.includes('+0,21')
    report.rhUi.history = { hasAcquisition129: hasAcq, hasCorrection021: hasCorr, ok: hasAcq && hasCorr }
    await page.close().catch(() => {})
  }

  await browser.close()

  const ok = report.adminUi.create.ok && report.adminUi.edit.ok && report.adminUi.clear.ok && report.adminUi.error.ok && report.rhUi.balanceBefore.ok && report.rhUi.balanceAfter.ok && report.rhUi.history.ok
  report.conclusion = ok ? 'Conforme' : 'Non conforme'

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-bal009-ui.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== RETEST UI BAL-009 ===')
  console.log('adminUi:', JSON.stringify(report.adminUi, null, 1))
  console.log('rhUi:', JSON.stringify(report.rhUi, null, 1))
  console.log('CONCLUSION:', report.conclusion)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1) })
