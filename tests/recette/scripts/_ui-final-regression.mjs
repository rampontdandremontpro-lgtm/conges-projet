import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => results.push({id:'err',name:'pageerror',ok:false,detail:String(e)}))
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
const nav = p => page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, p)

// ExtraDays
await nav('/app/rh-extra-days'); await page.waitForTimeout(2200)
rec('ED-NO-INTRO', 'ED : intro supprimée', (await page.locator('.rh-page-hero__body p').count()) === 0)
rec('ED-NO-NOTE', 'ED : 2 encarts supprimés', (await page.locator('.rh-note').count()) === 0, `notes=${await page.locator('.rh-note').count()}`)
rec('ED-NO-SUB', 'ED : sous-titres supprimés', (await page.locator('.rh-panel__sub').count()) === 0, `subs=${await page.locator('.rh-panel__sub').count()}`)
rec('ED-TABS-5', 'ED : 5 onglets', (await page.locator('.rh-tab').count()) === 5)
rec('ED-INFO-5', 'ED : 5 boutons « i » (sur les 5 onglets)', await page.evaluate(async () => {
  for (let i=1;i<=5;i++){ document.querySelectorAll('.rh-tab')[i-1].click(); await new Promise(r=>setTimeout(r,400)); if(!document.querySelector('.rh-panel__title-row .statistic-info-button__trigger')) return false }
  return true
}))

// Illness
await nav('/app/rh-illness-maintenance'); await page.waitForTimeout(2000)
rec('IM-TITLE', 'IM : titre « Maintien de salaire et arrêts maladie »', (await page.locator('.rh-page-hero h1').innerText()) === 'Maintien de salaire et arrêts maladie')
const sb = await page.locator('.sidebar').innerText()
rec('IM-SIDEBAR', 'IM : sidebar renommé', sb.includes('Maintien de salaire et arrêts maladie') && !sb.includes('Maintien de salaire (maladie)'))
rec('IM-NO-INTRO', 'IM : intro supprimée', (await page.locator('.rh-page-hero__body p').count()) === 0)

// Anomalies
await nav('/app/rh-accrual-anomalies'); await page.waitForTimeout(2200)
const bt = await page.evaluate(() => document.body.innerText)
rec('AA-NO-INTRO', 'AA : intro supprimée', !bt.includes('Chevauchements contradictoires'))
rec('NO-JUR', 'Aucun code JUR affiché', !/JUR-\d/.test(bt))
rec('NO-PAGEERROR', 'Aucune erreur de page', (await page.locator('.rh-page-hero').count()) > 0)

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nFINAL REGRESSION : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
