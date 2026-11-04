// JUR-025/037 — parcours navigateur RH complet des anomalies d'acquisition :
// consultation → tentative de clôture prématurée refusée → correction réelle de
// l'absence via l'interface → recalcul → résolution vérifiée.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const TAG = 'UIACC' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const conn = await dbConn()
  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const employee = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `UI-${TAG}`, prenom: 'Anomalie', email: `ui-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmesId } })).data
  const employeeEmail = `ui-${TAG.toLowerCase()}@recette.fr`

  const malType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Arrêt maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${malType.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })
  const atmpType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `ATMP-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${atmpType.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'AT_MP' } })

  // Conflit contradictoire sur 2026-08-15 (les deux natures sont ENREGISTREE).
  await conn.query(
    "INSERT INTO absence_declarations (employee_id, leave_type_id, start_date, end_date, status, duration_days) VALUES (?, ?, '2026-08-15', '2026-08-15', 'ENREGISTREE', 1), (?, ?, '2026-08-15', '2026-08-15', 'ENREGISTREE', 1)",
    [employee.id, malType.id, employee.id, atmpType.id],
  )
  await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-08' } })
  const [anRows] = await conn.query(
    "SELECT id FROM accrual_anomalies WHERE employee_id=? AND type='ABSENCE_OVERLAP_CONFLICT' AND accrual_month='2026-08'",
    [employee.id],
  )
  const anomalyId = anRows?.[0]?.id

  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh.on('pageerror', (e) => consoleErrors.push(String(e)))
  rh.on('dialog', (dialog) => dialog.accept())

  await rh.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await rh.fill('#login-email', 'rh.recette@gmes.fr')
  await rh.fill('#login-password', 'RecetteGMES@2026!')
  await rh.click('.login-submit')
  await rh.waitForURL('**/app/**', { timeout: 15000 })

  // 1. La RH consulte la liste des anomalies ouvertes.
  await rh.click('a[href="/app/rh-accrual-anomalies"]')
  await rh.waitForURL('**/app/rh-accrual-anomalies', { timeout: 15000 })
  const anomalyRow = rh.locator('.acc-row', { hasText: `#${employee.id}` }).first()
  const rowVisible = await anomalyRow.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  rec('UI-ACC-CONSULTATION', 'La RH voit l’anomalie ouverte du collaborateur', rowVisible, `#${employee.id}`)

  // 2. Tentative de clôture prématurée : la cause existe encore → refus + saisie.
  await anomalyRow.getByRole('button', { name: 'Vérifier & résoudre' }).click()
  await rh.waitForTimeout(800)
  const decisionArea = await anomalyRow.locator('textarea').first().isVisible().catch(() => false)
  rec('UI-ACC-REFUS-CAUSE', 'Clôture prématurée refusée : décision RH justifiée demandée', decisionArea)

  // 3. Correction réelle de l'absence via l'interface RH (annulation de l'AT/MP).
  await anomalyRow.locator('a.acc-row__link').click()
  await rh.waitForURL('**/app/rh-leaves-absences**', { timeout: 15000 })
  await rh.waitForTimeout(1200)
  const atmpRow = rh.locator('.rh-events-row--data', { hasText: `ATMP-${TAG}` }).first()
  const atmpVisible = await atmpRow.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  rec('UI-ACC-ABSENCE-VISIBLE', 'L’absence AT/MP en conflit est visible dans la liste', atmpVisible)
  await atmpRow.click()
  await rh.getByRole('button', { name: 'Annuler l’absence' }).first().waitFor({ state: 'visible', timeout: 8000 })
  await rh.getByRole('button', { name: 'Annuler l’absence' }).first().click()
  await rh.waitForTimeout(1500)
  const cancelledFeedback = await rh.locator('text=L’absence a été annulée').first().isVisible().catch(() => false)
  rec('UI-ACC-CORRECTION', 'L’absence en conflit a été annulée depuis l’interface', cancelledFeedback)

  // 4. Retour aux anomalies : la correction a déclenché le recalcul et
  //    l'anomalie est automatiquement résolue (cause disparue, mode VERIFIED).
  await rh.click('a[href="/app/rh-accrual-anomalies"]')
  await rh.waitForURL('**/app/rh-accrual-anomalies', { timeout: 15000 })
  await rh.waitForTimeout(1200)
  await rh.getByRole('button', { name: /Résolues/ }).click()
  await rh.waitForTimeout(800)
  const resolvedRow = rh.locator('.acc-row', { hasText: `#${employee.id}` }).first()
  const resolvedVisible = await resolvedRow.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  const resolvedText = (await resolvedRow.innerText().catch(() => '')) ?? ''
  rec('UI-ACC-RESOLUTION-VERIFIEE', 'Après correction + recalcul : anomalie résolue (cause disparue)', resolvedVisible && /Cause disparue|vérifiée/.test(resolvedText), resolvedText.slice(0, 140))

  const [resolvedRows] = await conn.query(
    "SELECT status, resolution_mode, resolution_reason FROM accrual_anomalies WHERE id=?",
    [anomalyId],
  )
  const resolved = resolvedRows?.[0]
  rec('UI-ACC-RESOLUTION-DB', 'Trace DB : statut RÉSOLU, mode VÉRIFIÉ, sans justification forcée', resolved?.status === 'RESOLVED' && resolved?.resolution_mode === 'VERIFIED' && !resolved?.resolution_reason, `status=${resolved?.status} mode=${resolved?.resolution_mode}`)

  // Le compteur reflète 1 jour maladie unique après correction (2,48 j).
  const [netRows] = await conn.query(
    "SELECT SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END) AS d FROM balance_movements WHERE employee_id=? AND accrual_month='2026-08' AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')",
    [employee.id],
  )
  const net = Number(netRows?.[0]?.d ?? 0)
  rec('UI-ACC-COMPTEUR-EXACT', 'Compteur exact après correction (2,48 j)', Math.abs(net - Math.round((2.5 * 30 + 2 * 1) / 31 * 100) / 100) < 0.01, `net=${net}`)

  rec('UI-ACC-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await rh.screenshot({ path: 'tests/recette/preuves/ui-accrual-anomalies-rh.png', fullPage: true })

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI ACCRUAL ANOMALIES : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI ACCRUAL ANOMALIES :', e); process.exit(1) })
