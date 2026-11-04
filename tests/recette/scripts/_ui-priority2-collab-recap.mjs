// P2 : masquage « - j » sur le récapitulatif de demande (RecapCard) et la
// fenêtre de confirmation (RequestReviewModal), pour le Collaborateur.
// Preuve réelle : sélection d'un type + de deux jours (hors jours fériés),
// lecture du texte réellement affiché dans les deux composants.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'P2C' + Date.now().toString(36)

  const [[colA]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
  const employeeId = colA.id
  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")

  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2026-2027', 'N', 12.5, 0, 3, 9.5) ON DUPLICATE KEY UPDATE acquired_days=12.5, consumed_days=3, available_days=9.5",
    [employeeId],
  )
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, '2026-09-01','2026-09-02', 2, 2, 'VALIDEE', 'DEMANDE_ACTUELLE')",
    [employeeId, type.id],
  )
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-09-10','2026-09-10', 1, 1, 'EN_ATTENTE_VALIDATION')",
    [employeeId, type.id],
  )

  const browser = await chromium.launch({ headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'col-a.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.click('a[href="/app/new-request"]').catch(() => {})
  await page.waitForTimeout(3000)

  // Sélection du type + deux jours consécutifs hors jours fériés.
  await page.locator('.nr-types__pill', { hasText: `Congé-${TAG}` }).first().click()
  await page.waitForTimeout(800)
  await page.locator('button[aria-label="2026-11-12"]').first().click()
  await page.waitForTimeout(400)
  await page.locator('button[aria-label="2026-11-13"]').first().click()
  await page.waitForTimeout(2500)

  const recapText = norm(await page.locator('.nr-rights-impact').first().innerText().catch(() => ''))
  const recapMasked = /Pris\s+- j/.test(recapText) && /En attente\s+- j/.test(recapText) && /Validées\s+- j/.test(recapText)
  rec('P2-RECAP-MASK', 'Récapitulatif de demande : Pris/En attente/Validées = « - j »', recapMasked, recapText.slice(0, 160))

  // Fenêtre de confirmation.
  await page.getByRole('button', { name: 'Signer et soumettre' }).click().catch(() => {})
  await page.waitForTimeout(1500)
  const reviewText = norm(await page.locator('.nr-review__rights').first().innerText().catch(() => ''))
  const reviewMasked = /Pris\s*:\s*- j/.test(reviewText) && /En attente\s*:\s*- j/.test(reviewText) && /Validées\s*:\s*- j/.test(reviewText)
  rec('P2-REVIEW-MASK', 'Fenêtre de confirmation : Pris/En attente/Validées = « - j »', reviewMasked, reviewText.slice(0, 160))

  rec('P2-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nP2 RÉCAP COLLABORATEUR : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P2 RÉCAP :', e); process.exit(1) })
