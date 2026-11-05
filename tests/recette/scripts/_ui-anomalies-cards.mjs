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

// ===== AVEC DONNÉES (base recette) =====
const page = await loginAndGo(false)
rec('NO-TABS-BAR', 'Barre d’onglets blanche supprimée', (await page.locator('.rh-tabs').count()) === 0 && (await page.locator('.rh-tab').count()) === 0)
rec('KPI-3', '3 cartes colorées présentes', (await page.locator('.rh-kpi').count()) === 3)

const kpiVals = await page.locator('.rh-kpi__value').allInnerTexts()
rec('KPI-DEFAULT-OPEN', 'Catégorie « Ouvertes » active par défaut', (await page.locator('.rh-kpi.is-active').count()) === 1 && (await page.locator('.rh-kpi').first().getAttribute('aria-pressed')) === 'true')

// correspondance compteurs vs contenu
async function activeCardAndRows(cardIndex) {
  await page.locator('.rh-kpi').nth(cardIndex).click()
  await page.waitForTimeout(400)
  const active = await page.locator('.rh-kpi').nth(cardIndex).getAttribute('aria-pressed')
  const firstRowClass = await page.locator('.rh-aa-row').first().getAttribute('class').catch(()=> '')
  return { active, firstRowClass }
}
const c1 = await activeCardAndRows(0)
rec('CLICK-OPEN', 'Clic carte Ouvertes → anomalies ouvertes', c1.active === 'true' && c1.firstRowClass.includes('rh-aa-row--open'), c1.firstRowClass)
const c2 = await activeCardAndRows(1)
rec('CLICK-DECIDED', 'Clic carte Décisions → anomalies décidées RH', c2.active === 'true' && c2.firstRowClass.includes('rh-aa-row--rh_decided'), c2.firstRowClass)
const c3 = await activeCardAndRows(2)
rec('CLICK-RESOLVED', 'Clic carte Résolues → anomalies résolues', c3.active === 'true' && c3.firstRowClass.includes('rh-aa-row--resolved'), c3.firstRowClass)

// compteurs = nombre de lignes affichées dans la catégorie
await page.locator('.rh-kpi').nth(0).click(); await page.waitForTimeout(400)
const openRows = await page.locator('.rh-aa-row--open').count()
rec('COUNT-MATCH-OPEN', 'Compteur Ouvertes = lignes affichées', String(openRows) === kpiVals[0].trim(), `kpi=${kpiVals[0].trim()} rows=${openRows}`)

// clavier : Espace et Entrée
await page.locator('.rh-kpi').nth(0).focus()
await page.keyboard.press('Tab') // focus carte 2
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
rec('KEYBOARD-ENTER', 'Sélection au clavier (Entrée)', (await page.locator('.rh-kpi').nth(1).getAttribute('aria-pressed')) === 'true')
await page.locator('.rh-kpi').nth(2).focus()
await page.keyboard.press('Space')
await page.waitForTimeout(400)
rec('KEYBOARD-SPACE', 'Sélection au clavier (Espace)', (await page.locator('.rh-kpi').nth(2).getAttribute('aria-pressed')) === 'true')

// espacement cartes → liste (environ 24px)
const kBox = await page.locator('.rh-kpis').boundingBox()
const listBox = await page.locator('.rh-aa-list').first().boundingBox()
const gap = listBox.y - (kBox.y + kBox.height)
rec('GAP-CARDS-LIST', 'Espacement cartes→liste ≈ 24px', gap >= 22 && gap <= 26, `gap=${Math.round(gap)}px`)
await page.screenshot({ path: 'screenshots/fix-cards-data.png' })
await page.close()

// ===== ÉTAT VIDE (mock) =====
const p2 = await loginAndGo(true)
const emptyTitles = ['Aucune anomalie ouverte', 'Aucune décision RH enregistrée', 'Aucune anomalie résolue']
for (let i=0;i<3;i++) {
  await p2.locator('.rh-kpi').nth(i).click(); await p2.waitForTimeout(350)
  const t = await p2.locator('.rh-empty strong').innerText().catch(()=> '')
  rec(`EMPTY-${i}`, `État vide catégorie ${i+1} correct`, t === emptyTitles[i], `got="${t}"`)
}
const kBox2 = await p2.locator('.rh-kpis').boundingBox()
const panelBox = await p2.locator('.rh-panel').boundingBox()
const gap2 = panelBox.y - (kBox2.y + kBox2.height)
rec('GAP-CARDS-PANEL-EMPTY', 'État vide : espacement cartes→panneau ≈ 24px', gap2 >= 22 && gap2 <= 26, `gap=${Math.round(gap2)}px`)
await p2.screenshot({ path: 'screenshots/fix-cards-empty.png' })
await p2.close()

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nANOMALIES CARDS : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
