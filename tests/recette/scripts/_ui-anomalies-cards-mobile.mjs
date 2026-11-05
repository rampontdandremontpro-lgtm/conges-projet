import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const browser = await chromium.launch({ headless: true })

// ===== Mobile 390x844 =====
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', () => {})
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
await page.waitForTimeout(2500)
rec('MOBILE-NO-TABS', 'Mobile : barre d’onglets supprimée', (await page.locator('.rh-tabs').count()) === 0)
rec('MOBILE-KPI-3', 'Mobile : 3 cartes présentes', (await page.locator('.rh-kpi').count()) === 3)
// les cartes s'empilent verticalement
const k0 = await page.locator('.rh-kpi').nth(0).boundingBox()
const k1 = await page.locator('.rh-kpi').nth(1).boundingBox()
rec('MOBILE-STACK', 'Mobile : cartes empilées verticalement', k1.y >= k0.y + k0.height - 2, `k0.bottom=${Math.round(k0.y+k0.height)} k1.top=${Math.round(k1.y)}`)
await page.locator('.rh-kpi').nth(2).click(); await page.waitForTimeout(400)
rec('MOBILE-CLICK', 'Mobile : clic carte Résolues fonctionne', (await page.locator('.rh-kpi').nth(2).getAttribute('aria-pressed')) === 'true')
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
rec('MOBILE-NO-HSCROLL', 'Mobile : pas de débordement horizontal', !overflow)
await page.screenshot({ path: 'screenshots/fix-cards-mobile.png' })
await page.close()

// ===== Focus visible + captures des 3 états =====
const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page2.on('pageerror', () => {})
await page2.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page2.fill('#login-email','rh.recette@gmes.fr')
await page2.fill('#login-password','RecetteGMES@2026!')
await page2.click('.login-submit')
await page2.waitForURL('**/app/**', { timeout: 15000 })
await page2.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
await page2.waitForTimeout(2500)
// focus clavier sur la carte 2 → :focus-visible doit être actif
await page2.locator('.rh-kpi').nth(1).focus()
const focusVisible = await page2.locator('.rh-kpi').nth(1).evaluate(el => el.matches(':focus-visible'))
rec('FOCUS-VISIBLE', 'État focus visible au clavier', focusVisible)
// captures des 3 états sélectionnés
for (let i=0;i<3;i++) {
  await page2.locator('.rh-kpi').nth(i).click(); await page2.waitForTimeout(400)
  await page2.screenshot({ path: `screenshots/fix-cards-state-${i+1}.png` })
}
await page2.close()

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nANOMALIES CARDS MOBILE/FOCUS : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
