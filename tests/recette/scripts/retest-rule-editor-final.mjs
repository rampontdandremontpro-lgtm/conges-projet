// Retest final : éditeur de règle simple et sûr (sans fonctions techniques).
import { apiRequest, login, loginPage, launch, capture } from '../helpers/runner-utils.mjs'

const RULE_TITLE = `Règle libre ${Date.now()}`
let passed = 0
let failed = 0
const failures = []

function check(label, ok, detail = '') {
  if (ok) passed += 1
  else { failed += 1; failures.push(`${label}${detail ? ` — ${detail}` : ''}`) }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

const rh = await login('rh.recette@gmes.fr')
await apiRequest('/settings/NORMAL_REQUEST_DEADLINE_DAYS', { method: 'PATCH', token: rh, body: { settingValue: '30' } })

const browser = await launch()
const page = await loginPage(browser, 'rh.recette@gmes.fr')
await page.locator('a[href="/app/practical-info"]').first().click()
await page.waitForURL('**/app/practical-info', { timeout: 10000 })
await page.waitForSelector('.practical-info-card--rule', { timeout: 15000 })

// ---- 1. Modifier une règle existante (valeurs automatiques) -----------
await page.locator('.practical-info-card--rule .practical-info-card__actions button[aria-label^="Modifier"]').first().click()
await page.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })

check('Aucun bouton « Insérer une information automatique »', (await page.locator('.rule-insert-btn').count()) === 0)
check('Aucun code {{...}} dans la fenêtre', !(await page.locator('.practical-info-modal--wide').innerText()).includes('{{'))
check('Aide « Les valeurs en bleu… » présente', (await page.locator('.rule-content-editor__hint').innerText()).includes('Les valeurs en bleu sont mises à jour automatiquement'))
check('Trois pastilles de valeurs', (await page.locator('.rule-content-editor__field .rule-chip').count()) === 3)

// Modifier le texte avant et après les pastilles.
await page.locator('.rule-content-editor__field').click()
await page.keyboard.press('Control+Home')
await page.keyboard.type('Veuillez noter : ')
await page.keyboard.press('Control+End')
await page.keyboard.type(' Merci.')
const fieldText = (await page.locator('.rule-content-editor__field').innerText()).replace(/\s+/g, ' ')
check('Texte ajouté avant la valeur', fieldText.startsWith('Veuillez noter :'))
check('Texte ajouté après la valeur', fieldText.endsWith('Merci.'))
check('Pastilles toujours présentes après édition', (await page.locator('.rule-content-editor__field .rule-chip').count()) === 3)

await capture(page, 'CAP-FINAL-1-modifier-regle.png')

// ---- 2. Suppression d'une valeur automatique → alerte + rétablir ------
await page.evaluate(() => {
  const editor = document.querySelector('.rule-content-editor__field')
  const chip = editor.querySelector('.rule-chip')
  if (chip) chip.remove()
  editor.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(150)
check('Alerte après suppression d’une valeur automatique', (await page.locator('.rule-content-editor__warning').count()) === 1)
check('Bouton « Rétablir » présent', (await page.locator('.rule-content-editor__warning button').count()) === 1)
await capture(page, 'CAP-FINAL-2-suppression-alerte.png')

await page.locator('.rule-content-editor__warning button').click()
await page.waitForTimeout(150)
check('Valeur rétablie après clic sur « Rétablir »', (await page.locator('.rule-content-editor__field .rule-chip').count()) === 3)
check('Alerte disparue après rétablissement', (await page.locator('.rule-content-editor__warning').count()) === 0)

// Enregistrer et vérifier l'association en base.
await page.locator('.practical-info-modal footer .is-primary').click()
await page.waitForSelector('.practical-info-modal', { state: 'detached', timeout: 8000 })
const rulesAfterEdit = await apiRequest('/settings/internal-rules', { token: rh })
const firstRule = rulesAfterEdit.data[0]
check('Association {{delai_normal}} conservée à l’enregistrement', firstRule.content.includes('{{delai_normal}}'), firstRule.content)
check('Aucun caractère invisible persisté', !firstRule.content.includes('\u200b'))
check('Texte avant valeur persisté', firstRule.content.includes('Veuillez noter :'))
check('Texte après valeur persisté', firstRule.content.endsWith('Merci.'))

// ---- 3. Créer une règle libre (texte ordinaire) ------------------------
await page.locator('.practical-info-add').click()
await page.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })
await page.locator('.practical-info-modal--wide input').first().fill(RULE_TITLE)
await page.locator('.rule-content-editor__field').click()
await page.keyboard.type('Délai indicatif de 30 jours environ.')
const freeText = await page.locator('.rule-content-editor__field').innerText()
check('Nouvelle règle : texte libre, aucune pastille créée', (await page.locator('.rule-content-editor__field .rule-chip').count()) === 0, freeText)
check('Nouvelle règle : « 30 jours » reste du texte ordinaire', freeText.includes('30 jours'))
await page.locator('.practical-info-modal footer .is-primary').click()
await page.waitForSelector('.practical-info-modal', { state: 'detached', timeout: 8000 })

const rulesAfterCreate = await apiRequest('/settings/internal-rules', { token: rh })
const created = rulesAfterCreate.data.find((rule) => rule.title === RULE_TITLE)
check('Règle libre créée', Boolean(created))
check('Règle libre stockée en texte ordinaire (sans association)', created.content === 'Délai indicatif de 30 jours environ.', created.content)

await capture(page, 'CAP-FINAL-3-regle-libre.png')

// ---- 4. Mise à jour automatique après changement de paramètre ---------
await apiRequest('/settings/NORMAL_REQUEST_DEADLINE_DAYS', { method: 'PATCH', token: rh, body: { settingValue: '45' } })
await page.locator('a[href="/app/dashboard"]').first().click()
await page.waitForURL('**/app/dashboard', { timeout: 10000 })
await page.locator('a[href="/app/practical-info"]').first().click()
await page.waitForURL('**/app/practical-info', { timeout: 10000 })
await page.waitForSelector('.practical-info-card--rule', { timeout: 15000 })

// Rouvrir la première règle pour vérifier la valeur mise à jour.
await page.locator('.practical-info-card--rule .practical-info-card__actions button[aria-label^="Modifier"]').first().click()
await page.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })
const chipText = (await page.locator('.rule-content-editor__field').innerText()).replace(/\s+/g, ' ')
check('Valeur automatique mise à jour (45 jours)', chipText.includes('45 jours'), chipText)
await capture(page, 'CAP-FINAL-4-maj-automatique.png')
await page.locator('.practical-info-modal header > button').click()
await page.waitForTimeout(150)
await apiRequest('/settings/NORMAL_REQUEST_DEADLINE_DAYS', { method: 'PATCH', token: rh, body: { settingValue: '30' } })

// ---- 5. Mobile --------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(200)
await page.locator('.practical-info-add').click()
await page.waitForSelector('.practical-info-modal--wide', { timeout: 5000 })
await capture(page, 'CAP-FINAL-5-mobile.png')
await page.locator('.practical-info-modal header > button').click()
await page.waitForTimeout(150)

// Nettoyage de la règle libre créée.
const finalRules = await apiRequest('/settings/internal-rules', { token: rh })
const toDelete = finalRules.data.find((rule) => rule.title === RULE_TITLE)
if (toDelete) await apiRequest(`/settings/internal-rules/${toDelete.id}`, { method: 'DELETE', token: rh })

await browser.close()

console.log(`\n=== RÉSUMÉ éditeur final ===`)
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
