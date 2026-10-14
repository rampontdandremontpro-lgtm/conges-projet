// Retest UI du rendu du calendrier collaborateur : pastilles colorées +
// info-bulle au survol, sans casser le blocage ni la sélection.
// Base : gestion_conges_gmes_test. Frontend test : 5174 -> backend 3001.

import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'RENDU' + Date.now().toString(36)
const out = {}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')

  const fullType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP FULL ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP HALF ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `ABS ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'RENDU', prenom: 'Col', email: `rendu.col.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const colToken = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })

  const D_BROUILLON = '2026-11-23'
  const D_ATTENTE = '2026-11-24'
  const D_VALIDEE = '2026-11-25'
  const D_ABSENCE = '2026-11-26'
  const D_HALF = '2026-11-27'
  const D_LIBRE = '2026-11-19'

  // Brouillon (gris).
  await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate: D_BROUILLON, endDate: D_BROUILLON, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  // En attente (orange) : brouillon + soumission.
  const att = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate: D_ATTENTE, endDate: D_ATTENTE, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  const attSub = await apiRequest(`/leave-requests/${att.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })

  // Validée (vert) : brouillon + soumission + RH + Directeur.
  const val = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: fullType.id, startDate: D_VALIDEE, endDate: D_VALIDEE, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${val.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
  await apiRequest(`/leave-requests/${val.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  const valDir = await apiRequest(`/leave-requests/${val.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

  // Absence (violet).
  await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: col.id, leaveTypeId: absenceType.id, startDate: D_ABSENCE, endDate: D_ABSENCE, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  // Demi-journée matin (brouillon).
  await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: halfType.id, startDate: D_HALF, endDate: D_HALF, startPeriod: 'MATIN', endPeriod: 'MATIN' } })

  out['setup'] = { attente: attSub.status, validee: valDir.status }

  const browser = await launch()
  const page = await loginPage(browser, col.email, 'RecetteGMES@2026!')
  await navigateViaSidebar(page, '/app/new-request')
  await page.waitForSelector('.nr-types', { timeout: 15000 })
  await page.locator('.nr-types__pill', { hasText: fullType.name }).first().click()
  await page.waitForTimeout(500)

  const cellInfo = async (iso) => page.evaluate((d) => {
    const btn = document.querySelector(`button.nr-cal__cell[aria-label="${d}"]`)
    if (!btn) return null
    const circle = btn.querySelector('.nr-cal__day-circle')
    const cs = btn ? getComputedStyle(btn) : null
    const cc = circle ? getComputedStyle(circle) : null
    return {
      title: btn.getAttribute('title'),
      className: btn.className,
      cellBg: cs?.backgroundColor,
      cellBgImage: cs?.backgroundImage,
      circleBg: cc?.backgroundColor,
      circleBgImage: cc?.backgroundImage,
      ariaDisabled: btn.getAttribute('aria-disabled'),
    }
  }, iso)

  const brouillon = await cellInfo(D_BROUILLON)
  const attente = await cellInfo(D_ATTENTE)
  const validee = await cellInfo(D_VALIDEE)
  const absence = await cellInfo(D_ABSENCE)
  const half = await cellInfo(D_HALF)
  const libre = await cellInfo(D_LIBRE)

  out['brouillon'] = {
    tooltip: brouillon?.title,
    tone: brouillon?.className?.includes('nr-cal__cell--tone-draft'),
    circleColored: (brouillon?.circleBg && brouillon.circleBg !== 'rgba(0, 0, 0, 0)') || (brouillon?.circleBgImage && brouillon.circleBgImage !== 'none'),
    cellTransparent: brouillon?.cellBg === 'rgba(0, 0, 0, 0)' && brouillon?.cellBgImage === 'none',
  }
  out['attente'] = {
    tooltip: attente?.title,
    tone: attente?.className?.includes('nr-cal__cell--tone-pending'),
  }
  out['validee'] = {
    tooltip: validee?.title,
    tone: validee?.className?.includes('nr-cal__cell--tone-validated'),
  }
  out['absence'] = {
    tooltip: absence?.title,
    tone: absence?.className?.includes('nr-cal__cell--tone-absence-pending'),
  }
  out['half'] = {
    tooltip: half?.title,
    halfClass: half?.className?.includes('nr-cal__cell--occ-am'),
    cellTransparent: half?.cellBg === 'rgba(0, 0, 0, 0)' && half?.cellBgImage === 'none',
    circleHalf: half?.circleBgImage !== 'none' && half?.circleBgImage?.includes('linear-gradient'),
  }
  out['libre'] = {
    tooltip: libre?.title ?? null,
    noOccupancyClass: !(libre?.className?.includes('nr-cal__cell--occupied') || libre?.className?.includes('nr-cal__cell--occ-am') || libre?.className?.includes('nr-cal__cell--occ-pm')),
  }

  // Non-régression : le jour brouillon (type journée) reste non cliquable.
  const blockedClick = await page.evaluate((d) => {
    const btn = document.querySelector(`button.nr-cal__cell[aria-label="${d}"]`)
    return btn?.getAttribute('aria-disabled')
  }, D_BROUILLON)
  out['brouillon-bloque'] = blockedClick === 'true'

  await capture(page, 'CAP-RENDU-1-PASTILLES-COLOREES.png')

  // Vue mobile (viewport étroit) pour vérifier l'absence de débordement.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await capture(page, 'CAP-RENDU-2-MOBILE.png')

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
