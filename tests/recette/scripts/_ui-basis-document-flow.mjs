// JUR-025/037 — parcours navigateur RH du justificatif de fondement :
// téléversement (EN ATTENTE) → validation RH justifiée (ACCEPTE) → décision
// applicable → compteur 2,5 j. Le fichier seul ne suffit pas.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const TAG = 'UIBASIS' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const conn = await dbConn()

  const [ents] = await conn.query('SELECT id, code, convention_type FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const gmesInitConvention = ents.find((e) => e.code === 'GMES')?.convention_type ?? 'NON_RENSEIGNEE'
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec recette' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const employee = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `UI-${TAG}`, prenom: 'Fondement', email: `ui-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmesId } })).data

  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Arrêt maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${type.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-07-01', '2026-07-31', 'ENREGISTREE', 31)",
    [employee.id, type.id],
  )
  await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-07' } })

  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  await page.click('a[href="/app/rh-illness-maintenance"]')
  await page.waitForURL('**/app/rh-illness-maintenance', { timeout: 15000 })
  await page.waitForSelector('.im-form', { timeout: 10000 })

  // 1. Sélection collaborateur + fondement CONTRACTUEL.
  await page.locator('.im-field select').nth(0).selectOption(String(employee.id))
  await page.locator('.im-field select').nth(1).selectOption('CONTRACTUEL')
  await page.fill('input[type="date"] >> nth=0', '2026-07-01') // période couverte début
  await page.fill('input[type="date"] >> nth=1', '2026-07-31') // période couverte fin
  await page.fill('input[type="date"] >> nth=2', '2024-01-01') // validité début
  await page.fill('input[type="date"] >> nth=3', '2026-12-31') // validité fin
  await page.waitForTimeout(400)

  // 2. Téléversement du fichier (EN ATTENTE).
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  await page.setInputFiles('.im-basis-upload__row input[type="file"]', { name: 'fondement.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.getByRole('button', { name: 'Téléverser' }).click()
  await page.waitForTimeout(1500)
  const uploadedFeedback = await page.locator('text=en attente de validation').first().isVisible().catch(() => false)
  rec('UI-BASIS-TELEVERSEMENT', 'Téléversement : document en attente de validation', uploadedFeedback)

  // 3. Validation RH justifiée.
  await page.locator('textarea[placeholder*="Justification RH de la validation"]').fill('Fondement vérifié : clause contractuelle conforme.')
  await page.getByRole('button', { name: 'Valider le justificatif' }).click()
  await page.waitForTimeout(1500)
  const validatedFeedback = await page.locator('text=statut ACCEPTE').first().isVisible().catch(() => false)
  rec('UI-BASIS-VALIDATION', 'Validation RH justifiée : statut ACCEPTE affiché', validatedFeedback)

  // 4. Enregistrement de la décision → compteur 2,5 j.
  await page.locator('textarea[placeholder*="Maintien de salaire conventionnel"]').fill('Maintien confirmé par la paie.')
  await page.locator('input[placeholder*="Accord d’entreprise"]').fill('Clause contractuelle art. 9')
  await page.getByRole('button', { name: 'Enregistrer la décision' }).click()
  await page.waitForTimeout(2000)
  const decisionVisible = await page.locator('.im-decision-row', { hasText: `#${employee.id}` }).first().isVisible().catch(() => false)
  rec('UI-BASIS-DECISION', 'Décision enregistrée et visible dans la liste', decisionVisible)

  const [netRows] = await conn.query(
    "SELECT SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END) AS d FROM balance_movements WHERE employee_id=? AND accrual_month='2026-07' AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')",
    [employee.id],
  )
  const net = Number(netRows?.[0]?.d ?? 0)
  rec('UI-BASIS-COMPTEUR', 'Compteur exact après validation (2,5 j)', Math.abs(net - 2.5) < 0.01, `net=${net}`)

  rec('UI-BASIS-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: gmesInitConvention } }).catch(() => {})
  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI PARCOURS JUSTIFICATIF FONDEMENT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI PARCOURS FONDEMENT :', e); process.exit(1) })
