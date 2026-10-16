// Retest UI : entreprise de rattachement (formulaire RH/Admin + profil).
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

// 1. Admin : formulaire de création.
const admin = await loginPage(browser, 'admin.recette@gmes.fr')
await admin.locator('a[href="/app/admin-users"]').first().click()
await admin.waitForURL('**/app/admin-users', { timeout: 10000 })
await admin.waitForSelector('.admin-users-new', { timeout: 15000 })
await admin.locator('.admin-users-new').click()
await admin.waitForSelector('.admin-users-drawer', { timeout: 5000 })

const entitySelect = admin.locator('label', { hasText: 'Entreprise de rattachement' }).locator('select')
check('Champ « Entreprise de rattachement » présent', (await entitySelect.count()) === 1)
const selected = await entitySelect.inputValue()
check('GMES présélectionné à la création', selected === '1', `valeur: ${selected}`)
const options = await entitySelect.locator('option').allInnerTexts()
const realOptions = options.filter((option) => option !== 'Sélectionner…')
check('Trois entreprises dans la liste', realOptions.length === 3, JSON.stringify(realOptions))

await capture(admin, 'CAP-LE-1-admin-creation.png')
await admin.locator('.admin-users-close').click()
await admin.waitForTimeout(150)
await admin.close()

// 2. Collaborateur : profil en lecture seule.
const col = await loginPage(browser, 'col-a.recette@gmes.fr')
await col.locator('.user-menu__button').click()
await col.locator('a[href="/app/profile"]').click()
await col.waitForURL('**/app/profile', { timeout: 10000 })
await col.waitForSelector('.profile-card', { timeout: 15000 })
await col.getByText(/rattachement/i).first().waitFor({ timeout: 8000 })

const profileText = (await col.locator('body').innerText()).replace(/\s+/g, ' ')
check('Profil : « Entreprise de rattachement » affichée', /entreprise de rattachement/i.test(profileText))
check('Profil : valeur « GMES » affichée', /entreprise de rattachement\s+GMES/i.test(profileText), profileText.slice(0, 400))

await capture(col, 'CAP-LE-2-profil.png')
await col.close()

await browser.close()

console.log(`\n=== RÉSUMÉ entités juridiques (UI) ===`)
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
