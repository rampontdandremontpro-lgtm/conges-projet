import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
// desktop : fermeture au clic extérieur
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2000)
await page.click('.rh-panel__title-row .statistic-info-button__trigger')
await page.waitForTimeout(250)
rec('OUTSIDE-OPEN', 'Popover ouvert', (await page.locator('.statistic-info-button__popover').count()) === 1)
await page.mouse.click(30, 500) // clic extérieur (haut-gauche, hors popover)
await page.waitForTimeout(250)
rec('OUTSIDE-CLOSE', 'Fermeture au clic extérieur', (await page.locator('.statistic-info-button__popover').count()) === 0)
await page.close()

// mobile : popover centré, pas de débordement
const m = await browser.newPage({ viewport: { width: 390, height: 844 } })
await m.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await m.fill('#login-email','rh.recette@gmes.fr')
await m.fill('#login-password','RecetteGMES@2026!')
await m.click('.login-submit')
await m.waitForURL('**/app/**', { timeout: 15000 })
await m.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-illness-maintenance')
await m.waitForTimeout(2000)
await m.click('.rh-panel__title-row .statistic-info-button__trigger')
await m.waitForTimeout(300)
const box = await m.locator('.statistic-info-button__popover').boundingBox().catch(()=> null)
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
rec('MOBILE-POPOVER-VISIBLE', 'Popover visible sur mobile', box !== null)
rec('MOBILE-NO-HSCROLL', 'Pas de débordement horizontal mobile', !overflow)
rec('MOBILE-POPOVER-IN-VIEW', 'Popover dans la fenêtre', box ? (box.x >= 0 && box.x + box.width <= 390) : false, box ? JSON.stringify({x:Math.round(box.x), w:Math.round(box.width)}) : '')
await m.screenshot({ path: 'screenshots/mobile-info-im.png' })
await m.close()

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nINFO MOBILE : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
