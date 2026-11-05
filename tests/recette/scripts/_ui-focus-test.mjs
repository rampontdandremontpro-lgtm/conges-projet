import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
await page.waitForTimeout(2500)

// clic souris sur la carte 0 (focus normal), puis Tab pour atteindre la carte 1 (focus clavier)
await page.locator('.rh-kpi').nth(0).click()
await page.keyboard.press('Tab')
await page.waitForTimeout(150)
const focusedEl = await page.evaluate(() => ({ tag: document.activeElement?.tagName, cls: document.activeElement?.className, fv: document.activeElement?.matches(':focus-visible') }))
rec('FOCUS-VISIBLE-TAB', 'Carte 1 reçoit :focus-visible après Tab', focusedEl.cls.includes('rh-kpi') && focusedEl.fv, JSON.stringify(focusedEl))
await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nFOCUS TEST : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
