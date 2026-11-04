// P3 : calendrier RH — changement de salarié (aucune occupation conservée de
// l'ancien) et présence d'une absence existante (jour bloqué).
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
  const TAG = 'P3E' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const empA = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `P3A-${TAG}`, prenom: 'Aa', email: `p3a-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const empB = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `P3B-${TAG}`, prenom: 'Bb', email: `p3b-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const leaveType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Abs-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${absenceType.id}/absence-kind`, { method: 'PATCH', token: await login('rh.recette@gmes.fr'), body: { absenceKind: 'NON_MEDICAL' } })

  // A : congé validé le 20 + absence enregistrée le 21. B : rien.
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-11-20','2026-11-20', 1, 1, 'VALIDEE')",
    [empA.id, leaveType.id],
  )
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-11-21','2026-11-21', 'ENREGISTREE', 1)",
    [empA.id, absenceType.id],
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
  await page.click('.rh-events-create')
  await page.waitForSelector('.rh-declaration-form', { timeout: 10000 })

  const selectEmp = page.locator('.rh-declaration-form select').first()
  const selectType = page.locator('.rh-declaration-form select').nth(1)

  // A + congé → 20 bloqué.
  await selectEmp.selectOption(String(empA.id))
  await selectType.selectOption(`CONGE:${leaveType.id}`)
  await page.waitForTimeout(1200)
  const aBlocked = await isBlocked(page, '2026-11-20')
  rec('P3-A-CONGE-BLOQUE', 'Salarié A : son congé validé du 20 est bloqué', aBlocked)

  // B (sans occupation) → 20 non bloqué (aucune occupation conservée de A).
  await selectEmp.selectOption(String(empB.id))
  await page.waitForTimeout(1200)
  const bNotBlocked = !(await isBlocked(page, '2026-11-20'))
  rec('P3-B-SWITCH-NON-BLOQUE', 'Salarié B : jour du 20 non bloqué (aucune occupation de A conservée)', bNotBlocked)

  // A + absence → 21 bloqué.
  await selectEmp.selectOption(String(empA.id))
  await selectType.selectOption(`ABSENCE:${absenceType.id}`)
  await page.waitForTimeout(1200)
  const aAbsenceBlocked = await isBlocked(page, '2026-11-21')
  rec('P3-A-ABSENCE-BLOQUE', 'Salarié A : son absence enregistrée du 21 est bloquée', aAbsenceBlocked)

  rec('P3-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nP3 CALENDRIER RH (A/B + absence) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P3 A/B :', e); process.exit(1) })
