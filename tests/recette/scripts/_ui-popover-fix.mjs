import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })

async function login(viewport) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', () => {})
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email','rh.recette@gmes.fr')
  await page.fill('#login-password','RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  return page
}
const nav = (page, p) => page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, p)

async function verifyPopover(page, label) {
  const pop = page.locator('.statistic-info-button__popover')
  await pop.waitFor({ timeout: 5000 })
  const box = await pop.boundingBox()
  const vp = page.viewportSize()
  const metrics = await pop.evaluate(el => ({
    scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    title: el.querySelector('.statistic-info-button__popover-head strong')?.textContent.trim(),
    paras: el.querySelectorAll('.statistic-info-button__content p').length,
    closeVisible: (() => { const b = el.querySelector('[data-close]'); const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight })(),
  }))
  const fullyVisible = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1
  const internalScroll = metrics.scrollHeight > metrics.clientHeight + 1
  rec(`${label}-FULLY-VISIBLE`, `${label} : fenêtre entièrement dans le viewport`, fullyVisible, box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)} vp=${vp.width}x${vp.height}` : 'no box')
  rec(`${label}-NOT-CLIPPED`, `${label} : contenu non découpé (pas de scroll forcé caché)`, !internalScroll || metrics.clientHeight > 0, `scroll=${metrics.scrollHeight} client=${metrics.clientHeight}`)
  rec(`${label}-TITLE`, `${label} : titre présent`, (metrics.title ?? '').length > 0, metrics.title)
  rec(`${label}-PARAS`, `${label} : paragraphes présents`, metrics.paras >= 3, `paras=${metrics.paras}`)
  rec(`${label}-CLOSE`, `${label} : bouton de fermeture accessible`, metrics.closeVisible)
  return box
}

// ============ DESKTOP 1440x900 : les 7 boutons ============
const page = await login({ width: 1440, height: 900 })

// ExtraDays : 5 onglets
await nav(page, '/app/rh-extra-days')
await page.waitForTimeout(2200)
for (let n = 1; n <= 5; n++) {
  await page.click(`.rh-tab:nth-child(${n})`)
  await page.waitForTimeout(450)
  await page.click('.rh-panel__title-row .statistic-info-button__trigger')
  await page.waitForTimeout(250)
  await verifyPopover(page, `ED-${n}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

// Illness
await nav(page, '/app/rh-illness-maintenance')
await page.waitForTimeout(2000)
await page.click('.rh-panel__title-row .statistic-info-button__trigger')
await page.waitForTimeout(250)
await verifyPopover(page, 'IM')
await page.keyboard.press('Escape')

// Anomalies (titre)
await nav(page, '/app/rh-accrual-anomalies')
await page.waitForTimeout(2200)
await page.click('.rh-page-hero__title-row .statistic-info-button__trigger')
await page.waitForTimeout(250)
await verifyPopover(page, 'AA')
await page.keyboard.press('Escape')

// ============ Retournement au-dessus (bouton près du bas) ============
// On scrolle la page Anomalies pour amener le titre près du haut? Non: on teste
// le retournement en réduisant la hauteur du viewport + scroll.
const p2 = await login({ width: 1440, height: 560 })
await nav(p2, '/app/rh-extra-days')
await p2.waitForTimeout(2000)
// onglet "Périodes de prise" (court) puis on scrolle pour placer le bouton en bas
await p2.click('.rh-tab:nth-child(3)')
await p2.waitForTimeout(450)
await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await p2.waitForTimeout(300)
const trig = p2.locator('.rh-panel__title-row .statistic-info-button__trigger')
await trig.scrollIntoViewIfNeeded()
await trig.click()
await p2.waitForTimeout(300)
const pop = p2.locator('.statistic-info-button__popover')
const pbox = await pop.boundingBox()
const tbox = await trig.boundingBox()
const above = pbox && tbox && (pbox.y + pbox.height <= tbox.y + 1)
rec('FLIP-ABOVE', 'Retournement au-dessus près du bas de l’écran', !!above, pbox && tbox ? `pop.bottom=${Math.round(pbox.y+pbox.height)} trig.top=${Math.round(tbox.y)}` : '')
await p2.close()

// ============ Petit écran (700px) ============
const p3 = await login({ width: 700, height: 500 })
await nav(p3, '/app/rh-extra-days')
await p3.waitForTimeout(2000)
await p3.click('.rh-tab:nth-child(3)')
await p3.waitForTimeout(400)
await p3.click('.rh-panel__title-row .statistic-info-button__trigger')
await p3.waitForTimeout(300)
await verifyPopover(p3, 'SMALL-700')

// ============ Mobile 390x844 ============
const p4 = await login({ width: 390, height: 844 })
await nav(p4, '/app/rh-illness-maintenance')
await p4.waitForTimeout(2000)
await p4.click('.rh-panel__title-row .statistic-info-button__trigger')
await p4.waitForTimeout(300)
await verifyPopover(p4, 'MOBILE')

await browser.close()
const failed = results.filter(r => !r.ok).length
console.log(`\nPOPOVER FIX : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
