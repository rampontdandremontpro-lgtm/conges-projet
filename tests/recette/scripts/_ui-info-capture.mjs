import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const browser = await chromium.launch({ headless: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

// ExtraDays : chaque onglet avec popover ouvert
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2200)
for (let n=1; n<=5; n++) {
  await page.click(`.rh-tab:nth-child(${n})`)
  await page.waitForTimeout(500)
  await page.click('.rh-panel__title-row .statistic-info-button__trigger')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}info-open-ed-${n}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

// Illness : popover ouvert
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-illness-maintenance')
await page.waitForTimeout(2000)
await page.click('.rh-panel__title-row .statistic-info-button__trigger')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}info-open-im.png` })
await page.keyboard.press('Escape')

// Anomalies : popover ouvert (titre)
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
await page.waitForTimeout(2200)
await page.click('.rh-page-hero__title-row .statistic-info-button__trigger')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}info-open-aa.png` })
await page.close()

await browser.close()
console.log('captures done ->', OUT)
