import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
const viewports = [[1440,900,'100%'],[1800,1125,'80%'],[390,844,'mobile']]
for (const [w,h,label] of viewports) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email','rh.recette@gmes.fr')
  await page.fill('#login-password','RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  for (const [path,slug] of [['/app/rh-extra-days','ed'],['/app/rh-illness-maintenance','im'],['/app/rh-accrual-anomalies','aa']]) {
    await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
    await page.waitForTimeout(1800)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    const heroVisible = await page.locator('.rh-page-hero').first().isVisible().catch(()=>false)
    rec(`${label}-${slug}-no-hscroll`, `${label} ${path}: pas de débordement horizontal`, !overflow, `sw=${await page.evaluate(()=>document.documentElement.scrollWidth)} cw=${await page.evaluate(()=>document.documentElement.clientWidth)}`)
    rec(`${label}-${slug}-hero`, `${label} ${path}: hero visible`, heroVisible)
  }
  rec(`${label}-no-error`, `${label}: aucune erreur de page`, errors.length===0, errors.slice(0,2).join(' | '))
  await page.close()
}
await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nRESPONSIVE : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
