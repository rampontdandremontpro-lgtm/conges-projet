// JUR-025/037 — parcours navigateur RH de l'onglet « Décidées RH » : un
// chevauchement contradictoire est résolu par une DÉCISION RH (classification
// retenue réellement appliquée), l'anomalie passe en RH_DECIDED et reste
// visible dans l'onglet dédié. Complément du parcours VERIFIED déjà couvert.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const TAG = 'UIRHD' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const conn = await dbConn()

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const employee = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `UI-${TAG}`, prenom: 'Décision', email: `ui-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmesId } })).data

  const malType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Arrêt maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${malType.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })
  const atmpType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `ATMP-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${atmpType.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'AT_MP' } })

  // Conflit contradictoire sur 2026-08-15 (maladie vs AT/MP).
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

  await rh.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await rh.fill('#login-email', 'rh.recette@gmes.fr')
  await rh.fill('#login-password', 'RecetteGMES@2026!')
  await rh.click('.login-submit')
  await rh.waitForURL('**/app/**', { timeout: 15000 })

  await rh.click('a[href="/app/rh-accrual-anomalies"]')
  await rh.waitForURL('**/app/rh-accrual-anomalies', { timeout: 15000 })
  const anomalyRow = rh.locator('.acc-row', { hasText: `#${employee.id}` }).first()
  await anomalyRow.waitFor({ state: 'visible', timeout: 10000 })

  // 1. Ouvrir la zone de décision (la cause existe encore).
  await anomalyRow.getByRole('button', { name: 'Vérifier & résoudre' }).click()
  await rh.waitForTimeout(600)
  const decisionArea = await anomalyRow.locator('textarea').first().isVisible().catch(() => false)
  rec('UI-RHD-DECISION-AREA', 'Zone de décision RH affichée (cause présente)', decisionArea)

  // 2. Choisir la classification retenue + justification, puis appliquer.
  await anomalyRow.locator('select').first().selectOption('AT_MP')
  await anomalyRow.locator('textarea').first().fill('La RH retient l’AT/MP pour le 15/08 : certificat d’accident du travail vérifié.')
  await anomalyRow.getByRole('button', { name: 'Appliquer la décision RH' }).click()
  await rh.waitForTimeout(1500)

  // 3. L'anomalie doit apparaître dans l'onglet « Décidées RH ».
  await rh.getByRole('button', { name: /Décidées RH/ }).click()
  await rh.waitForTimeout(800)
  const decidedRow = rh.locator('.acc-row', { hasText: `#${employee.id}` }).first()
  const decidedVisible = await decidedRow.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  const decidedText = (await decidedRow.innerText().catch(() => '')) ?? ''
  rec('UI-RHD-ONGLET-DECIDEES', 'Anomalie visible dans l’onglet « Décidées RH »', decidedVisible && /classification retenue/.test(decidedText), decidedText.slice(0, 160))

  const [dbRows] = await conn.query(
    'SELECT status, resolution_mode, retained_kind, resolution_reason FROM accrual_anomalies WHERE id=?',
    [anomalyId],
  )
  const db = dbRows?.[0]
  rec('UI-RHD-DB', 'Trace DB : RH_DECIDED + classification retenue AT_MP historisée', db?.status === 'RH_DECIDED' && db?.resolution_mode === 'RH_DECISION' && db?.retained_kind === 'AT_MP' && Boolean(db?.resolution_reason), `status=${db?.status} kind=${db?.retained_kind}`)

  // 4. La classification retenue est réellement appliquée : le jour est AT/MP
  //    assimilé → mois complet à 2,5 j (au lieu de 2,42 j si le jour restait exclu).
  await apiRequest('/leave-balances/accrual/regularize', { method: 'POST', token: rhToken, body: { employeeId: employee.id, startDate: '2026-08-01', endDate: '2026-08-31' } })
  const [netRows] = await conn.query(
    "SELECT SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END) AS d FROM balance_movements WHERE employee_id=? AND accrual_month='2026-08' AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')",
    [employee.id],
  )
  const net = Number(netRows?.[0]?.d ?? 0)
  rec('UI-RHD-APPLICATION-MOTEUR', 'Classification retenue appliquée par le moteur (2,5 j)', Math.abs(net - 2.5) < 0.01, `net=${net}`)

  rec('UI-RHD-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI ACCRUAL ANOMALIES RH_DECIDED : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI ACCRUAL RH_DECIDED :', e); process.exit(1) })
