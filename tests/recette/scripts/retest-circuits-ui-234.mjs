// Parcours UI complets (Playwright) des circuits 2, 3 et 4 via le frontend de test 5174.
// Circuit 1 déjà couvert par retest-circuits-ui.mjs (preuves conservées).
// Vérifie aussi que le second valideur ne voit pas la demande prématurément.

import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'U234' + Date.now().toString(36)
const out = {}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = isoAddDays(s, 1) }
  return s
}
let farCursor = isoAddDays(todayIso(), 45)
function nextFarDate() { farCursor = advanceToWeekday(farCursor); const d = farCursor; farCursor = isoAddDays(farCursor, 1); return d }
let nearCursor = isoAddDays(todayIso(), 5)
function nextNearDate() { nearCursor = advanceToWeekday(nearCursor); const d = nearCursor; nearCursor = isoAddDays(nearCursor, 1); return d }

async function collaboratorSignSubmit(page, initials) {
  await page.waitForSelector('.nr-review', { timeout: 15000 })
  await page.locator('.nr-review__actions .nr-btn--primary', { hasText: 'Oui, continuer' }).click()
  await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 15000 })
  await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
  await page.waitForSelector('#signature-initials', { timeout: 10000 })
  await page.fill('#signature-initials', initials)
  await page.locator('.nr-modal__footer .nr-btn--primary').click()
}

async function validatorSign(page, initials) {
  await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 15000 })
  await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
  await page.waitForSelector('#signature-initials', { timeout: 10000 })
  await page.fill('#signature-initials', initials)
  await page.locator('.nr-modal__footer .nr-btn--primary').click()
}

async function collabOpenAndSubmit(page, typeName, initials) {
  await navigateViaSidebar(page, '/app/my-requests')
  await page.waitForSelector('.my-request-card', { timeout: 15000 })
  await page.locator('.my-request-card', { hasText: typeName }).first().click()
  await page.waitForURL('**/new-request/**', { timeout: 15000 })
  await page.waitForSelector('.nr-recap__actions', { timeout: 15000 })
  await page.locator('.nr-recap__actions .nr-btn--primary', { hasText: 'Signer et soumettre' }).click()
  await collaboratorSignSubmit(page, initials)
  await page.waitForURL('**/my-requests**', { timeout: 15000 })
}

async function rhOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/rh-leaves-absences')
  await page.waitForSelector('.rh-events-filters', { timeout: 15000 })
  await page.locator('.rh-events-filters label', { hasText: 'TYPE' }).locator('select').selectOption({ label: typeName })
  await page.waitForTimeout(400)
  await page.locator('.rh-events-row--data').first().click()
  await page.waitForURL('**/rh-all-requests/**', { timeout: 15000 })
}

async function rhOpenCountValidate(page, typeName) {
  await rhOpenRequest(page, typeName)
  await page.waitForSelector('.manager-request-actions-card', { timeout: 15000 })
  return page.locator('.manager-request-action--validate').count()
}

async function dirOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/director-all-requests')
  await page.waitForSelector('.director-all-requests-filter-button', { timeout: 15000 })
  if ((await page.locator('.director-all-requests-filter-panel').count()) === 0) {
    await page.click('.director-all-requests-filter-button')
  }
  await page.waitForSelector('.director-all-requests-filter-panel', { timeout: 15000 })
  await page.locator('.director-all-requests-filter-panel label', { hasText: 'Type de congé' }).locator('select').selectOption({ label: typeName })
  await page.waitForTimeout(400)
  await page.locator('.director-all-requests-row--data').first().click()
  await page.waitForURL('**/director-all-requests/**', { timeout: 15000 })
}

async function dirOpenCountValidate(page, typeName) {
  await dirOpenRequest(page, typeName)
  await page.waitForSelector('.manager-request-actions-card', { timeout: 15000 })
  return page.locator('.manager-request-action--validate').count()
}

async function mgrOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/requests')
  await page.waitForSelector('.manager-all-requests-filter-button', { timeout: 15000 })
  if ((await page.locator('.manager-all-requests-filter-panel').count()) === 0) {
    await page.click('.manager-all-requests-filter-button')
  }
  await page.waitForSelector('.manager-all-requests-filter-panel', { timeout: 15000 })
  await page.locator('.manager-all-requests-filter-panel label', { hasText: 'Type de congé' }).locator('select').selectOption({ label: typeName })
  await page.waitForTimeout(400)
  await page.locator('.manager-all-requests-row--data').first().click()
  await page.waitForURL('**/requests/**', { timeout: 15000 })
}

async function mgrOpenCountValidate(page, typeName) {
  await mgrOpenRequest(page, typeName)
  await page.waitForSelector('.manager-request-actions-card', { timeout: 15000 })
  return page.locator('.manager-request-action--validate').count()
}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')
  const resp = await login('responsable.recette@gmes.fr')
  const respId = (await apiRequest('/users/me', { token: resp })).data.id

  // Services
  const svcSans = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `U234-SANS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const svcAvec = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `U234-AVEC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svcAvec.id } })
  await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const mkUser = async (suffix, serviceId) => (await apiRequest('/users', { method: 'POST', token: admin, body: {
    nom: 'U234COL', prenom: suffix, email: `u234col.${suffix.toLowerCase()}.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId, hireDate: '2026-01-06',
  } })).data
  const colSans = await mkUser('SANS', svcSans.id)
  const colAvec = await mkUser('AVEC', svcAvec.id)

  const type = async (label) => (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP U234 ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const typeC2 = await type('C2')
  const typeC3 = await type('C3')
  const typeC4 = await type('C4')

  const colSansToken = signAccessToken({ id: colSans.id, email: colSans.email, role: 'COLLABORATEUR' })
  const colAvecToken = signAccessToken({ id: colAvec.id, email: colAvec.email, role: 'COLLABORATEUR' })

  const browser = await launch()

  // ================= CIRCUIT 2 : Collab -> Responsable -> RH =================
  {
    const d = nextFarDate()
    const req = (await apiRequest('/leave-requests', { method: 'POST', token: colAvecToken, body: { leaveTypeId: typeC2.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data

    // Collaborateur signe et soumet
    let page = await loginPage(browser, colAvec.email, 'RecetteGMES@2026!')
    await collabOpenAndSubmit(page, typeC2.name, 'UI')
    await capture(page, 'CAP-CIRCUIT2-COLLAB-SOUMIS.png')
    await page.close().catch(() => {})
    out['C2-submitted'] = (await apiRequest(`/leave-requests/${req.id}`, { token: colAvecToken })).data?.status

    // Prématuré : la RH ne doit pas pouvoir valider
    page = await loginPage(browser, 'rh.recette@gmes.fr')
    out['C2-rh-premature-validate-btn'] = await rhOpenCountValidate(page, typeC2.name)
    await capture(page, 'CAP-CIRCUIT2-RH-PREMATURE.png')
    await page.close().catch(() => {})

    // Responsable valide et signe
    page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await mgrOpenRequest(page, typeC2.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT2-RESP-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RS')
    await capture(page, 'CAP-CIRCUIT2-RESP-VALIDE.png')
    await page.close().catch(() => {})
    out['C2-after-resp'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: resp })).data?.status

    // RH valide et signe (final)
    page = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page, typeC2.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT2-RH-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RH')
    await capture(page, 'CAP-CIRCUIT2-RH-VALIDE.png')
    await page.close().catch(() => {})
    out['C2-final'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: rh })).data?.status
  }

  // ================= CIRCUIT 3 : Collab -> RH (dérogation) -> Directeur =================
  {
    const d = nextNearDate()
    const req = (await apiRequest('/leave-requests', { method: 'POST', token: colSansToken, body: { leaveTypeId: typeC3.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = await apiRequest('/derogations', { method: 'POST', token: colSansToken, body: { leaveRequestId: req.id, reason: 'Dérogation UI circuit 3' } })
    if (der.status !== 201) throw new Error(`C3 derogation -> ${der.status} ${JSON.stringify(der.data)}`)

    let page = await loginPage(browser, colSans.email, 'RecetteGMES@2026!')
    await collabOpenAndSubmit(page, typeC3.name, 'UI')
    await capture(page, 'CAP-CIRCUIT3-COLLAB-SOUMIS.png')
    await page.close().catch(() => {})
    out['C3-submitted'] = (await apiRequest(`/leave-requests/${req.id}`, { token: colSansToken })).data?.status

    // Prématuré : le Directeur ne doit pas pouvoir valider
    page = await loginPage(browser, 'directeur.recette@gmes.fr')
    out['C3-dir-premature-validate-btn'] = await dirOpenCountValidate(page, typeC3.name)
    await capture(page, 'CAP-CIRCUIT3-DIR-PREMATURE.png')
    await page.close().catch(() => {})

    // RH accepte la dérogation + signe
    page = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page, typeC3.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT3-RH-DEROG-VISIBLE.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RH')
    await capture(page, 'CAP-CIRCUIT3-RH-VALIDE.png')
    await page.close().catch(() => {})
    out['C3-after-rh'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: rh })).data?.status

    // Directeur valide et signe (final)
    page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await dirOpenRequest(page, typeC3.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT3-DIR-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'DR')
    await capture(page, 'CAP-CIRCUIT3-DIR-VALIDE.png')
    await page.close().catch(() => {})
    out['C3-final'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: dir })).data?.status
  }

  // ================= CIRCUIT 4 : Collab -> RH (dérogation) -> Responsable =================
  {
    const d = nextNearDate()
    const req = (await apiRequest('/leave-requests', { method: 'POST', token: colAvecToken, body: { leaveTypeId: typeC4.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = await apiRequest('/derogations', { method: 'POST', token: colAvecToken, body: { leaveRequestId: req.id, reason: 'Dérogation UI circuit 4' } })
    if (der.status !== 201) throw new Error(`C4 derogation -> ${der.status} ${JSON.stringify(der.data)}`)

    let page = await loginPage(browser, colAvec.email, 'RecetteGMES@2026!')
    await collabOpenAndSubmit(page, typeC4.name, 'UI')
    await capture(page, 'CAP-CIRCUIT4-COLLAB-SOUMIS.png')
    await page.close().catch(() => {})
    out['C4-submitted'] = (await apiRequest(`/leave-requests/${req.id}`, { token: colAvecToken })).data?.status

    // Prématuré : le Responsable ne doit pas pouvoir valider
    page = await loginPage(browser, 'responsable.recette@gmes.fr')
    out['C4-resp-premature-validate-btn'] = await mgrOpenCountValidate(page, typeC4.name)
    await capture(page, 'CAP-CIRCUIT4-RESP-PREMATURE.png')
    await page.close().catch(() => {})

    // RH accepte la dérogation + signe
    page = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page, typeC4.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT4-RH-DEROG-VISIBLE.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RH')
    await capture(page, 'CAP-CIRCUIT4-RH-VALIDE.png')
    await page.close().catch(() => {})
    out['C4-after-rh'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: rh })).data?.status

    // Responsable valide et signe (final)
    page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await mgrOpenRequest(page, typeC4.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT4-RESP-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RS')
    await capture(page, 'CAP-CIRCUIT4-RESP-VALIDE.png')
    await page.close().catch(() => {})
    out['C4-final'] = (await apiRequest(`/leave-requests/management/${req.id}`, { token: resp })).data?.status
  }

  await browser.close()

  // Vérification finale en base
  const c = await dbConn()
  const [rows] = await c.query(
    `SELECT lr.id, lr.status, lr.final_decider_role, lr.validator_signed_at, lr.employee_signed_at,
            (SELECT COUNT(*) FROM audit_logs a WHERE a.resource_type='LEAVE_REQUESTS' AND a.resource_id=lr.id AND a.action='DEMANDE_PREVALIDEE') AS prevalidations,
            (SELECT COUNT(*) FROM audit_logs a WHERE a.resource_type='LEAVE_REQUESTS' AND a.resource_id=lr.id AND a.action='DEMANDE_VALIDEE') AS validations
     FROM leave_requests lr
     WHERE lr.leave_type_id IN (?, ?, ?)
     ORDER BY lr.id ASC`,
    [typeC2.id, typeC3.id, typeC4.id],
  )
  await c.end()
  out['db-final'] = rows

  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
