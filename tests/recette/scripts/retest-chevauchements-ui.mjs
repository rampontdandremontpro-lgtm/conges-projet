// Retest UI (Playwright) du calendrier collaborateur : couleurs, blocage des
// chevauchements, demi-journées, légende et message de refus.
// Base : gestion_conges_gmes_test. Frontend test : 5174 -> backend 3001.

import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'OVLUI' + Date.now().toString(36)
const out = {}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')

  const fullType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP FULL ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP HALF ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `ABS ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'OVLUI', prenom: 'Col', email: `ovlui.col.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const colToken = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })

  const D_DRAFT = '2026-10-20'
  const D_ABS = '2026-10-21'
  const D_BLOCK = '2026-10-22'

  // Brouillon (gris) plein sur D_DRAFT.
  const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate: D_DRAFT, endDate: D_DRAFT, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  // Absence (violet) matin sur D_ABS.
  const absence = (await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: col.id, leaveTypeId: absenceType.id, startDate: D_ABS, endDate: D_ABS, startPeriod: 'MATIN', endPeriod: 'MATIN' } })).data
  // Second brouillon plein sur D_BLOCK (pour le message de plage).
  const blockDraft = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate: D_BLOCK, endDate: D_BLOCK, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data

  const browser = await launch()
  const page = await loginPage(browser, col.email, 'RecetteGMES@2026!')
  await navigateViaSidebar(page, '/app/new-request')
  await page.waitForSelector('.nr-types', { timeout: 15000 })

  // ===== Légende =====
  await page.waitForSelector('.nr-cal__legend', { timeout: 15000 })
  const legendText = await page.locator('.nr-cal__legend').innerText()
  out['legend'] = {
    brouillon: legendText.includes('Brouillon'),
    attente: legendText.includes('En attente'),
    valide: legendText.includes('Validé'),
    absence: legendText.includes('Absence'),
  }
  await capture(page, 'CAP-OVLUI-1-LEGENDE.png')

  // ===== Type journée complète : brouillon gris et bloqué =====
  await page.locator('.nr-types__pill', { hasText: fullType.name }).first().click()
  await page.waitForTimeout(400)
  const draftCell = page.locator(`button.nr-cal__cell[aria-label="${D_DRAFT}"]`)
  const draftClass = await draftCell.getAttribute('class')
  out['draft-colored'] = draftClass?.includes('nr-cal__cell--occupied') && draftClass?.includes('nr-cal__cell--tone-draft')
  out['draft-disabled'] = await draftCell.isDisabled()
  await capture(page, 'CAP-OVLUI-2-BROUILLON-GRIS.png')

  // ===== Type demi-journée : absence matin -> après-midi encore possible =====
  await page.locator('.nr-types__pill', { hasText: halfType.name }).first().click()
  await page.waitForTimeout(400)
  const absCell = page.locator(`button.nr-cal__cell[aria-label="${D_ABS}"]`)
  const absClass = await absCell.getAttribute('class')
  out['absence-colored'] = absClass?.includes('nr-cal__cell--occ-am') && absClass?.includes('nr-cal__cell--tone-absence-pending')
  out['absence-not-disabled'] = !(await absCell.isDisabled())

  // Clic 2x sur D_ABS -> popover demi-journée.
  await absCell.click()
  await page.waitForTimeout(250)
  await absCell.click()
  await page.waitForSelector('.nr-cal__period-popover', { timeout: 10000 })
  const popover = page.locator('.nr-cal__period-popover')
  const matinBtn = popover.locator('button', { hasText: 'Matin' }).first()
  const pmBtn = popover.locator('button', { hasText: 'Après-midi' }).first()
  const fullBtn = popover.locator('button', { hasText: 'Journée entière' }).first()
  out['popover-matin-disabled'] = await matinBtn.isDisabled()
  out['popover-apresmidi-enabled'] = !(await pmBtn.isDisabled())
  out['popover-full-disabled'] = await fullBtn.isDisabled()
  await capture(page, 'CAP-OVLUI-3-DEMI-JOURNEE.png')
  // Fermer le popover.
  await page.locator('.nr-cal__period-popover-close').click()

  // ===== Message de refus sur plage traversant un créneau occupé =====
  await page.locator('.nr-types__pill', { hasText: fullType.name }).first().click()
  await page.waitForTimeout(400)
  await page.locator(`button.nr-cal__cell[aria-label="2026-10-19"]:not([disabled])`).first().click()
  await page.waitForTimeout(250)
  await page.locator(`button.nr-cal__cell[aria-label="2026-10-23"]:not([disabled])`).first().click()
  await page.waitForSelector('.nr-toast__message', { timeout: 8000 })
  const toastText = await page.locator('.nr-toast__message').innerText()
  out['range-blocked-message'] = toastText
  await capture(page, 'CAP-OVLUI-4-REFUS-PLAGE.png')

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
