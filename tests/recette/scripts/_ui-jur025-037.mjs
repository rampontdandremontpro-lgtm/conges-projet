// JUR-025/037 — parcours navigateur RH : consultation + saisie d'une décision
// de maintien de salaire, recalcul contrôlé, lecture du compteur collaborateur.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const TAG = 'UI2537' + Date.now().toString(36)
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const conn = await dbConn()
  const [ents] = await conn.query('SELECT id, code, convention_type FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const gmesInitConvention = ents.find((e) => e.code === 'GMES')?.convention_type ?? 'NON_RENSEIGNEE'
  // GMES en Syntec pour ce scénario (restauré dans le finally).
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec recette' } })

  let browser
  try {
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const employee = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `UI-${TAG}`, prenom: 'Maintien', email: `ui-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmesId } })).data
  await apiRequest(`/users/${employee.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'UiTemp2026!Pass' } })
  const empToken = await login(`ui-${TAG.toLowerCase()}@recette.fr`, 'UiTemp2026!Pass')

  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Arrêt maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${type.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })

  // Arrêt maladie du mois + acquisition (socle légal 2 j + anomalie RH).
  const abs = (await apiRequest('/absence-declarations', { method: 'POST', token: empToken, body: { leaveTypeId: type.id, startDate: '2026-07-01', endDate: '2026-07-31' } })).data
  await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: empToken, body: { certifiedAccurate: true } })
  await apiRequest(`/absence-declarations/${abs.id}/register`, { method: 'POST', token: rhToken, body: {} })
  const runBefore = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-07' } })
  const flaggedBefore = (runBefore.data?.manualReviewRequired ?? []).some((r) => r.employeeId === employee.id)

  browser = await chromium.launch({ headless: true })
  const consoleErrors = []

  // ── RH : consultation de l'anomalie + saisie de la décision ───────────────
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh.on('pageerror', (e) => consoleErrors.push(String(e)))

  await rh.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await rh.fill('#login-email', 'rh.recette@gmes.fr')
  await rh.fill('#login-password', 'RecetteGMES@2026!')
  await rh.click('.login-submit')
  await rh.waitForURL('**/app/**', { timeout: 15000 })

  await rh.click('a[href="/app/rh-illness-maintenance"]')
  await rh.waitForURL('**/app/rh-illness-maintenance', { timeout: 15000 })
  const heading = await rh.locator('text=Maintien de salaire des arrêts maladie').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  rec('UI-RH-PAGE', 'La RH accède à la page Maintien de salaire (maladie)', heading)

  await rh.locator('.im-form select').first().selectOption({ label: `UI-${TAG} Maintien (ui-${TAG.toLowerCase()}@recette.fr)` })
  const dateInputs = rh.locator('.im-form input[type="date"]')
  await dateInputs.nth(0).fill('2026-07-01')
  await dateInputs.nth(1).fill('2026-07-31')
  await rh.locator('.im-form textarea').fill('Maintien de salaire Syntec 5.5 confirmé par la paie pour cet arrêt.')
  await rh.getByRole('button', { name: 'Enregistrer la décision' }).click()
  await rh.waitForTimeout(1500)

  const success = await rh.locator('text=Décision enregistrée et acquisition recalculée').first().isVisible().catch(() => false)
  rec('UI-RH-DECISION', 'La RH enregistre une décision justifiée', success)

  const listed = await rh.locator('.im-decision-row', { hasText: `#${employee.id}` }).first().isVisible().catch(() => false)
  rec('UI-RH-LISTE', 'La décision apparaît dans la liste active', listed)

  // ── Recalcul contrôlé (relance de l'acquisition) ──────────────────────────
  await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-07' } })
  const [balRows] = await conn.query(
    `SELECT b.acquired_days FROM leave_balances b WHERE b.employee_id=? AND b.reference_period='2026-2027' AND b.counter_type='N'`,
    [employee.id],
  )
  const acquired = Number(balRows?.[0]?.acquired_days ?? 0)
  rec('UI-RECALCUL', 'Le compteur RH reflète 2,5 j après la décision', Math.abs(acquired - 2.5) < 0.01, `acquired=${acquired}`)

  // ── Collaborateur : lecture du compteur ──────────────────────────────────
  const collab = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  collab.on('pageerror', (e) => consoleErrors.push(String(e)))
  await collab.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await collab.fill('#login-email', `ui-${TAG.toLowerCase()}@recette.fr`)
  await collab.fill('#login-password', 'UiTemp2026!Pass')
  await collab.click('.login-submit')
  await collab.waitForURL('**/app/**', { timeout: 15000 })

  // Changement de mot de passe forcé (mot de passe temporaire).
  const collabNewPass = 'CollabNouveau2026!Pass'
  const currentVisible = await collab.locator('#current-password').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  if (currentVisible) {
    await collab.fill('#current-password', 'UiTemp2026!Pass')
    await collab.fill('#new-password', collabNewPass)
    await collab.fill('#confirm-password', collabNewPass)
    await collab.getByRole('button', { name: 'Modifier le mot de passe' }).click()
    await collab.waitForTimeout(1500)
  }

  const summary = await apiRequest('/leave-balances/my/summary', { method: 'GET', token: empToken })
  const apiAcquiredBefore = (summary.data ?? []).find((s) => s.referencePeriod === '2026-2027')?.acquiredDays
  rec('UI-COLLAB-COMPTEUR-API', 'Le crédit API vaut exactement 2,5 (champ numérique)', Math.abs(Number(apiAcquiredBefore) - 2.5) < 0.01, `acquiredDays=${apiAcquiredBefore}`)

  // Lecture réelle de l'espace collaborateur après connexion (changement de
  // mot de passe temporaire effectué le cas échéant).
  await collab.click('a[href="/app/dashboard"]').catch(() => {})
  await collab.waitForTimeout(1500)
  const balanceCardVisible = await collab.locator('text=Situation de mes droits').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  rec('UI-COLLAB-COMPTEUR-AFFICHE', 'Le collaborateur voit son espace « Situation de mes droits »', balanceCardVisible, collab.url())

  // Valeur numérique réellement affichée, comparée au crédit enregistré (2,5).
  const acquiredShown = (await collab.locator('[data-testid="balance-acquired"]').first().textContent().catch(() => '')) ?? ''
  rec('UI-COLLAB-COMPTEUR-VALEUR', 'Le crédit affiché correspond au crédit enregistré (2,5)', /2[,.]5/.test(acquiredShown) && Math.abs(Number(apiAcquiredBefore) - 2.5) < 0.01, `affiché="${acquiredShown.trim()}" api=${apiAcquiredBefore}`)

  // ── RH : annulation de la décision de CE salarié depuis l'interface ─────
  const decisionRow = rh.locator('.im-decision-row', { hasText: `#${employee.id}` }).first()
  await decisionRow.waitFor({ state: 'visible', timeout: 10000 })
  await decisionRow.getByRole('button', { name: 'Annuler' }).click()
  await rh.waitForTimeout(1500)
  const cancelledMsg = await rh.locator('text=Décision annulée et acquisition recalculée').first().isVisible().catch(() => false)
  rec('UI-RH-ANNULATION', 'La RH annule une décision depuis l’interface', cancelledMsg)

  await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rhToken, body: { accrualMonth: '2026-07' } })
  const [balRowsAfter] = await conn.query(
    "SELECT b.acquired_days FROM leave_balances b WHERE b.employee_id=? AND b.reference_period='2026-2027' AND b.counter_type='N'",
    [employee.id],
  )
  const acquiredAfter = Number(balRowsAfter?.[0]?.acquired_days ?? 0)
  rec('UI-RECALCUL-APRES-ANNULATION', 'Après annulation : compteur revenu à 2 j (socle légal)', Math.abs(acquiredAfter - 2) < 0.01, `acquired=${acquiredAfter}`)

  // Relecture du crédit affiché côté collaborateur après annulation (2 j) :
  // navigation vers une autre page puis retour pour forcer le rechargement.
  await collab.click('a[href="/app/my-requests"]').catch(() => {})
  await collab.waitForTimeout(1200)
  await collab.click('a[href="/app/dashboard"]').catch(() => {})
  await collab.waitForTimeout(1500)
  const acquiredShownAfter = (await collab.locator('[data-testid="balance-acquired"]').first().textContent().catch(() => '')) ?? ''
  rec('UI-COLLAB-VALEUR-APRES', 'Le crédit affiché après annulation vaut 2 j', /2[,.]?\s?j/.test(acquiredShownAfter) && !/2[,.]5/.test(acquiredShownAfter), `affiché="${acquiredShownAfter.trim()}"`)

  rec('UI-NO-PAGEERROR', 'Aucune erreur de page navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await rh.screenshot({ path: 'tests/recette/preuves/ui-jur025-037-rh.png', fullPage: true })
  await collab.screenshot({ path: 'tests/recette/preuves/ui-jur025-037-collab.png', fullPage: true })

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI JUR-025/037 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
  } finally {
    await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: gmesInitConvention } }).catch(() => {})
    await browser.close()
    await conn.end()
  }
}

main().catch((e) => { console.error('ERREUR UI JUR-025/037 :', e); process.exit(1) })
