// P3 : calendrier RH — cas particuliers.
//  1) Une déclaration éditée ne doit pas être bloquée par sa propre période.
//  2) Une absence existante (déclarée) bloque bien son jour en création.
// (Le changement A→B et l'absence sont couverts par _ui-priority3-ab-switch.mjs)
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function isBlocked(page, iso) {
  const btn = page.locator(`button[aria-label="${iso}"]`).first()
  if ((await btn.count()) === 0) return false
  const cls = await btn.getAttribute('class').catch(() => '')
  const aria = await btn.getAttribute('aria-disabled').catch(() => '')
  return cls?.includes('blocked') || cls?.includes('occupied') || aria === 'true'
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'P3E2' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `ED-${TAG}`, prenom: 'Edit', email: `ed-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Abs-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${absenceType.id}/absence-kind`, { method: 'PATCH', token: await login('rh.recette@gmes.fr'), body: { absenceKind: 'NON_MEDICAL' } })

  // Absence déclarée (ENREGISTREE) le 2026-11-21.
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-11-21','2026-11-21', 'ENREGISTREE', 1)",
    [emp.id, absenceType.id],
  )

  const browser = await chromium.launch({ headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.click('a[href="/app/rh-leaves-absences"]')
  await page.waitForURL('**/app/rh-leaves-absences', { timeout: 15000 })
  await page.waitForSelector('.rh-events-create', { timeout: 10000 })

  // ── 1) Création : le jour de l'absence déclarée est bloqué ─────────────
  await page.click('.rh-events-create')
  await page.waitForSelector('.rh-declaration-form', { timeout: 10000 })
  await page.locator('.rh-declaration-form select').first().selectOption(String(emp.id))
  await page.locator('.rh-declaration-form select').nth(1).selectOption(`ABSENCE:${absenceType.id}`)
  await page.waitForTimeout(1500)
  const createBlocked = await isBlocked(page, '2026-11-21')
  rec('P3-EDIT-CREATE-BLOCKED', 'Création : le jour de l’absence déclarée est bloqué', createBlocked)
  await page.locator('button[aria-label="Fermer"]').first().click().catch(() => {})
  await page.waitForTimeout(700)

  // ── 2) Édition : la déclaration ne doit pas se bloquer elle-même ───────
  // Ouvre la liste et clique sur la ligne d'absence.
  const row = page.locator('.rh-events-row--data', { hasText: `Abs-${TAG}` }).first()
  await row.click().catch(async () => {
    // fallback : cliquer la première ligne d'absence
    const rows = page.locator('.rh-events-row--data')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).innerText()
      if (t.includes('Absence')) { await rows.nth(i).click(); break }
    }
  })
  await page.waitForSelector('text=Modifier l’absence', { timeout: 10000 })
  await page.getByRole('button', { name: 'Modifier l’absence' }).first().click()
  await page.waitForSelector('.rh-declaration-form', { timeout: 10000 })
  await page.waitForTimeout(1500)

  const editSelfBlocked = await isBlocked(page, '2026-11-21')
  rec('P3-EDIT-SELF-NOT-BLOCKED', 'Édition : la propre période de la déclaration n’est pas bloquée', !editSelfBlocked, `blocked=${editSelfBlocked}`)

  rec('P3-EDIT-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nP3 CALENDRIER RH (édition) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P3 ÉDITION :', e); process.exit(1) })
