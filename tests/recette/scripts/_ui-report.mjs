// Vérification navigateur du parcours de report (JUR-023) sur l'écran RH.
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

  const [ents] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const gmesId = ents[0].id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `UI-RPT-${Date.now()}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: 'UI-RPT', prenom: 'Recette', email: `ui-rpt-${Date.now()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const rhToken = await login('rh.recette@gmes.fr')
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 10, reason: 'Fixture UI report' } })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('409') && !m.text().includes('400')) consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  await page.locator('.sidebar__nav-item', { hasText: 'Droits supplémentaires' }).click()
  await page.waitForSelector('.rh-extra-days-header h2', { timeout: 10000 })

  // Cibler la période 2025-2026.
  await page.locator('.rh-extra-days-toolbar input').fill('2025-2026')
  await page.locator('.rh-extra-days-card').nth(2).getByRole('button', { name: 'Consulter la période de prise' }).click()
  await page.waitForTimeout(1200)
  rec('UI-RPT-LOAD', 'Vue période de prise chargée (collaborateur listé)', await page.locator('.rh-extra-days-card').nth(2).locator('.rh-extra-days-table td', { hasText: 'UI-RPT' }).first().isVisible())

  // Validation : formulaire incomplet → erreur.
  await page.locator('.rh-extra-days-card').nth(2).getByRole('button', { name: 'Enregistrer le report' }).click()
  await page.waitForTimeout(400)
  rec('UI-RPT-VALID', 'Validation du formulaire (champs requis)', await page.getByText('Renseignez le collaborateur, la justification et la nouvelle échéance.').isVisible())

  // Remplir le formulaire.
  await page.locator('.rh-extra-days-report-form select').first().selectOption(String(emp.id))
  await page.locator('.rh-extra-days-report-form input[type="date"]').fill('2027-09-30')
  await page.locator('.rh-extra-days-report-form textarea').fill('Demande écrite de l’employeur')

  // Joindre un justificatif réel (fichier PDF conservé).
  await page.locator('.rh-extra-days-report-form input[type="file"]').setInputFiles({ name: 'demande-ui.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nrecette') })
  await page.waitForTimeout(1200)
  rec('UI-RPT-DOC', 'Justificatif joint et conservé (message)', await page.getByText(/joint et conservé/).isVisible())

  await page.locator('.rh-extra-days-card').nth(2).getByRole('button', { name: 'Enregistrer le report' }).click()
  await page.waitForTimeout(1200)
  rec('UI-RPT-SUCCESS', 'Confirmation visible après succès', await page.getByText('Report enregistré (traçabilité conservée).').isVisible())
  rec('UI-RPT-LISTED', 'Report affiché avec preuve validée', await page.locator('.rh-extra-days-card').nth(2).locator('.rh-extra-days-table', { hasText: 'demande-ui.pdf' }).isVisible())

  // Doublon → refus visible.
  await page.locator('.rh-extra-days-report-form select').first().selectOption(String(emp.id))
  await page.locator('.rh-extra-days-report-form input[type="date"]').fill('2027-12-31')
  await page.locator('.rh-extra-days-report-form textarea').fill('Doublon')
  await page.locator('.rh-extra-days-card').nth(2).getByRole('button', { name: 'Enregistrer le report' }).click()
  await page.waitForTimeout(1000)
  rec('UI-RPT-DOUBLE', 'Doublon refusé (message visible)', await page.getByText(/existe déjà/).isVisible())

  rec('UI-RPT-NOERR', 'Aucune erreur console/page', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await page.screenshot({ path: 'tests/recette/preuves/rh-report.png', fullPage: true })
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI REPORT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI REPORT :', e); process.exit(1) })
