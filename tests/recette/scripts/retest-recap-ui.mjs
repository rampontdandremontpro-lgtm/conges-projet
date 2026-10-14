// Retest du panneau « Récapitulatif » (Nouvelle demande) :
// - message de dérogation avec délai calendaire explicite (30 / 60 jours).
// - disposition « Congé anticipé — Période N+1 ».
// Base : gestion_conges_gmes_test. Frontend test : 5174 -> backend 3001.

import { apiRequest, login, loginPage, ensurePreuves, launch, navigateViaSidebar, todayIso, isoAddDays } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'RECAPUI' + Date.now().toString(36)
const out = {}

function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let d = iso
  for (let i = 0; i < 7; i++) {
    const wd = weekday(d)
    if (wd >= 1 && wd <= 5) return d
    d = isoAddDays(d, 1)
  }
  return d
}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')

  const mkType = async (label, deducts) => (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: deducts, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const nearType = await mkType('NEAR', false)
  const at30Type = await mkType('J30', false)
  const longType = await mkType('LONG', false)
  const n1Type = await mkType('SOLDE', true)

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'RECAP', prenom: 'Col', email: `recap.col.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const token = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })

  const today = todayIso()
  const near = advanceToWeekday(isoAddDays(today, 22))
  const at30 = advanceToWeekday(isoAddDays(today, 30))
  const longStart = advanceToWeekday(isoAddDays(today, 40))
  const longEnd = advanceToWeekday(isoAddDays(longStart, 21))
  const n1 = '2027-06-15'

  const mkDraft = async (typeId, start, end) => (await apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: typeId, startDate: start, endDate: end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await mkDraft(nearType.id, near, near)
  await mkDraft(at30Type.id, at30, at30)
  await mkDraft(longType.id, longStart, longEnd)
  await mkDraft(n1Type.id, n1, n1)

  const browser = await launch()
  const page = await loginPage(browser, col.email, 'RecetteGMES@2026!')

  async function openDraft(typeName) {
    await navigateViaSidebar(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 15000 })
    await page.locator('.my-request-card', { hasText: typeName }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 15000 })
    await page.waitForSelector('.nr-recap', { timeout: 15000 })
  }

  // 1. < 30 jours -> message 30 jours
  await openDraft(nearType.name)
  out['near30'] = {
    warnVisible: (await page.locator('.nr-notice--warn').count()) > 0,
    message: (await page.locator('.nr-notice--warn em').innerText()).trim(),
  }

  // 2. 30 jours -> délai respecté
  await openDraft(at30Type.name)
  out['at30'] = {
    okVisible: (await page.locator('.nr-notice--ok').count()) > 0,
    warnVisible: (await page.locator('.nr-notice--warn').count()) > 0,
    okMessage: (await page.locator('.nr-notice--ok em').innerText()).trim(),
  }

  // 3. Longue durée (>= 21 jours) -> message 60 jours
  await openDraft(longType.name)
  out['long60'] = {
    warnVisible: (await page.locator('.nr-notice--warn').count()) > 0,
    message: (await page.locator('.nr-notice--warn em').innerText()).trim(),
  }

  // 4. N+1 -> disposition Congé anticipé
  await openDraft(n1Type.name)
  const badgeCount = await page.locator('.nr-anticipated-badge').count()
  const headCount = await page.locator('.nr-anticipated-panel__head').count()
  const strong = headCount > 0 ? (await page.locator('.nr-anticipated-panel__head strong').innerText()).trim() : null
  const iconSameLine = headCount > 0 ? (await page.locator('.nr-anticipated-panel__head .nr-anticipated-panel__icon').count()) > 0 : false
  const text = (await page.locator('.nr-anticipated-panel__text').innerText()).trim()
  out['n1'] = {
    badge: badgeCount > 0 ? 'Période N+1' : null,
    headPresent: headCount > 0,
    strong,
    iconSameLine,
    text,
  }

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
