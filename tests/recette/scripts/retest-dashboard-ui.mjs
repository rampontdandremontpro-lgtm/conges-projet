// Retest UI du tableau de bord collaborateur : suppression du bloc bleu,
// remontée des Alertes, suppression de la barre de progression, sélecteur
// de période N-1/N/N+1, affichage "Dans" (Aujourd'hui / Demain / numérique).
// Base : gestion_conges_gmes_test. Frontend test : 5174 -> backend 3001.

import { apiRequest, login, loginPage, capture, ensurePreuves, launch, todayIso, isoAddDays } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'DASH' + Date.now().toString(36)
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
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')

  const fullType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data

  const mkCol = async (suffix) => {
    const u = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'DASH', prenom: suffix, email: `dash.${suffix.toLowerCase()}.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
    return { ...u, token: signAccessToken({ id: u.id, email: u.email, role: 'COLLABORATEUR' }) }
  }

  async function validatedLeave(colToken, startDate) {
    const r = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate, endDate: startDate, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    await apiRequest(`/leave-requests/${r.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO', derogationReason: 'test dashboard' } })
    await apiRequest(`/leave-requests/${r.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
    await apiRequest(`/leave-requests/${r.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    return r
  }

  const today = todayIso()
  const tomorrow = advanceToWeekday(isoAddDays(today, 1))
  const numeric = advanceToWeekday(isoAddDays(today, 6))

  const colAujourdhui = await mkCol('Auj')
  const colDemain = await mkCol('Dem')
  const colNumerique = await mkCol('Num')

  await validatedLeave(colAujourdhui.token, today)
  await validatedLeave(colDemain.token, tomorrow)
  await validatedLeave(colNumerique.token, numeric)

  const browser = await launch()

  async function inspect(email, label) {
    const page = await loginPage(browser, email, 'RecetteGMES@2026!')
    await page.waitForSelector('.dash-grid', { timeout: 15000 })

    const planCount = await page.locator('.plan-card').count()
    const progressCount = await page.locator('.next-leave__progress').count()

    const sideCards = await page.locator('.dash-col--side > section').evaluateAll((sections) => sections.map((section) => {
      const h2 = section.querySelector('h2')
      return h2 ? h2.textContent.trim() : section.className
    }))

    const periodLabels = await page.locator('.balance-card-period-select select option').evaluateAll((options) => options.map((o) => o.textContent.trim()))

    const dansFigure = page.locator('.next-leave__stat').filter({ hasText: 'Dans' }).locator('.next-leave__stat-figure')
    const dansText = await dansFigure.innerText()
    const dansClass = await dansFigure.getAttribute('class')
    const dansUnit = await page.locator('.next-leave__stat').filter({ hasText: 'Dans' }).locator('.next-leave__stat-unit').count()

    out[label] = {
      planCardRemoved: planCount === 0,
      progressBarRemoved: progressCount === 0,
      sideCards,
      dansText,
      dansTextual: dansClass?.includes('next-leave__stat-figure--text') ?? false,
      dansUnit: dansUnit > 0,
    }
    if (!out.periodLabels) out.periodLabels = periodLabels

    await capture(page, `CAP-DASH-${label}.png`)
    await page.close().catch(() => {})
  }

  await inspect(colNumerique.email, 'numerique')
  await inspect(colDemain.email, 'demain')
  await inspect(colAujourdhui.email, 'aujourdhui')

  // Responsive mobile.
  const pageMobile = await loginPage(browser, colNumerique.email, 'RecetteGMES@2026!')
  await pageMobile.waitForSelector('.dash-grid', { timeout: 15000 })
  await pageMobile.setViewportSize({ width: 390, height: 844 })
  await pageMobile.waitForTimeout(400)
  out['mobile'] = {
    planCardRemoved: (await pageMobile.locator('.plan-card').count()) === 0,
    gridSingleColumn: await pageMobile.evaluate(() => {
      const grid = document.querySelector('.dash-grid')
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1 : false
    }),
  }
  await capture(pageMobile, 'CAP-DASH-MOBILE.png')
  await pageMobile.close().catch(() => {})

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
