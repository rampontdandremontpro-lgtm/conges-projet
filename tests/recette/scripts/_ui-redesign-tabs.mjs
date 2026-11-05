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
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2200)

const tabs = ['Ancienneté','Fractionnement','Périodes de prise','Arrêt maladie / congés','Conventions collectives']
for (let i=0;i<5;i++) {
  await page.click(`.rh-tab:nth-child(${i+1})`)
  await page.waitForTimeout(500)
  const title = await page.locator('.rh-panel__title').first().innerText().catch(()=> '')
  const btns = await page.locator('.rh-panel .rh-btn').count()
  rec(`TAB-${i+1}`, `${tabs[i]} : contenu + actions affichées`, title.length > 0 && btns > 0, `title="${title}" btns=${btns}`)
}

// Illness : champs du formulaire présents
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-illness-maintenance')
await page.waitForTimeout(1800)
const imSelects = await page.locator('.rh-im-section select').count()
const imDates = await page.locator('.rh-im-section input[type=date]').count()
const imText = await page.locator('.rh-im-section textarea').count()
rec('IM-FIELDS', 'Champs formulaire maintien présents', imSelects >= 1 && imDates >= 2 && imText >= 1, `selects=${imSelects} dates=${imDates} textarea=${imText}`)

// Anomalies : actions présentes
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
await page.waitForTimeout(2000)
const aaBtns = await page.locator('.rh-aa-row__actions .rh-btn').count()
rec('AA-ACTIONS', 'Actions d’anomalies présentes', aaBtns > 0, `btns=${aaBtns}`)

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nTABS/CONTENT : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
