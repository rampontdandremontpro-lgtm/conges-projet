import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const browser = await chromium.launch({ headless: true })

async function sess(viewport, tag) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', () => {})
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email','rh.recette@gmes.fr')
  await page.fill('#login-password','RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  const nav = p => page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, p)
  return { page, nav }
}

// Desktop : les 7 popovers ouverts + pages
{
  const { page, nav } = await sess({ width: 1440, height: 900 }, 'desktop')
  await nav('/app/rh-extra-days'); await page.waitForTimeout(2200)
  for (let n=1;n<=5;n++) {
    await page.click(`.rh-tab:nth-child(${n})`); await page.waitForTimeout(400)
    await page.click('.rh-panel__title-row .statistic-info-button__trigger'); await page.waitForTimeout(280)
    await page.screenshot({ path: `${OUT}fix-popover-ed-${n}.png` })
    await page.keyboard.press('Escape'); await page.waitForTimeout(120)
  }
  await nav('/app/rh-illness-maintenance'); await page.waitForTimeout(2000)
  await page.click('.rh-panel__title-row .statistic-info-button__trigger'); await page.waitForTimeout(280)
  await page.screenshot({ path: `${OUT}fix-popover-im.png` }); await page.keyboard.press('Escape')
  await nav('/app/rh-accrual-anomalies'); await page.waitForTimeout(2200)
  await page.click('.rh-page-hero__title-row .statistic-info-button__trigger'); await page.waitForTimeout(280)
  await page.screenshot({ path: `${OUT}fix-popover-aa.png` }); await page.keyboard.press('Escape')
  // page anomalies complète (spacing 24px)
  await page.screenshot({ path: `${OUT}fix-aa-full.png`, fullPage: true })
  await page.close()
}

// Mobile : un popover ouvert
{
  const { page, nav } = await sess({ width: 390, height: 844 }, 'mobile')
  await nav('/app/rh-illness-maintenance'); await page.waitForTimeout(2000)
  await page.click('.rh-panel__title-row .statistic-info-button__trigger'); await page.waitForTimeout(280)
  await page.screenshot({ path: `${OUT}fix-popover-mobile.png` })
  await page.close()
}

await browser.close()
console.log('captures OK ->', OUT)
