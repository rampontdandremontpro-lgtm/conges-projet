import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })

async function loginAndGo(mockEmpty) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', () => {})
  if (mockEmpty) await page.route('**/api/leave-balances/accrual-anomalies**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email','rh.recette@gmes.fr')
  await page.fill('#login-password','RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
  await page.waitForTimeout(2500)
  return page
}

// --- Avec données (base recette) ---
const page = await loginAndGo(false)
const bodyText = await page.evaluate(() => document.body.innerText)
rec('AA-NO-INTRO', 'Paragraphe « Chevauchements contradictoires… » absent', !bodyText.includes('Chevauchements contradictoires'))
rec('AA-INFO-PRESENT', 'Bouton « i » à droite du titre', (await page.locator('.rh-page-hero__title-row .statistic-info-button__trigger').count()) === 1)
rec('AA-INFO-SAME-LINE', 'Bouton « i » aligné sur la ligne du titre', await page.evaluate(() => {
  const h1 = document.querySelector('.rh-page-hero__title-row h1')
  const b = document.querySelector('.rh-page-hero__title-row .statistic-info-button__trigger')
  if (!h1 || !b) return false
  return Math.abs(h1.getBoundingClientRect().top - b.getBoundingClientRect().top) < 20
}))

const kpis = await page.locator('.rh-kpis').boundingBox()
const tabs = await page.locator('.rh-tabs').boundingBox()
const list = await page.locator('.rh-aa-list').first().boundingBox()
const gap1 = tabs.y - (kpis.y + kpis.height)
const gap2 = list.y - (tabs.y + tabs.height)
rec('AA-GAP-1-DATA', 'Avec données : cartes→onglets ≈ 24px', gap1 >= 22 && gap1 <= 26, `gap=${Math.round(gap1)}px`)
rec('AA-GAP-2-DATA', 'Avec données : onglets→liste ≈ 24px', gap2 >= 22 && gap2 <= 26, `gap=${Math.round(gap2)}px`)
rec('AA-KPI-3', '3 cartes de synthèse', (await page.locator('.rh-kpi').count()) === 3)
await page.screenshot({ path: 'screenshots/fix-aa-desktop.png' })
await page.close()

// --- État vide (mock) ---
const p2 = await loginAndGo(true)
const eK = await p2.locator('.rh-kpis').boundingBox()
const eT = await p2.locator('.rh-tabs').boundingBox()
const eP = await p2.locator('.rh-panel').boundingBox()
const g1 = eT.y - (eK.y + eK.height)
const g2 = eP.y - (eT.y + eT.height)
rec('AA-GAP-1-EMPTY', 'État vide : cartes→onglets ≈ 24px', g1 >= 22 && g1 <= 26, `gap=${Math.round(g1)}px`)
rec('AA-GAP-2-EMPTY', 'État vide : onglets→panneau ≈ 24px', g2 >= 22 && g2 <= 26, `gap=${Math.round(g2)}px`)
rec('AA-EMPTY-VISIBLE', 'État vide affiché', (await p2.locator('.rh-empty').count()) === 1)
await p2.screenshot({ path: 'screenshots/fix-aa-empty.png' })
await p2.close()

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nANOMALIES FIX : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
