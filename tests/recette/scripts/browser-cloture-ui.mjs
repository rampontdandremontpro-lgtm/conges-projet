// Test navigateur réel de la fenêtre « Clôture de période » (refonte UI).
// Environnement isolé : frontend 5174 -> API 3001 -> gestion_conges_gmes_test.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiRequest, login, dbConn, navigateViaSidebar } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES = path.resolve(__dirname, '../preuves')
const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:5174'

const results = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

// Récupération des données de seed côté Node.
const rhToken = await login('rh.recette@gmes.fr')
const db = await dbConn()
const reqRow = (await db.query(
  `SELECT r.id FROM leave_requests r JOIN users u ON u.id=r.employee_id WHERE u.email='col-b.recette@gmes.fr' AND r.status='EN_ATTENTE_VALIDATION' ORDER BY r.id DESC LIMIT 1`,
))[0][0]
const requestId = reqRow?.id
await db.end()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

try {
  // 1. Connexion RH + ouverture de la fenêtre.
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await navigateViaSidebar(page, '/app/rh-balances')
  await page.getByRole('button', { name: 'Clôture de période' }).click()
  await page.waitForSelector('.rh-pc-modal', { timeout: 15000 })
  await page.waitForSelector('.rh-pc-status', { timeout: 15000 })

  const statusText = () => page.locator('.rh-pc-status').innerText()
  const footerBtn = page.locator('.rh-pc-footer .rh-pc-btn--primary')

  rec('Modal ouverte avec 3 onglets', (await page.locator('.rh-pc-tab').count()) === 3)
  rec('Onglets présents', await page.locator('.rh-pc-tab', { hasText: 'Vue d’ensemble' }).count() === 1 && await page.locator('.rh-pc-tab', { hasText: 'Demandes à traiter' }).count() === 1 && await page.locator('.rh-pc-tab', { hasText: 'Reports exceptionnels' }).count() === 1)

  // 2. État bloqué (demande en attente de col-b).
  const blockedStatus = await statusText()
  rec('Statut bloqué — demandes à traiter', /bloquée/i.test(blockedStatus) && /demande/i.test(blockedStatus), blockedStatus.replace(/\s+/g, ' '))
  rec('Bouton clôture désactivé (bloqué)', await footerBtn.isDisabled())
  rec('KPI collaborateurs = 3', (await page.locator('.rh-pc-kpi').first().innerText()).includes('3'))

  // 3. Onglet Demandes à traiter : libellés français, pas de valeurs techniques brutes.
  await page.locator('.rh-pc-tab', { hasText: 'Demandes à traiter' }).click()
  await page.waitForSelector('.rh-pc-warn-banner', { timeout: 10000 })
  const reqTabText = await page.locator('.rh-pc-tab-panel').innerText()
  rec('Demande : libellé français « En attente de validation »', reqTabText.includes('En attente de validation'))
  rec('Demande : pas de valeur brute EN_ATTENTE_VALIDATION', !reqTabText.includes('EN_ATTENTE_VALIDATION'))
  rec('Demande : pas de valeur brute DEMANDE_ACTUELLE', !reqTabText.includes('DEMANDE_ACTUELLE'))
  rec('Demande : motif de blocage affiché', /bloqu/i.test(reqTabText) || /imput/i.test(reqTabText) || /valid/i.test(reqTabText))
  await page.screenshot({ path: path.join(PREUVES, 'cloture-requests-1920.png') })

  // 4. Onglet Reports exceptionnels : report ciblé depuis le nouvel onglet.
  await page.locator('.rh-pc-tab', { hasText: 'Reports exceptionnels' }).click()
  await page.waitForSelector('.rh-pc-report-row', { timeout: 10000 })
  rec('Report : 1 collaborateur avec reliquat', (await page.locator('.rh-pc-report-row').count()) === 1)
  rec('Report : reliquat 7 j affiché', (await page.locator('.rh-pc-report-row').innerText()).includes('7 j'))
  await page.getByRole('button', { name: 'Effectuer un report' }).first().click()
  await page.waitForSelector('.rh-pc-report-form', { timeout: 10000 })
  rec('Report : récap avant/après affiché', (await page.locator('.rh-pc-report-form__recap').innerText()).toLowerCase().includes('avant'))
  await page.locator('.rh-pc-report-form input[type=number]').fill('2')
  rec('Report : récap « après » recalculé (5 j)', (await page.locator('.rh-pc-report-form__recap').innerText()).includes('5 j'))
  await page.locator('.rh-pc-report-form textarea').fill('Report maladie de test')
  await page.screenshot({ path: path.join(PREUVES, 'cloture-report-form-1920.png') })
  await page.getByRole('button', { name: 'Confirmer le report' }).click()
  await page.waitForSelector('.rh-pc-report-form', { state: 'detached', timeout: 15000 })
  await page.waitForFunction(() => document.body.innerText.includes('Jours déjà reportés : 2 j'), null, { timeout: 15000 })
  rec('Report : compteurs actualisés sans fermer la fenêtre', (await page.locator('.rh-pc-report-row').innerText()).includes('Jours déjà reportés : 2 j'))
  await page.screenshot({ path: path.join(PREUVES, 'cloture-report-done-1920.png') })

  // 5. Refus de la demande bloquante côté API, puis actualisation -> « Prête à clôturer ».
  const refuse = await apiRequest(`/leave-requests/${requestId}/refuse`, { method: 'POST', token: rhToken, body: { comment: 'Refus pour test UI' } })
  rec('API : refus de la demande bloquante', refuse.status === 200 || refuse.status === 201 || refuse.status === 204, `HTTP ${refuse.status}`)
  await page.getByRole('button', { name: 'Actualiser' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Prête à clôturer'), null, { timeout: 15000 })
  rec('Statut « Prête à clôturer » après traitement', /Prête à clôturer/.test(await statusText()))
  rec('Bouton clôture activé', !(await footerBtn.isDisabled()))
  await page.screenshot({ path: path.join(PREUVES, 'cloture-ready-1920.png') })

  // 6. Confirmation finale : récapitulatif visible, puis annulation (pas de clôture).
  await footerBtn.click()
  await page.waitForSelector('.rh-pc-confirm__panel', { timeout: 10000 })
  const confirmText = await page.locator('.rh-pc-confirm__panel').innerText()
  rec('Confirmation : période affichée', confirmText.includes('01/06/2025 - 31/05/2026'))
  rec('Confirmation : collaborateurs affichés', confirmText.includes('Collaborateurs concernés') && confirmText.includes('3'))
  rec('Confirmation : caractère définitif affiché', /définitive/i.test(confirmText) && /irréversible/i.test(confirmText))
  await page.screenshot({ path: path.join(PREUVES, 'cloture-confirm-1920.png') })
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForSelector('.rh-pc-confirm__panel', { state: 'detached', timeout: 10000 })
  rec('Confirmation annulée sans clôture', (await page.locator('.rh-pc-confirm__panel').count()) === 0)

  // 7. Changements de période : statuts sécurisés + invalidation rapide.
  const select = page.locator('.rh-pc-header__controls select')
  await select.selectOption('2026-2027')
  await page.waitForFunction(() => document.body.innerText.includes('Période en cours'), null, { timeout: 15000 })
  rec('Période en cours (2026-2027)', /Période en cours/.test(await statusText()))
  rec('Période en cours : clôture désactivée', await footerBtn.isDisabled())
  await page.screenshot({ path: path.join(PREUVES, 'cloture-en-cours-1920.png') })

  // Changement rapide 2027-2028 puis retour : l’ancienne prévisualisation ne doit pas écraser la nouvelle.
  await select.selectOption('2027-2028')
  await select.selectOption('2026-2027')
  await select.selectOption('2025-2026')
  await page.waitForFunction(() => document.body.innerText.includes('Prête à clôturer'), null, { timeout: 15000 })
  rec('Changement rapide : état final cohérent (Prête à clôturer)', /Prête à clôturer/.test(await statusText()))

  // 8. Clôture réelle côté API (base test) pour vérifier « Déjà clôturée ».
  const close = await apiRequest('/leave-balances/period/close', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026', confirm: true } })
  rec('API : clôture 2025-2026 (base test)', close.status === 201 || close.status === 200, `HTTP ${close.status}`)
  await page.getByRole('button', { name: 'Actualiser' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Période déjà clôturée'), null, { timeout: 15000 })
  rec('Statut « Période déjà clôturée »', /Période déjà clôturée/.test(await statusText()))
  await page.screenshot({ path: path.join(PREUVES, 'cloture-deja-cloturee-1920.png') })

  // 9. Vue d’ensemble à 1366×768.
  await select.selectOption('2026-2027')
  await page.waitForFunction(() => document.body.innerText.includes('Période en cours'), null, { timeout: 15000 })
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(PREUVES, 'cloture-1366.png') })
  rec('Aucun débordement horizontal (1366)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

  // 10. Vue mobile 390×844.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(PREUVES, 'cloture-mobile.png') })
  rec('Mobile : fenêtre plein écran sans débordement', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
} catch (error) {
  console.error('ERREUR NAVIGATEUR :', error.message)
  rec('Déroulement du test', false, error.message)
  await page.screenshot({ path: path.join(PREUVES, 'cloture-error.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT NAVIGATEUR : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
