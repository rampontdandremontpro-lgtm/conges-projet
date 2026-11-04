// JUR-031 — parcours navigateur : le collaborateur crée un événement de
// naissance, déclare sa première période de paternité en jours calendaires,
// la RH la traite jusqu'à la décision finale.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function setup() {
  const TAG = 'UI031' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const conn = await dbConn()
  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const [[colA]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
  await conn.query('DELETE d FROM documents d INNER JOIN absence_declarations a ON a.id = d.absence_declaration_id WHERE a.employee_id = ?', [colA.id])
  await conn.query('DELETE FROM absence_declarations WHERE employee_id = ?', [colA.id])
  await conn.query('DELETE FROM birth_events WHERE employee_id = ?', [colA.id])
  await conn.end()

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.data.id, legalEntityId: gmesId } })

  const mkType = async (name, kind) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }
  const pat = await mkType('Paternité', 'PATERNITE_ACCUEIL')
  const naissance = await mkType('Naissance', 'NAISSANCE')

  // Congé de naissance de 3 jours ouvrés déjà pris et enregistré (naissance
  // le dimanche 01/11/2026 → congé de naissance lundi 02 → mercredi 04/11).
  const birthLeave = await apiRequest('/absence-declarations', { method: 'POST', token: (await login('col-a.recette@gmes.fr')), body: { leaveTypeId: naissance.id, startDate: '2026-11-02', endDate: '2026-11-04', familyEventContext: { eventDate: '2026-11-01' } } })
  await apiRequest(`/absence-declarations/${birthLeave.data.id}/submit`, { method: 'POST', token: (await login('col-a.recette@gmes.fr')), body: { certifiedAccurate: true } })
  await apiRequest(`/absence-declarations/${birthLeave.data.id}/register`, { method: 'POST', token: rhToken, body: {} })

  return { TAG, typeName: `Paternité-${TAG}` }
}

async function main() {
  const { typeName } = await setup()
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

  // Création de la naissance via l'événement backend (date + nombre d'enfants).
  await page.locator('select').nth(1).selectOption('1')
  await page.locator('input[type="date"]').first().fill('2026-11-01')
  await page.getByRole('button', { name: 'Créer la naissance' }).click()
  await page.waitForTimeout(900)

  // Sélection des 4 jours calendaires consécutifs (05 → 08 novembre 2026),
  // immédiatement après le congé de naissance (fin le 04/11).
  await page.locator('button[aria-label="2026-11-05"]').click()
  await page.locator('button[aria-label="2026-11-08"]').click()
  await page.waitForTimeout(900)

  const info = await page.locator('text=25 jours calendaires').first().textContent().catch(() => '')
  rec('UI031-COLLAB-REGLE', 'Le collaborateur voit le droit en jours calendaires (25 j)', /25 jours calendaires/.test(info ?? ''), info)

  await page.getByRole('button', { name: 'Transmettre la déclaration' }).click()
  await page.waitForURL('**/my-requests', { timeout: 15000 })
  const card = await page.locator('.my-request-card', { hasText: typeName }).first().textContent().catch(() => '')
  rec('UI031-COLLAB-SUBMIT', 'La déclaration de paternité transmise apparaît dans Mes demandes', /Paternité/.test(card ?? ''), (card ?? '').slice(0, 60))

  // ── RH : traitement jusqu'à la décision finale ────────────────────────────
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await rh.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await rh.fill('#login-email', 'rh.recette@gmes.fr')
  await rh.fill('#login-password', 'RecetteGMES@2026!')
  await rh.click('.login-submit')
  await rh.waitForURL('**/app/**', { timeout: 15000 })

  await rh.click('a[href="/app/rh-leaves-absences"]')
  await rh.waitForURL('**/app/rh-leaves-absences', { timeout: 15000 })

  const typeSelect = rh.locator('.rh-events-filters select').nth(2)
  await typeSelect.selectOption({ label: typeName })
  await rh.waitForTimeout(800)

  const row = rh.locator('.rh-events-row--data', { hasText: typeName }).first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.click()

  const droitVisible = await rh.locator('text=Droit de paternité').first().isVisible().catch(() => false)
  rec('UI031-RH-DROIT', 'La RH voit le droit de paternité dans le détail', droitVisible)

  const calendaireVisible = await rh.locator('text=jours calendaires').first().isVisible().catch(() => false)
  rec('UI031-RH-CALENDAIRE', 'La RH voit un décompte en jours calendaires', calendaireVisible)

  await rh.getByRole('button', { name: 'Autoriser l’absence' }).click()
  await rh.waitForTimeout(1200)
  const authorized = await rh.locator('text=autorisée').first().isVisible().catch(() => false)
  rec('UI031-RH-DECISION', 'La RH autorise la déclaration de paternité (décision finale)', authorized)

  rec('UI031-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await page.screenshot({ path: 'tests/recette/preuves/ui-jur031-paternite-collab.png', fullPage: true })
  await rh.screenshot({ path: 'tests/recette/preuves/ui-jur031-paternite-rh.png', fullPage: true })

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI JUR-031 PATERNITÉ : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI JUR-031 PATERNITÉ :', e); process.exit(1) })
