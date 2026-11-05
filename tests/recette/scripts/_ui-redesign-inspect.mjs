import { chromium } from 'playwright'

const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'rh.recette@gmes.fr')
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

const nav = (path) => page.evaluate((h) => { window.history.pushState({}, '', h); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
const style = (sel, props) => page.locator(sel).first().evaluate((el, ps) => Object.fromEntries(ps.map(p => [p, getComputedStyle(el)[p]])), props)

// ================= EXTRA DAYS =================
await nav('/app/rh-extra-days')
await page.waitForTimeout(2200)
rec('ED-HERO', 'Hero présent avec titre', await page.locator('.rh-page-hero h1').innerText().catch(()=>'') === 'Droits supplémentaires')
rec('ED-TABS-5', '5 rubriques (tabs)', (await page.locator('.rh-tab').count()) === 5, `n=${await page.locator('.rh-tab').count()}`)
rec('ED-ONE-PANEL', 'Une seule rubrique visible (pas de pile)', (await page.locator('.rh-panel').count()) === 1, `panels=${await page.locator('.rh-panel').count()}`)
const tabStyle = await style('.rh-tab.is-active', ['background-color','color','border-radius'])
rec('ED-TAB-ACTIVE-BLUE', 'Onglet actif bleu', tabStyle['background-color'].includes('23, 105, 211') || tabStyle['background-color'].includes('22, 105'), JSON.stringify(tabStyle))
const panelStyle = await style('.rh-panel', ['border-radius','box-shadow','background-color','border-color'])
rec('ED-PANEL-MODERN', 'Panneau arrondi + ombre', parseFloat(panelStyle['border-radius']) >= 16 && panelStyle['box-shadow'] !== 'none', JSON.stringify(panelStyle))
// switch to convention tab
await page.click('.rh-tab:nth-child(5)')
await page.waitForTimeout(600)
rec('ED-TAB-SWITCH', 'Changement de rubrique fonctionne', (await page.locator('.rh-panel__title').first().innerText().catch(()=>'')).includes('Convention'))
const jurText = await page.evaluate(() => document.body.innerText)
rec('ED-NO-JUR', 'Aucun code JUR affiché', !/JUR-\d/.test(jurText))
// full page height (tabbed => shorter)
const edHeight = await page.evaluate(() => document.documentElement.scrollHeight)
console.log('  ED scrollHeight =', edHeight)

// ================= ILLNESS =================
await nav('/app/rh-illness-maintenance')
await page.waitForTimeout(2200)
rec('IM-HERO', 'Hero présent', (await page.locator('.rh-page-hero h1').innerText().catch(()=>'')) === 'Maintien de salaire des arrêts maladie')
const imSections = await page.locator('.rh-im-section').count()
rec('IM-SECTIONS', 'Formulaire en sections numérotées', imSections >= 4, `sections=${imSections}`)
rec('IM-DECISIONS-ROWS', 'Décisions affichées en lignes', (await page.locator('.rh-im-decision').count()) > 0, `rows=${await page.locator('.rh-im-decision').count()}`)
rec('IM-BADGE', 'Badges de statut présents', (await page.locator('.rh-im-decision .rh-badge').count()) > 0)
rec('IM-AVATAR', 'Avatars initiales présents', (await page.locator('.rh-im-decision__avatar').count()) > 0)
const imEmptyHidden = await page.locator('.rh-empty').count() === 0
rec('IM-NO-EMPTY-WHEN-DATA', 'Pas d’état vide quand données présentes', imEmptyHidden)

// ================= ANOMALIES =================
await nav('/app/rh-accrual-anomalies')
await page.waitForTimeout(2600)
rec('AA-HERO', 'Hero présent', (await page.locator('.rh-page-hero h1').innerText().catch(()=>'')) === 'Anomalies d’acquisition des congés')
rec('AA-KPI-3', '3 cartes de synthèse', (await page.locator('.rh-kpi').count()) === 3, `kpi=${await page.locator('.rh-kpi').count()}`)
const kpiVals = await page.locator('.rh-kpi__value').allInnerTexts()
console.log('  KPI values =', JSON.stringify(kpiVals))
rec('AA-KPI-VALUES', 'KPI alimentés par données réelles', kpiVals.length === 3 && kpiVals.every(v => /^\d+$/.test(v.trim())), JSON.stringify(kpiVals))
rec('AA-TABS-3', '3 onglets', (await page.locator('.rh-tab').count()) === 3)
rec('AA-ROWS', 'Lignes d’anomalies présentes', (await page.locator('.rh-aa-row').count()) > 0, `rows=${await page.locator('.rh-aa-row').count()}`)

rec('NO-PAGEERROR', 'Aucune erreur de page', errors.length === 0, errors.slice(0,3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok).length
console.log(`\nREDESIGN INSPECT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
