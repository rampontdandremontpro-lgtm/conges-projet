import { chromium } from 'playwright'
const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const IM = {
  title: 'À quoi sert une décision de maintien de salaire ?',
  paras: [
    'Lorsqu’un collaborateur est en arrêt maladie, certaines dispositions peuvent prévoir un maintien de salaire et avoir des conséquences sur l’acquisition de ses congés payés.',
    'Cette rubrique permet à la RH d’enregistrer la période concernée, le fondement applicable (convention collective, accord d’entreprise, contrat ou autre disposition) et les justificatifs nécessaires.',
    'Les informations enregistrées permettent à l’application de déterminer les droits à congés à prendre en compte selon les règles configurées, tout en conservant un historique des décisions.',
    'Cette page ne sert pas à calculer ou à verser directement les salaires : elle concerne le suivi RH et ses conséquences sur les droits à congés.',
  ],
}
const AA = {
  title: 'Qu’est-ce qu’une anomalie d’acquisition ?',
  paras: [
    'Une anomalie d’acquisition apparaît lorsque certaines informations nécessitent une vérification pour garantir le bon calcul des droits à congés d’un collaborateur.',
    'Cela peut notamment concerner deux absences qui se chevauchent, des informations anciennes incomplètes ou des mouvements de solde qui semblent incohérents.',
    'Cette page permet à la RH de retrouver les anomalies détectées, d’en examiner les détails, de traiter les corrections nécessaires et de suivre leur résolution.',
    'Une anomalie signalée ne signifie pas automatiquement que le solde du salarié est incorrect : elle indique qu’une vérification est nécessaire.',
  ],
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email','rh.recette@gmes.fr')
await page.fill('#login-password','RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

async function check(path, sel, exp, tag) {
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForTimeout(2000)
  await page.click(sel)
  await page.waitForTimeout(250)
  const title = (await page.locator('.statistic-info-button__popover-head strong').innerText()).trim()
  const paras = await page.locator('.statistic-info-button__content p').allInnerTexts()
  const norm = paras.map(p => p.replace(/\s+/g,' ').trim())
  const expNorm = exp.paras.map(p => p.replace(/\s+/g,' ').trim())
  rec(`${tag}-TITLE`, `${tag} titre exact`, title === exp.title, title)
  rec(`${tag}-PARAS`, `${tag} ${exp.paras.length} paragraphes exacts`, JSON.stringify(norm) === JSON.stringify(expNorm))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

await check('/app/rh-illness-maintenance', '.rh-panel__title-row .statistic-info-button__trigger', IM, 'IM')
await check('/app/rh-accrual-anomalies', '.rh-page-hero__title-row .statistic-info-button__trigger', AA, 'AA')
await browser.close()
const failed = results.filter(r=>!r.ok).length
console.log(`\nEXACT TEXT 2 : ${results.length-failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
