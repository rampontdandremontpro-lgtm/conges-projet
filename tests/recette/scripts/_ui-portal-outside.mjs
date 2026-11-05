import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e)))
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

// clic extérieur ferme le popover (composant portal)
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2200)
await page.click('.rh-panel__title-row .statistic-info-button__trigger')
await page.waitForTimeout(250)
rec('OUTSIDE-OPEN', 'Popover ouvert (portal)', (await page.locator('.statistic-info-button__popover').count()) === 1)
await page.mouse.click(40, 700)
await page.waitForTimeout(250)
rec('OUTSIDE-CLOSE', 'Clic extérieur ferme le popover', (await page.locator('.statistic-info-button__popover').count()) === 0)

// dashboard RH : le composant partagé ne doit pas casser
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/dashboard')
await page.waitForTimeout(4000)
rec('DASH-NO-ERROR', 'Dashboard RH : aucune erreur de page (composant partagé)', errs.length === 0, errs.slice(0,2).join(' | '))

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nPORTAL OUTSIDE : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
