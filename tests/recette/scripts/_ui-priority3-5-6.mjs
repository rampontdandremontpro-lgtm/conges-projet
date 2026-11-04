// P3 : calendrier RH intelligent (jours occupés du salarié sélectionné).
// P5 : bouton « Enregistrer mon indisponibilité » retiré de la carte
//      « Points d'attention » du tableau de bord Directeur.
// P6 : légendes Brouillon/En attente/Validé/Absence retirées du calendrier
//      d'indisponibilité du Directeur.
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function loginPage(page, email) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'P3' + Date.now().toString(36)

  // Collaborateur avec un congé VALIDÉ sur 2026-11-20.
  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `CAL-${TAG}`, prenom: 'Recette', email: `cal-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-11-20','2026-11-20', 1, 1, 'VALIDEE')",
    [emp.id, type.id],
  )

  const browser = await chromium.launch({ headless: true })
  const errors = []

  // ── P3 : calendrier RH — le jour occupé est bloqué ──────────────────────
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh.on('pageerror', (e) => errors.push(String(e)))
  await loginPage(rh, 'rh.recette@gmes.fr')
  await rh.click('a[href="/app/rh-leaves-absences"]')
  await rh.waitForURL('**/app/rh-leaves-absences', { timeout: 15000 })
  await rh.waitForSelector('.rh-events-create', { timeout: 10000 })
  await rh.click('.rh-events-create')
  await rh.waitForSelector('.rh-declaration-form', { timeout: 10000 })
  await rh.locator('.rh-declaration-form select').first().selectOption(String(emp.id))
  await rh.locator('.rh-declaration-form select').nth(1).selectOption(`CONGE:${type.id}`)
  await rh.waitForTimeout(1500)
  const dayButton = rh.locator('button[aria-label="2026-11-20"]').first()
  const dayCount = await dayButton.count()
  let blocked = false
  if (dayCount > 0) {
    const cls = await dayButton.getAttribute('class').catch(() => '')
    const aria = await dayButton.getAttribute('aria-disabled').catch(() => '')
    blocked = cls?.includes('blocked') || cls?.includes('occupied') || aria === 'true'
  }
  rec('P3-RH-CALENDAR-BLOCKED', 'RH : le jour du congé validé du salarié est bloqué dans le calendrier', dayCount > 0 && blocked, `dayCount=${dayCount} blocked=${blocked}`)
  await rh.close()

  // ── P6 : Directeur — légendes simplifiées sur son calendrier d'indispo ──
  const dir = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  dir.on('pageerror', (e) => errors.push(String(e)))
  await loginPage(dir, 'directeur.recette@gmes.fr')
  await dir.click('a[href="/app/director-availability"]').catch(() => {})
  await dir.waitForTimeout(1800)
  const legendText = await dir.locator('.nr-cal__legend').innerText().catch(() => '')
  const hasRemovedLegends = !/Brouillon/.test(legendText) && !/En attente/.test(legendText) && !/Validé/.test(legendText) && !/Absence/.test(legendText)
  rec('P6-DIRECTEUR-LEGENDE', 'Directeur : légendes Brouillon/En attente/Validé/Absence retirées de son calendrier', hasRemovedLegends, legendText.replace(/\n/g, ' | ').slice(0, 100))
  await dir.close()

  // ── P5 : Directeur — bouton retiré de la carte « Points d'attention » ───
  const dir2 = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  dir2.on('pageerror', (e) => errors.push(String(e)))
  await loginPage(dir2, 'directeur.recette@gmes.fr')
  await dir2.waitForTimeout(1500)
  const attentionCard = dir2.locator('.director-attention-card').first()
  const attentionText = await attentionCard.innerText().catch(() => '')
  const buttonRemoved = !/Enregistrer mon indisponibilité/.test(attentionText)
  rec('P5-DIRECTEUR-ATTENTION', 'Directeur : bouton « Enregistrer mon indisponibilité » absent de la carte Points d’attention', buttonRemoved, attentionText.slice(0, 90))
  const availabilityLinkStillThere = await dir2.locator('a[href="/app/director-availability"]').count() > 0
  rec('P5-DIRECTEUR-NAV', 'Directeur : l’accès normal à l’indisponibilité reste présent', availabilityLinkStillThere)
  await dir2.close()

  rec('P356-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nVÉRIFS P3/P5/P6 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P3/P5/P6 :', e); process.exit(1) })
