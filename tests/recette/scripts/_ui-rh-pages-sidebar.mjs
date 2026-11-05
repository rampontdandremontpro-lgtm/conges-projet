import { chromium } from 'playwright'

const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ headless: true })
const errors = []

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  return page
}

// ── 1. Sidebar scroll RH (faible hauteur) ────────────────────────────────
const small = await newPage(1366, 560)
const nav = small.locator('.sidebar__nav')
const metrics = await nav.evaluate((el) => ({
  overflowY: getComputedStyle(el).overflowY,
  clientHeight: el.clientHeight,
  scrollHeight: el.scrollHeight,
}))
const scrollable = metrics.overflowY === 'auto' || metrics.overflowY === 'scroll'
rec('RH-SIDEBAR-SCROLLABLE', `Sidebar RH scrollable à 560px de haut (overflow=${metrics.overflowY}, scroll=${metrics.scrollHeight} > client=${metrics.clientHeight})`, scrollable && metrics.scrollHeight > metrics.clientHeight, JSON.stringify(metrics))

// scroll jusqu'en bas, vérifie le dernier lien (Notifications)
await nav.evaluate((el) => { el.scrollTop = el.scrollHeight })
await small.waitForTimeout(400)
const notifVisible = await small.locator('a[href="/app/notifications"]').first().isVisible().catch(() => false)
rec('RH-SIDEBAR-LAST-VISIBLE', 'Dernier lien (Notifications) atteignable après scroll', notifVisible)
const reduceVisible = await small.locator('.sidebar__collapse-toggle').first().isVisible().catch(() => false)
rec('RH-SIDEBAR-REDUCE-VISIBLE', 'Bouton Réduire visible en bas', reduceVisible)
await small.close()

// ── 2. Les 3 pages RH redessinées ────────────────────────────────────────
const page = await newPage(1366, 768)
const pagesToCheck = [
  ['/app/rh-extra-days', 'Droits supplémentaires'],
  ['/app/rh-illness-maintenance', 'Maintien de salaire des arrêts maladie'],
  ['/app/rh-accrual-anomalies', 'Anomalies d’acquisition des congés'],
]
for (const [href, title] of pagesToCheck) {
  await page.click(`a[href="${href}"]`).catch(() => {})
  await page.waitForTimeout(1800)
  const h1 = await page.locator('.rh-page-head h1').first().innerText().catch(() => '')
  rec(`RH-PAGE-${href.split('/').pop().toUpperCase()}`, `${href} : en-tête « ${title} » présent`, h1.includes(title), `h1=${h1}`)
}

// ── 3. RH : déclaration d'absence accessible ─────────────────────────────
await page.click('a[href="/app/rh-leaves-absences"]').catch(() => {})
await page.waitForTimeout(2200)
await page.waitForSelector('.rh-events-create', { timeout: 10000 })
await page.click('.rh-events-create')
await page.waitForSelector('.rh-declaration-form', { timeout: 10000 })
rec('RH-ABSENCE-DRAWER', 'RH : formulaire de déclaration d’absence accessible', true)

rec('RH-NO-PAGEERROR', 'Aucune erreur de page', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\nRH PAGES+SIDEBAR : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
