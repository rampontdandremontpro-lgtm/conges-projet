import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'rh.recette@gmes.fr')
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

for (const [href, title] of [['/app/rh-extra-days','Droits supplémentaires'],['/app/rh-illness-maintenance','Maintien de salaire des arrêts maladie'],['/app/rh-accrual-anomalies','Anomalies d’acquisition des congés']]) {
  // navigation mobile : ouvre le menu, clique le lien
  await page.click('a[href="/app/dashboard"]').catch(() => {})
  await page.waitForTimeout(800)
  await page.evaluate((h) => { window.history.pushState({}, '', h); window.dispatchEvent(new PopStateEvent('popstate')) }, href)
  await page.waitForTimeout(1500)
  const h1 = await page.locator('.rh-page-head h1').first().innerText().catch(() => '')
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  rec(`MOBILE-${href.split('/').pop()}`, `Mobile ${href} : header présent sans débordement horizontal`, h1.includes(title) && !overflowX, `h1=${h1} overflow=${overflowX}`)
}
rec('MOBILE-NO-PAGEERROR', 'Aucune erreur de page (mobile)', errors.length === 0, errors.slice(0,2).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\nRH MOBILE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
