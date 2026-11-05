import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', () => {})
// Mock : état vide (aucune donnée) sans écrire en base.
await page.route('**/api/illness-maintenance**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.route('**/api/leave-balances/accrual-anomalies**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

for (const [path,slug] of [['/app/rh-illness-maintenance','illness-empty'],['/app/rh-accrual-anomalies','anomalies-empty']]) {
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForTimeout(1800)
  const emptyVisible = await page.locator('.rh-empty').first().isVisible().catch(()=>false)
  const emptyTitle = await page.locator('.rh-empty strong').first().innerText().catch(()=> '')
  console.log(`${slug}: empty visible=${emptyVisible}, title="${emptyTitle}"`)
  await page.screenshot({ path: `${OUT}after-desktop-${slug}.png` })
  await page.screenshot({ path: `${OUT}after-desktop-${slug}-viewport.png` })
}
await browser.close()
console.log('done')
