import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

const nav = (p) => page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, p)
const popTitle = async () => (await page.locator('.statistic-info-button__popover-head strong').first().innerText().catch(()=> '')).trim()
const popContent = async () => (await page.locator('.statistic-info-button__content').first().innerText().catch(()=> '')).replace(/\s+/g,' ').trim()

// ---------- EXTRA DAYS ----------
await nav('/app/rh-extra-days')
await page.waitForTimeout(2200)
rec('ED-NO-INTRO', 'Intro sous titre supprimée', (await page.locator('.rh-page-hero__body p').count()) === 0)
rec('ED-TABS-5', '5 onglets', (await page.locator('.rh-tab').count()) === 5)

const expected = [
  ['1', 'Comprendre les congés d’ancienneté', '1 jour supplémentaire après 5 ans'],
  ['2', 'Comprendre les jours de fractionnement', '1er mai au 31 octobre'],
  ['3', 'Comprendre la période de prise des congés', 'période de 13 mois configurée'],
  ['4', 'Que se passe-t-il lorsqu’un arrêt maladie chevauche des congés ?', 'jours concernés peuvent devoir lui être restitués'],
  ['5', 'À quoi sert la convention collective par entité ?', 'Un accord d’entreprise et une convention collective peuvent coexister'],
]
for (const [n, title, probe] of expected) {
  await page.click(`.rh-tab:nth-child(${n})`)
  await page.waitForTimeout(500)
  const trig = page.locator('.rh-panel__title-row .statistic-info-button__trigger').first()
  const hasTr = await trig.count()
  rec(`ED-INFO-${n}-PRESENT`, `Rubrique ${n} : bouton « i » présent`, hasTr === 1)
  if (hasTr) {
    await trig.click()
    await page.waitForTimeout(300)
    const t = await popTitle()
    const c = await popContent()
    rec(`ED-INFO-${n}-TITLE`, `Rubrique ${n} : titre popover exact`, t === title, `got="${t}"`)
    rec(`ED-INFO-${n}-CONTENT`, `Rubrique ${n} : contenu présent`, c.includes(probe), probe)
    // aria-expanded
    const expanded = await trig.getAttribute('aria-expanded')
    rec(`ED-INFO-${n}-ARIA`, `Rubrique ${n} : aria-expanded=true`, expanded === 'true', `got=${expanded}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    rec(`ED-INFO-${n}-ESC`, `Rubrique ${n} : fermeture Échap`, (await page.locator('.statistic-info-button__popover').count()) === 0)
    await page.screenshot({ path: `screenshots/info-ed-${n}.png` })
  }
}
rec('ED-NO-NOTE', 'Encarts d’information supprimés', (await page.locator('.rh-note').count()) === 0, `notes=${await page.locator('.rh-note').count()}`)

// ---------- ILLNESS ----------
await nav('/app/rh-illness-maintenance')
await page.waitForTimeout(2000)
rec('IM-TITLE', 'Titre renommé « Maintien de salaire et arrêts maladie »', (await page.locator('.rh-page-hero h1').innerText().catch(()=>'')) === 'Maintien de salaire et arrêts maladie')
rec('IM-NO-INTRO', 'Intro sous titre supprimée', (await page.locator('.rh-page-hero__body p').count()) === 0)
const sidebarText = await page.locator('.sidebar').innerText().catch(()=> '')
rec('IM-SIDEBAR', 'Libellé sidebar renommé', sidebarText.includes('Maintien de salaire et arrêts maladie') && !sidebarText.includes('Maintien de salaire (maladie)'))
const imTrig = page.locator('.rh-panel__title-row .statistic-info-button__trigger').first()
rec('IM-INFO-PRESENT', 'Bouton « i » formulaire présent', (await imTrig.count()) === 1)
if (await imTrig.count()) {
  await imTrig.click()
  await page.waitForTimeout(300)
  rec('IM-INFO-TITLE', 'Titre popover exact', (await popTitle()) === 'À quoi sert une décision de maintien de salaire ?')
  const c = await popContent()
  rec('IM-INFO-CONTENT', 'Contenu présent', c.includes('ne sert pas à calculer ou à verser directement les salaires'))
  await page.screenshot({ path: 'screenshots/info-im.png' })
  await page.keyboard.press('Escape')
}

// ---------- ANOMALIES ----------
await nav('/app/rh-accrual-anomalies')
await page.waitForTimeout(2200)
rec('AA-NO-INTRO', 'Intro sous titre supprimée', (await page.locator('.rh-page-hero__body p').count()) === 0)
const aaTrig = page.locator('.rh-page-hero__title-row .statistic-info-button__trigger').first()
rec('AA-INFO-PRESENT', 'Bouton « i » sur la ligne du titre', (await aaTrig.count()) === 1)
if (await aaTrig.count()) {
  await aaTrig.click()
  await page.waitForTimeout(300)
  rec('AA-INFO-TITLE', 'Titre popover exact', (await popTitle()) === 'Qu’est-ce qu’une anomalie d’acquisition ?')
  const c = await popContent()
  rec('AA-INFO-CONTENT', 'Contenu présent', c.includes('ne signifie pas automatiquement que le solde du salarié est incorrect'))
  await page.screenshot({ path: 'screenshots/info-aa.png' })
  await page.keyboard.press('Escape')
}

// JUR / tests
const bodyText = await page.evaluate(() => document.body.innerText)
rec('NO-JUR', 'Aucun code JUR affiché', !/JUR-\d/.test(bodyText))
rec('NO-PAGEERROR', 'Aucune erreur de page', errors.length === 0, errors.slice(0,3).join(' | '))

await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nINFO BUTTONS : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
