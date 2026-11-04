// JUR-029/030 — parcours navigateur collaborateur (déclaration d'un événement
// familial) puis RH (vérification de la règle, de l'unité et du statut).
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function setup() {
  const TAG = 'UI2930' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const conn = await dbConn()
  const [ents] = await conn.query('SELECT id, code, convention_type FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const gmesInitConvention = ents.find((e) => e.code === 'GMES')?.convention_type ?? 'NON_RENSEIGNEE'
  // GMES en Syntec : le droit mariage affiché doit être « 4 jours ouvrés »
  // (règle conventionnelle). Restauré dans le finally de main().
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec recette' } })
  const [[colA]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
  // Nettoyage des anciennes déclarations de col-a (base de test uniquement)
  // afin que le parcours navigateur soit reproductible sans chevauchement.
  await conn.query('DELETE d FROM documents d INNER JOIN absence_declarations a ON a.id = d.absence_declaration_id WHERE a.employee_id = ?', [colA.id])
  await conn.query('DELETE FROM absence_declarations WHERE employee_id = ?', [colA.id])
  await conn.end()

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.data.id, legalEntityId: gmesId } })

  const type = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Mariage-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
  await apiRequest(`/leave-types/${type.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'MARIAGE_PACS' } })

  return { TAG, typeName: `Mariage-${TAG}`, gmesId, rhToken, gmesInitConvention }
}

async function main() {
  const { TAG, typeName, gmesId, rhToken, gmesInitConvention } = await setup()
  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []

  // ── Collaborateur ─────────────────────────────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'col-a.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  await page.click('a[href="/app/new-absence"]')
  await page.waitForURL('**/app/new-absence', { timeout: 15000 })

  const pill = page.locator('.nr-types__pill', { hasText: typeName }).first()
  await pill.waitFor({ state: 'visible', timeout: 10000 })
  await pill.click()

  // Date de l'événement + sélection des 4 jours ouvrés (05→08 octobre 2026).
  await page.locator('input[type="date"]').first().fill('2026-10-01')
  // Navigue explicitement au mois cible (octobre) quelle que soit la date
  // courante : le calendrier s'ouvre sur le mois courant, on remonte jusqu'à
  // voir le 05 octobre (borné, sans dépendre de « aujourd'hui »).
  const octoberCell = page.locator('button[aria-label="2026-10-05"]')
  for (let i = 0; i < 24 && (await octoberCell.count()) === 0; i += 1) {
    await page.locator('button[aria-label="Mois précédent"]').first().click()
    await page.waitForTimeout(120)
  }
  await octoberCell.click()
  await page.locator('button[aria-label="2026-10-08"]').click()
  // Attend l'affichage du droit (règle + demande calculée), sans délai fixe.
  await page.locator('text=jours ouvrés').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})

  const info = await page.locator('text=jours ouvrés').first().textContent().catch(() => '')
  rec('UI-COLLAB-REGLE', 'Le collaborateur voit la durée en jours ouvrés', /4 jours ouvrés/.test(info ?? ''), info)

  await page.getByRole('button', { name: 'Transmettre la déclaration' }).click()
  await page.waitForURL('**/my-requests', { timeout: 15000 })
  const card = await page.locator('.my-request-card', { hasText: typeName }).first().textContent().catch(() => '')
  rec('UI-COLLAB-SUBMIT', 'La déclaration transmise apparaît dans Mes demandes', /Mariage/.test(card ?? ''), (card ?? '').slice(0, 60))

  // ── RH : traitement de la déclaration ─────────────────────────────────────
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await rh.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await rh.fill('#login-email', 'rh.recette@gmes.fr')
  await rh.fill('#login-password', 'RecetteGMES@2026!')
  await rh.click('.login-submit')
  await rh.waitForURL('**/app/**', { timeout: 15000 })

  await rh.click('a[href="/app/rh-leaves-absences"]')
  await rh.waitForURL('**/app/rh-leaves-absences', { timeout: 15000 })

  // Filtre sur le type pour atteindre la déclaration (tri par date de début).
  const typeSelect = rh.locator('.rh-events-filters select').nth(2)
  await typeSelect.selectOption({ label: typeName })
  await rh.waitForTimeout(800)

  const row = rh.locator('.rh-events-row--data', { hasText: typeName }).first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.click()

  const droitVisible = await rh.locator('text=Droit événement familial').first().isVisible().catch(() => false)
  rec('UI-RH-DROIT', 'La RH voit le droit événement familial dans le détail', droitVisible)

  const detailText = await rh.locator('.rh-absence-drawer--detail').textContent().catch(() => '')
  rec('UI-RH-STATUT', 'La RH voit un statut d’attente de vérification', /Justificatif attendu|À vérifier/.test(detailText ?? ''), '')

  await rh.getByRole('button', { name: 'Autoriser l’absence' }).click()
  await rh.waitForTimeout(1200)
  const authorized = await rh.locator('text=autorisée').first().isVisible().catch(() => false)
  rec('UI-RH-DECISION', 'La RH autorise la déclaration (décision finale)', authorized)

  rec('UI-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await page.screenshot({ path: 'tests/recette/preuves/ui-jur029-030-collab.png', fullPage: true })
  await rh.screenshot({ path: 'tests/recette/preuves/ui-jur029-030-rh.png', fullPage: true })

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI JUR-029/030 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0

  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: gmesInitConvention } }).catch(() => {})
  await browser.close()
}

main().catch((e) => { console.error('ERREUR UI JUR-029/030 :', e); process.exit(1) })
