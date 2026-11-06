import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', () => {})
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'rh.recette@gmes.fr')
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2500)

// Onglet ancienneté (défaut)
const btns = await page.locator('.rh-btn').allInnerTexts()
rec('ED-ANC-BOUTONS', 'Ancienneté : boutons Prévisualiser + Attribuer présents', btns.some(t=>t.includes('Prévisualiser')) && btns.some(t=>t.includes('Attribuer les jours d’ancienneté')), btns.join('|'))
await page.getByRole('button', { name: 'Prévisualiser' }).first().click()
await page.waitForTimeout(2500)
const previewTable = await page.locator('.rh-table').count()
rec('ED-ANC-PREVIEW', 'Prévisualisation ancienneté affiche un tableau', previewTable >= 1, `tables=${previewTable}`)

// Onglet fractionnement
await page.locator('.rh-tab', { hasText: 'Fractionnement' }).click()
await page.waitForTimeout(800)
const fraBtns = await page.locator('.rh-btn').allInnerTexts()
rec('ED-FRA-BOUTONS', 'Fractionnement : boutons Prévisualiser + Attribuer + Recalculer présents', fraBtns.some(t=>t.includes('Attribuer le fractionnement')) && fraBtns.some(t=>t.includes('Recalculer')), fraBtns.join('|'))
await page.getByRole('button', { name: 'Prévisualiser' }).first().click()
await page.waitForTimeout(2500)
const fraTable = await page.locator('.rh-table').count()
rec('ED-FRA-PREVIEW', 'Prévisualisation fractionnement affiche un tableau', fraTable >= 1, `tables=${fraTable}`)
await page.screenshot({ path: 'screenshots/fix-extra-days.png' })

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nUI DROITS SUPPLÉMENTAIRES : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
