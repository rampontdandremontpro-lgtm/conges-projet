import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }

const EXPECT = {
  '1': {
    title: 'Comprendre les congés d’ancienneté',
    paras: [
      'Les congés d’ancienneté sont des jours de repos supplémentaires accordés à certains salariés en fonction du nombre d’années passées dans leur entreprise.',
      'Par exemple, la convention Syntec prévoit 1 jour supplémentaire après 5 ans d’ancienneté, 2 jours après 10 ans, 3 jours après 15 ans et 4 jours après 20 ans.',
      'Cette rubrique permet à la RH de configurer les conditions applicables à chaque entité, de vérifier les bénéficiaires et de prévisualiser les jours avant leur attribution.',
    ],
  },
  '2': {
    title: 'Comprendre les jours de fractionnement',
    paras: [
      'Le fractionnement concerne les salariés qui prennent une partie de leur congé principal en dehors de la période habituelle, généralement du 1er mai au 31 octobre.',
      'Selon les règles applicables, ils peuvent bénéficier de jours de congé supplémentaires.',
      'Par exemple, la convention Syntec prévoit, sous conditions, 1 jour supplémentaire pour 3 ou 4 jours ouvrés concernés et 2 jours supplémentaires à partir de 5 jours ouvrés. La cinquième semaine est exclue de ce calcul.',
      'Cette rubrique permet à la RH de vérifier les congés réellement pris, de sélectionner les règles applicables à chaque entité et de prévisualiser les droits avant attribution.',
    ],
  },
  '3': {
    title: 'Comprendre la période de prise des congés',
    paras: [
      'La période de prise correspond à l’intervalle pendant lequel les collaborateurs peuvent utiliser leurs congés acquis.',
      'Dans cette application, cette rubrique permet à la RH de suivre la période de 13 mois configurée, de consulter les dates importantes et de repérer les congés qui n’ont pas encore été pris.',
      'Elle facilite le suivi des échéances et des situations nécessitant une vérification, notamment lorsque des congés restent à prendre ou peuvent faire l’objet d’un report.',
      'Les règles de report dépendent de la situation du salarié et des dispositions applicables.',
    ],
  },
  '4': {
    title: 'Que se passe-t-il lorsqu’un arrêt maladie chevauche des congés ?',
    paras: [
      'Lorsqu’un salarié est en arrêt maladie pendant une période de congés payés déjà posée, les jours concernés peuvent devoir lui être restitués selon les règles applicables.',
      'Cette rubrique permet à la RH d’identifier les périodes qui se chevauchent, de consulter les jours concernés et de vérifier les restitutions à effectuer.',
      'La RH peut prévisualiser les conséquences avant toute opération. Le traitement automatique dépend des paramètres activés dans l’application.',
    ],
  },
  '5': {
    title: 'À quoi sert la convention collective par entité ?',
    paras: [
      'Une entreprise peut regrouper plusieurs entités juridiques qui ne sont pas nécessairement soumises aux mêmes dispositions collectives.',
      'Cette rubrique permet à la RH de renseigner la convention collective applicable à chaque entité, par exemple Syntec, ainsi que l’existence éventuelle d’un accord d’entreprise.',
      'Ces informations permettent de mieux paramétrer les droits des collaborateurs en fonction de leur entité.',
      'Un accord d’entreprise et une convention collective peuvent coexister. Leur application doit respecter les règles juridiques en vigueur.',
    ],
  },
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-extra-days')
await page.waitForTimeout(2200)

for (const [n, exp] of Object.entries(EXPECT)) {
  await page.click(`.rh-tab:nth-child(${n})`)
  await page.waitForTimeout(400)
  await page.click('.rh-panel__title-row .statistic-info-button__trigger')
  await page.waitForTimeout(250)
  const title = (await page.locator('.statistic-info-button__popover-head strong').innerText()).trim()
  const paras = await page.locator('.statistic-info-button__content p').allInnerTexts()
  const parasNorm = paras.map(p => p.replace(/\s+/g,' ').trim())
  const expNorm = exp.paras.map(p => p.replace(/\s+/g,' ').trim())
  rec(`EXACT-${n}-TITLE`, `Popover ${n} titre exact`, title === exp.title, title)
  rec(`EXACT-${n}-PARAS`, `Popover ${n} ${exp.paras.length} paragraphes exacts`, JSON.stringify(parasNorm) === JSON.stringify(expNorm), `got=${paras.length} paras`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}
await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nEXACT TEXT : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
