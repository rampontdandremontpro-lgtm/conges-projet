import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
// simule différents zooms par des largeurs/hauteurs CSS différentes
const viewports = [
  [1280, 800],   // 100% ~
  [1093, 683],   // 125% ~
  [1600, 1000],  // 80% ~
  [1910, 1194],  // 67% ~
]
for (const [w, h] of viewports) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const nav = page.locator('.sidebar__nav')
  const m = await nav.evaluate((el) => ({ oy: getComputedStyle(el).overflowY, ch: el.clientHeight, sh: el.scrollHeight }))
  const needScroll = m.sh > m.ch + 2
  const ok = (m.oy === 'auto' || m.oy === 'scroll') && (!needScroll || m.sh > m.ch)
  // scroll bas + vérifie Notifications
  await nav.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(300)
  const lastVisible = await page.locator('a[href="/app/notifications"]').first().isVisible().catch(() => false)
  rec(`SCROLL-${w}x${h}`, `Zoom simulé ${w}x${h} : scroll autonome + dernier lien accessible`, ok && lastVisible, JSON.stringify(m))
  await page.close()
}
await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\nSIDEBAR SCROLL MULTI : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
