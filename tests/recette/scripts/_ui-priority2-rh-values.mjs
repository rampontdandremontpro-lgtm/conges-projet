// P2 : les vrais compteurs RH (Pris / En attente / Validées) sont conservés
// sur la page « Soldes collaborateurs », avec des valeurs numériques réelles,
// tandis que le Collaborateur voit « - j ».
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'P2RH' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `P2-${TAG}`, prenom: 'Recette', email: `p2-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  // Solde N 2025-2026 : acquis 12,5, consommé 3 → Pris 3, Solde 9,5.
  await conn.query(
    "INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2025-2026', 'N', 12.5, 0, 3, 9.5)",
    [emp.id],
  )
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status) VALUES (?, ?, '2026-03-01','2026-03-02', 2, 2, 'VALIDEE', 'DEMANDE_ACTUELLE')",
    [emp.id, type.id],
  )
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-03-10','2026-03-10', 1, 1, 'EN_ATTENTE_VALIDATION')",
    [emp.id, type.id],
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
  await page.click('a[href="/app/rh-balances"]').catch(() => {})
  await page.waitForTimeout(2500)
  // Filtre sur le collaborateur créé (la liste est paginée).
  await page.locator('label', { hasText: 'Collaborateur' }).locator('select').selectOption(String(emp.id)).catch(() => {})
  await page.waitForTimeout(1200)

  const row = page.locator('.rh-balances-row--body', { hasText: `P2-${TAG}` }).first()
  const rowVisible = await row.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  const rowText = await row.innerText().catch(() => '')
  // Ligne : [Acquis] [Pris] [Solde] [Validées] [En attente] → 12,5 j | 3 j | 9,5 j | 2 j | 1 j
  const realPris = /3\s*j/.test(rowText) && !/- j/.test(rowText)
  const realValidees = /2\s*j/.test(rowText)
  const realAttente = /1\s*j/.test(rowText)
  rec('P2-RH-VALEURS-REELLES', 'RH Soldes : Pris=3 j, Validées=2 j, En attente=1 j (réels, non masqués)', rowVisible && realPris && realValidees && realAttente, rowText.replace(/\n/g, ' | ').slice(0, 140))

  // Ouvrir le détail pour confirmer les KPI du drawer.
  await row.click().catch(() => {})
  await page.waitForTimeout(1200)
  const kpiText = await page.locator('.rh-balances-kpis').innerText().catch(() => '')
  rec('P2-RH-DETAIL', 'RH détail : KPI réels (Pris/Validées/En attente numériques)', /Pris/.test(kpiText) && /3\s*j/.test(kpiText) && /2\s*j/.test(kpiText) && /1\s*j/.test(kpiText) && !/- j/.test(kpiText), kpiText.replace(/\n/g, ' | ').slice(0, 140))

  rec('P2-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nP2 VALEURS RH : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P2 VALEURS RH :', e); process.exit(1) })
