// Parcours UI (Playwright) des circuits GMES — Circuit 1 complet + circuit 4 avec dérogation.
// Actions réelles via interface, captures dans tests/recette/preuves.

import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves, dbConn } from '../helpers/runner-utils.mjs'

const TAG = 'UIC' + Date.now().toString(36)
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
let cursor = isoAddDays(todayIso(), 42)
function nextDate() { cursor = advanceToWeekday(cursor); const d = cursor; cursor = isoAddDays(cursor, 1); return d }
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

async function rhOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/rh-leaves-absences')
  await page.waitForSelector('.rh-events-filters', { timeout: 15000 })
  await page.locator('.rh-events-filters label', { hasText: 'TYPE' }).locator('select').selectOption({ label: typeName })
  await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
  await page.locator('.rh-events-row--data').first().click()
  await page.waitForURL('**/rh-all-requests/**', { timeout: 15000 })
}

async function dirOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/director-all-requests')
  await page.waitForSelector('.director-all-requests-filter-button', { timeout: 15000 })
  const open = await page.locator('.director-all-requests-filter-panel').count()
  if (open === 0) await page.click('.director-all-requests-filter-button')
  await page.waitForSelector('.director-all-requests-filter-panel', { timeout: 15000 })
  await page.locator('.director-all-requests-filter-panel label', { hasText: 'Type de congé' }).locator('select').selectOption({ label: typeName })
  await page.waitForSelector('.director-all-requests-row--data', { timeout: 15000 })
  await page.locator('.director-all-requests-row--data').first().click()
  await page.waitForURL('**/director-all-requests/**', { timeout: 15000 })
}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')
  const resp = await login('responsable.recette@gmes.fr')
  const respId = (await apiRequest('/users/me', { token: resp })).data.id

  const svcSans = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `UI-SANS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const svcAvec = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `UI-AVEC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svcAvec.id } })
  await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const mkUser = async (suffix, serviceId) => (await apiRequest('/users', { method: 'POST', token: admin, body: {
    nom: 'UICOL', prenom: suffix, email: `uicol.${suffix.toLowerCase()}.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId, hireDate: '2026-01-06',
  } })).data
  const colSans = await mkUser('SANS', svcSans.id)
  const colAvec = await mkUser('AVEC', svcAvec.id)

  const type = async (label) => (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP UI ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const typeSans = await type('SANS')
  const typeDerog = await type('DEROG')

  const { signAccessToken } = await import('../helpers/tokens.mjs')
  const colSansToken = signAccessToken({ id: colSans.id, email: colSans.email, role: 'COLLABORATEUR' })
  const colAvecToken = signAccessToken({ id: colAvec.id, email: colAvec.email, role: 'COLLABORATEUR' })

  // Draft Circuit 1 via API (la suite est 100% UI).
  const d1 = nextDate()
  const req1 = (await apiRequest('/leave-requests', { method: 'POST', token: colSansToken, body: { leaveTypeId: typeSans.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data

  const browser = await launch()

  // ===== Circuit 1 UI : collaborateur signe et soumet =====
  {
    const page = await loginPage(browser, colSans.email, 'RecetteGMES@2026!')
    await navigateViaSidebar(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 15000 })
    await page.locator('.my-request-card', { hasText: typeSans.name }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 15000 })
    await page.waitForSelector('.nr-recap__actions', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT1-COLLAB-DRAFT.png')
    await page.locator('.nr-recap__actions .nr-btn--primary', { hasText: 'Signer et soumettre' }).click()
    await collaboratorSignSubmit(page, 'UI')
    await page.waitForURL('**/my-requests**', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT1-COLLAB-SOUMIS.png')
    await page.close().catch(() => {})
  }
  out['C1-submitted'] = (await apiRequest(`/leave-requests/${req1.id}`, { token: colSansToken })).data

  // ===== Circuit 1 UI : RH valide et signe =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page, typeSans.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT1-RH-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RH')
    await capture(page, 'CAP-CIRCUIT1-RH-VALIDE.png')
    await page.waitForTimeout(800)
    await page.close().catch(() => {})
  }
  out['C1-after-rh'] = (await apiRequest(`/leave-requests/management/${req1.id}`, { token: rh })).data

  // ===== Circuit 1 UI : Directeur valide et signe =====
  {
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await dirOpenRequest(page, typeSans.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT1-DIR-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'DR')
    await capture(page, 'CAP-CIRCUIT1-DIR-VALIDE.png')
    await page.waitForTimeout(800)
    await page.close().catch(() => {})
  }
  out['C1-after-dir'] = (await apiRequest(`/leave-requests/management/${req1.id}`, { token: dir })).data

  // ===== Circuit 4 UI (dérogation) : collaborateur soumet avec dérogation, RH valide =====
  let req4Id = null
  {
    const d4 = nextNearDate()
    const req4 = (await apiRequest('/leave-requests', { method: 'POST', token: colAvecToken, body: { leaveTypeId: typeDerog.id, startDate: d4, endDate: d4, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    req4Id = req4.id
    const der = await apiRequest('/derogations', { method: 'POST', token: colAvecToken, body: { leaveRequestId: req4.id, reason: 'Dérogation UI circuit 4' } })
    if (der.status !== 201) throw new Error(`derogation UI -> ${der.status} ${JSON.stringify(der.data)}`)

    const page = await loginPage(browser, colAvec.email, 'RecetteGMES@2026!')
    await navigateViaSidebar(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 15000 })
    await page.locator('.my-request-card', { hasText: typeDerog.name }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 15000 })
    await page.waitForSelector('.nr-recap__actions', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT4-COLLAB-DEROG.png')
    await page.locator('.nr-recap__actions .nr-btn--primary', { hasText: 'Signer et soumettre' }).click()
    await collaboratorSignSubmit(page, 'UI')
    await page.waitForURL('**/my-requests**', { timeout: 15000 })
    await capture(page, 'CAP-CIRCUIT4-COLLAB-SOUMIS.png')
    await page.close().catch(() => {})

    // RH : dérogation identifiable + validation premier niveau.
    const page2 = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page2, typeDerog.name)
    await page2.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page2, 'CAP-CIRCUIT4-RH-DEROG-VISIBLE.png')
    await page2.click('.manager-request-action--validate')
    await validatorSign(page2, 'RH')
    await capture(page2, 'CAP-CIRCUIT4-RH-VALIDE.png')
    await page2.waitForTimeout(800)
    await page2.close().catch(() => {})
  }
  out['C4-after-rh'] = (await apiRequest(`/leave-requests/management/${req4Id}`, { token: resp })).data

  await browser.close()

  // Vérification finale en base
  const c = await dbConn()
  const [rows] = await c.query(`SELECT id, status, final_decider_role, validator_signed_at FROM leave_requests WHERE id IN (?, ?)`, [req1.id, req4Id])
  await c.end()
  out['db-final'] = rows

  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
