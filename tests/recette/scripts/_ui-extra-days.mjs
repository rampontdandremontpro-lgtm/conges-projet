// Vérification navigateur de l'écran RH « Droits supplémentaires ».
import { chromium } from 'playwright'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5173'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')

  // Préparation API : collaborateur GMES de 5 ans d'ancienneté au 01/05/2026.
  const [ents] = await conn.query('SELECT id FROM legal_entities WHERE code=?', ['GMES'])
  const gmesId = ents[0].id
  const rhToken = await login('rh.recette@gmes.fr')
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `UI-SVC-${Date.now()}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: 'UI-ANC', prenom: 'Recette', email: `ui-anc-${Date.now()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2021-05-01', legalEntityId: gmesId } })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  // Connexion RH.
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  // Écran Droits supplémentaires (navigation client-side pour conserver le token en mémoire).
  await page.locator('.sidebar__nav-item', { hasText: 'Droits supplémentaires' }).click()
  await page.waitForSelector('.rh-extra-days-header h2', { timeout: 10000 })
  const titles = await page.locator('.rh-extra-days-header h2').allTextContents()
  rec('UI-LOAD', 'Écran chargé (ancienneté + fractionnement)', titles.some((t) => t.includes('ancienneté')) && titles.some((t) => t.includes('Fractionnement')), titles.join(' | '))

  // Config ancienneté : activer + entité GMES + enregistrer.
  await page.locator('.rh-extra-days-card').first().locator('.rh-extra-days-toggle input').check()
  await page.locator('.rh-extra-days-entity input').first().check()
  await page.locator('.rh-extra-days-card').first().getByRole('button', { name: 'Enregistrer' }).click()
  await page.waitForTimeout(900)
  rec('UI-SAVE-SR', 'Enregistrement config ancienneté', await page.getByText('Configuration ancienneté enregistrée.').isVisible())

  // Prévisualiser puis attribuer l'ancienneté.
  await page.locator('.rh-extra-days-card').first().getByRole('button', { name: 'Prévisualiser' }).click()
  await page.waitForTimeout(1200)
  const srTableVisible = await page.locator('.rh-extra-days-card').first().locator('.rh-extra-days-table').isVisible()
  const srHasPlus1 = await page.locator('.rh-extra-days-card').first().locator('.rh-extra-days-table').getByText('+1').count()
  rec('UI-PREVIEW-SR', 'Prévisualisation ancienneté (tableau + ligne +1)', srTableVisible && srHasPlus1 >= 1, `table=${srTableVisible} +1=${srHasPlus1}`)

  await page.locator('.rh-extra-days-card').first().getByRole('button', { name: 'Attribuer les jours d’ancienneté' }).click()
  await page.waitForTimeout(1200)
  rec('UI-APPLY-SR', 'Attribution ancienneté (retour succès)', await page.getByText(/Ancienneté : \d+ attribution/).isVisible())

  // Config fractionnement : GMES → SYNTEC + enregistrer.
  await page.locator('.rh-extra-days-regime select').first().selectOption('SYNTEC')
  await page.locator('.rh-extra-days-card').nth(1).getByRole('button', { name: 'Enregistrer' }).click()
  await page.waitForTimeout(900)
  rec('UI-SAVE-FR', 'Enregistrement config fractionnement', await page.getByText('Configuration fractionnement enregistrée.').isVisible())

  // Prévisualiser le fractionnement.
  await page.locator('.rh-extra-days-card').nth(1).getByRole('button', { name: 'Prévisualiser' }).click()
  await page.waitForTimeout(1200)
  const frTableVisible = await page.locator('.rh-extra-days-card').nth(1).locator('.rh-extra-days-table').isVisible()
  rec('UI-PREVIEW-FR', 'Prévisualisation fractionnement (tableau)', frTableVisible)

  // Aucune erreur console / page.
  rec('UI-NOERR', 'Aucune erreur console/page', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  // Responsive 390×844.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  rec('UI-RESP', 'Responsive 390×844 sans débordement horizontal', !overflow)

  await page.screenshot({ path: 'tests/recette/preuves/rh-extra-days.png', fullPage: true })
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI EXTRA DAYS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI EXTRA DAYS :', e); process.exit(1) })
