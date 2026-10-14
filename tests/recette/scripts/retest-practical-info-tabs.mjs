// Retest : page « Informations pratiques » à deux onglets.
// Vérifie l'affichage, le design, les règles internes dynamiques, les six
// liens officiels et les droits par rôle.
import { apiRequest, login, loginPage, launch, capture } from '../helpers/runner-utils.mjs'
import { config } from '../helpers/config.mjs'

const OFFICIAL_LINKS = [
  {
    title: 'Les congés payés',
    description: 'Consultez pour connaître toutes les informations sur les congés payés sur Travail-emploi.gouv.fr',
    url: 'https://travail-emploi.gouv.fr/les-conges-payes',
  },
  {
    title: 'Les congés sans solde',
    description: 'Consultez pour connaître toutes les informations sur les congés sans solde sur Travail-emploi.gouv.fr',
    url: 'https://travail-emploi.gouv.fr/le-conge-sans-solde',
  },
  {
    title: 'Le bulletin de paie',
    description: 'Consultez pour connaître toutes les informations sur le bulletin de paie sur Travail-emploi.gouv.fr',
    url: 'https://travail-emploi.gouv.fr/le-bulletin-de-paie',
  },
  {
    title: "Les congés paternité de d'accueil de l'enfant",
    description: "Consultez pour connaître toutes les informations sur les congés de paternité et d'accueil de l'enfant sur Travail-emploi.gouv.fr",
    url: 'https://travail-emploi.gouv.fr/le-conge-de-paternite-et-daccueil-de-lenfant',
  },
  {
    title: 'Les congés de maternité',
    description: 'Consultez pour connaître toutes les informations sur les congés de maternité sur Travail-emploi.gouv.fr',
    url: 'https://travail-emploi.gouv.fr/le-conge-de-maternite',
  },
  {
    title: "Les congés d'adoption",
    description: "Consultez pour connaître toutes les informations sur les congés d'adoption sur Travail-emploi.gouv.fr",
    url: 'https://travail-emploi.gouv.fr/le-conge-dadoption',
  },
]

const RULE_TEXTS = [
  'Délais de prévenance',
  'Période estivale et demandes particulières',
  'Périodes de référence N-1, N et N+1',
  'Décompte des jours ouvrables et demi-journées',
  'Dérogations et modifications de demandes',
  'Validation des demandes',
]

function collectErrors(page, sink) {
  page.on('pageerror', (error) => sink.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') sink.push(`console.error: ${message.text()}`)
  })
}

// 1. Fixtures : les six liens officiels de production sont rejoués sur la base de test.
const adminToken = await login('admin.recette@gmes.fr')
for (const link of OFFICIAL_LINKS) {
  await apiRequest('/settings/practical-links', { method: 'POST', token: adminToken, body: link })
}

const jsErrors = []
const browser = await launch()
const results = []

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
}

// 2. Vue Collaborateur.
const collabPage = await loginPage(browser, 'col-a.recette@gmes.fr')
collectErrors(collabPage, jsErrors)
await collabPage.locator('a[href="/app/practical-info"]').first().click()
await collabPage.waitForURL('**/app/practical-info', { timeout: 10000 })
await collabPage.waitForSelector('.practical-info-tabs', { timeout: 15000 })

check('Titre « Informations pratiques »', (await collabPage.locator('h1').first().innerText()).trim() === 'Informations pratiques')
check('Eyebrow « RESSOURCES »', ((await collabPage.locator('.practical-info-eyebrow').first().innerText()).trim()).toUpperCase() === 'RESSOURCES')

const subtitle = (await collabPage.locator('.practical-info-heading p').innerText()).trim()
check(
  'Sous-titre actualisé',
  subtitle.includes('Consultez les règles internes de GMES et les ressources utiles concernant les congés et les absences.'),
  subtitle,
)

const tabRules = collabPage.locator('#practical-info-tab-rules')
const tabResources = collabPage.locator('#practical-info-tab-resources')
check('Onglet « Règles internes GMES » actif par défaut', (await tabRules.getAttribute('aria-selected')) === 'true')
check('Onglet « Ressources officielles » inactif par défaut', (await tabResources.getAttribute('aria-selected')) === 'false')

const ruleTitles = await collabPage.locator('.practical-info-card--rule h2').allInnerTexts()
check('6 cartes de règles internes', ruleTitles.length === 6, `trouvées: ${ruleTitles.length}`)
for (const expected of RULE_TEXTS) {
  check(`Carte présente : « ${expected} »`, ruleTitles.some((t) => t === expected))
}

const rulesText = (await collabPage.locator('.practical-info-grid').innerText()).replace(/\s+/g, ' ')
const expectedValues = ['30 jours', '60 jours', '21 jours', '1er mai', '31 octobre', '1er juin', '31 mai', '7 jours']
for (const value of expectedValues) {
  check(`Valeur dynamique « ${value} » dans les règles`, rulesText.includes(value))
}

check('Collaborateur : aucun bouton « Ajouter un lien »', (await collabPage.locator('.practical-info-add').count()) === 0)

// Capture onglet règles (ordinateur).
await capture(collabPage, 'CAP-PI-1-regles-desktop.png')

// Onglet Ressources officielles.
await tabResources.click()
await collabPage.waitForTimeout(200)
check('Onglet « Ressources officielles » devient actif', (await tabResources.getAttribute('aria-selected')) === 'true')
check('Onglet « Règles internes GMES » devient inactif', (await tabRules.getAttribute('aria-selected')) === 'false')

const resourceTitles = await collabPage.locator('.practical-info-card:not(.practical-info-card--rule) h2').allInnerTexts()
for (const link of OFFICIAL_LINKS) {
  check(`Lien officiel présent : « ${link.title} »`, resourceTitles.some((t) => t === link.title))
}
check('Collaborateur : aucun bouton modifier/supprimer', (await collabPage.locator('.practical-info-card__actions').count()) === 0)

const congPayesCard = collabPage
  .locator('.practical-info-card:not(.practical-info-card--rule)')
  .filter({ has: collabPage.locator('h2', { hasText: /^Les congés payés$/ }) })
  .first()
const congPayesLink = congPayesCard.locator('a').first()
const href = await congPayesLink.getAttribute('href')
check('« Ouvrir le lien » pointe vers travail-emploi.gouv.fr', href?.startsWith('https://travail-emploi.gouv.fr/'), href)
check('« Ouvrir le lien » en nouvel onglet', (await congPayesLink.getAttribute('target')) === '_blank')

// Capture onglet ressources (ordinateur).
await capture(collabPage, 'CAP-PI-2-ressources-desktop.png')

// Mobile : onglet règles puis onglet ressources.
await collabPage.setViewportSize({ width: 390, height: 844 })
await tabRules.click()
await collabPage.waitForTimeout(250)
await capture(collabPage, 'CAP-PI-3-regles-mobile.png')
await tabResources.click()
await collabPage.waitForTimeout(250)
await capture(collabPage, 'CAP-PI-4-ressources-mobile.png')
await collabPage.close()

// 3. Vue RH : droits de gestion des liens.
const rhPage = await loginPage(browser, 'rh.recette@gmes.fr')
collectErrors(rhPage, jsErrors)
await rhPage.locator('a[href="/app/practical-info"]').first().click()
await rhPage.waitForURL('**/app/practical-info', { timeout: 10000 })
await rhPage.waitForSelector('.practical-info-tabs', { timeout: 15000 })
await rhPage.locator('#practical-info-tab-resources').click()
await rhPage.waitForTimeout(200)

check('RH : bouton « Ajouter un lien » visible', (await rhPage.locator('.practical-info-add').count()) === 1)
check('RH : boutons modifier/supprimer visibles', (await rhPage.locator('.practical-info-card__actions').count()) > 0)
await capture(rhPage, 'CAP-PI-5-rh-ressources.png')
await rhPage.close()

// 4. Vue tablette (Responsable).
const respPage = await loginPage(browser, 'responsable.recette@gmes.fr')
await respPage.setViewportSize({ width: 768, height: 1024 })
collectErrors(respPage, jsErrors)
await respPage.locator('a[href="/app/practical-info"]').first().click()
await respPage.waitForURL('**/app/practical-info', { timeout: 10000 })
await respPage.waitForSelector('.practical-info-tabs', { timeout: 15000 })
await capture(respPage, 'CAP-PI-6-tablette.png')
await respPage.close()

await browser.close()

check('Aucune erreur JavaScript', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '))

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log('\n=== RÉSUMÉ Informations pratiques (2 onglets) ===')
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail && !r.ok ? ` — ${r.detail}` : ''}`)
}
console.log(`\nTotal: ${results.length}, Conforme: ${passed}, Non conforme: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
