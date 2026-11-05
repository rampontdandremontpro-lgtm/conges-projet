import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const FRONT = 'http://localhost:5174'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const PAGES = [['/app/rh-extra-days','extra-days'],['/app/rh-illness-maintenance','illness-maintenance'],['/app/rh-accrual-anomalies','accrual-anomalies']]

async function session(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', () => {})
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email','rh.recette@gmes.fr')
  await page.fill('#login-password','RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  for (const [path,slug] of PAGES) {
    await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}${tag}-${slug}.png`, fullPage: true })
    await page.screenshot({ path: `${OUT}${tag}-${slug}-viewport.png` })
  }
  await page.close()
}

await session(1440, 900, 'after-desktop')
await session(390, 844, 'after-mobile')

await browser.close()
console.log('done ->', OUT)
