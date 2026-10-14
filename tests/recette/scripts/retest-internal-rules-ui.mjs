// Retest UI : gestion des règles internes GMES (lecture seule vs RH/Admin),
// fenêtre d'édition, design ordinateur et mobile.
import { loginPage, launch, capture } from '../helpers/runner-utils.mjs'

let passed = 0
let failed = 0
const failures = []

function check(label, ok, detail = '') {
  if (ok) passed += 1
  else { failed += 1; failures.push(`${label}${detail ? ` — ${detail}` : ''}`) }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

const browser = await launch()

// 1. Collaborateur : lecture seule.
const collab = await loginPage(browser, 'col-a.recette@gmes.fr')
await collab.locator('a[href="/app/practical-info"]').first().click()
await collab.waitForURL('**/app/practical-info', { timeout: 10000 })
await collab.waitForSelector('.practical-info-card--rule', { timeout: 15000 })

check('Collaborateur : 6 cartes de règles', (await collab.locator('.practical-info-card--rule').count()) === 6)
check('Collaborateur : aucun bouton « Ajouter une règle »', (await collab.locator('.practical-info-add').count()) === 0)
check('Collaborateur : aucun bouton modifier/supprimer de règle', (await collab.locator('.practical-info-card--rule .practical-info-card__actions').count()) === 0)

const collabRuleText = (await collab.locator('.practical-info-card--rule').first().innerText()).replace(/\s+/g, ' ')
check('Collaborateur : variables résolues (30 jours)', collabRuleText.includes('30 jours'))

await capture(collab, 'CAP-IR-1-collab-regles.png')
await collab.close()

// 2. RH : gestion complète.
const rh = await loginPage(browser, 'rh.recette@gmes.fr')
await rh.locator('a[href="/app/practical-info"]').first().click()
await rh.waitForURL('**/app/practical-info', { timeout: 10000 })
await rh.waitForSelector('.practical-info-card--rule', { timeout: 15000 })

check('RH : bouton « Ajouter une règle » visible', (await rh.locator('.practical-info-add').count()) === 1)
check('RH : boutons modifier/supprimer sur chaque règle', (await rh.locator('.practical-info-card--rule .practical-info-card__actions').count()) === 6)

// Fenêtre de modification d'une règle existante.
await rh.locator('.practical-info-card--rule .practical-info-card__actions button[aria-label^="Modifier"]').first().click()
await rh.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })
check('RH : fenêtre « Modifier la règle » ouverte', (await rh.locator('.practical-info-modal--wide h2').innerText()) === 'Modifier la règle')
check('RH : sélecteur d’icônes présent', (await rh.locator('.practical-info-icon-option').count()) > 0)
check('RH : champ de contenu avec pastilles de valeurs', (await rh.locator('.rule-content-editor__field .rule-chip').count()) >= 1)
check('RH : aide « Les valeurs en bleu… » présente', (await rh.locator('.rule-content-editor__hint').count()) === 1)
check('RH : aucun bouton d’insertion technique', (await rh.locator('.rule-insert-btn').count()) === 0)

await capture(rh, 'CAP-IR-2-rh-modifier-regle.png')

// Fermer puis ouvrir la fenêtre de création.
await rh.locator('.practical-info-modal header > button').click()
await rh.waitForTimeout(150)
await rh.locator('.practical-info-add').click()
await rh.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })
check('RH : fenêtre « Ajouter une règle » ouverte', (await rh.locator('.practical-info-modal--wide h2').innerText()) === 'Ajouter une règle')
await capture(rh, 'CAP-IR-3-rh-ajouter-regle.png')
await rh.locator('.practical-info-modal header > button').click()
await rh.waitForTimeout(150)

// Onglet ressources officielles conservé.
await rh.locator('#practical-info-tab-resources').click()
await rh.waitForTimeout(200)
check('RH : bouton « Ajouter un lien » visible dans Ressources', (await rh.locator('.practical-info-add').count()) === 1)
await capture(rh, 'CAP-IR-4-rh-ressources.png')
await rh.close()

// 3. Mobile collaborateur : une colonne.
const mobile = await loginPage(browser, 'col-a.recette@gmes.fr')
await mobile.setViewportSize({ width: 390, height: 844 })
await mobile.locator('.header__mobile-menu').click()
await mobile.waitForTimeout(250)
await mobile.locator('a[href="/app/practical-info"]').first().click()
await mobile.waitForURL('**/app/practical-info', { timeout: 10000 })
await mobile.waitForSelector('.practical-info-card--rule', { timeout: 15000 })
const mobileCols = await mobile.evaluate(() => {
  const grid = document.querySelector('.practical-info-grid')
  return grid ? getComputedStyle(grid).gridTemplateColumns : null
})
check('Mobile : une seule colonne', !mobileCols?.includes(' '), mobileCols)
await capture(mobile, 'CAP-IR-5-mobile-regles.png')
await mobile.close()

await browser.close()

console.log(`\n=== RÉSUMÉ règles internes (UI) ===`)
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
