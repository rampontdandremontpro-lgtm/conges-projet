// P4 : badge « Validée · traitement terminé » — profils RH et Directeur.
// Compare le badge de la page Dérogation (granted) à celui de la page
// « Congés & Absences » (RH) / « Demandes de congés » (Directeur).
import { chromium } from 'playwright'

import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function metrics(page, selector) {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return null
  const text = await el.innerText().catch(() => '')
  const style = await el.evaluate((node) => {
    const cs = window.getComputedStyle(node)
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      overflowX: node.scrollWidth > node.clientWidth,
    }
  }).catch(() => null)
  return { text, style }
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'P4D' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `P4D-${TAG}`, prenom: 'Rec', email: `p4d-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  const leaveType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, decision_at) VALUES (?, ?, '2026-11-05','2026-11-05', 1, 1, 'VALIDEE', NOW())",
    [emp.id, leaveType.id],
  )
  await conn.query(
    "INSERT INTO derogations (employee_id, leave_type_id, requested_start_date, requested_end_date, reason, status, decided_by_rh_id, decided_at) VALUES (?, ?, '2026-11-08','2026-11-08', 'Test badge', 'ACCORDEE', 2, NOW())",
    [emp.id, leaveType.id],
  )

  const browser = await chromium.launch({ headless: true })
  const errors = []

  async function measureProfile(loginEmail, derogNav, eventsNav, eventsSelector) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
    await page.fill('#login-email', loginEmail)
    await page.fill('#login-password', 'RecetteGMES@2026!')
    await page.click('.login-submit')
    await page.waitForURL('**/app/**', { timeout: 15000 })

    await page.click(`a[href="${derogNav}"]`).catch(() => {})
    await page.waitForTimeout(2500)
    const derog = await metrics(page, '.rh-derogation-status--granted')

    await page.click(`a[href="${eventsNav}"]`).catch(() => {})
    await page.waitForTimeout(2500)
    if (eventsNav.includes('director-all-requests')) {
      // La liste est paginée et les demandes en attente sont affichées en
      // premier : on filtre sur « Validées » pour garantir la présence du badge.
      await page.locator('button[role="tab"]', { hasText: 'Validées' }).first().click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    const events = await metrics(page, eventsSelector)

    // Mobile : redimensionne la page affichée (évite la navigation mobile).
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    const eventsMobile = await metrics(page, eventsSelector)

    await page.close()
    return { derog, events, eventsMobile }
  }

  const rh = await measureProfile('rh.recette@gmes.fr', '/app/rh-derogations', '/app/rh-leaves-absences', '.rh-events-status--approved')
  rec('P4-RH-COULEURS', 'RH : Dérogation et Congés & Absences ont les mêmes couleurs', rh.derog?.style?.color === rh.events?.style?.color && rh.derog?.style?.backgroundColor === rh.events?.style?.backgroundColor, `derog=${rh.derog?.style?.color} events=${rh.events?.style?.color}`)
  rec('P4-RH-NO-OVERFLOW', 'RH : aucun débordement (desktop + mobile)', !rh.derog?.style?.overflowX && !rh.events?.style?.overflowX && !rh.eventsMobile?.style?.overflowX, `derog=${rh.derog?.style?.overflowX} events=${rh.events?.style?.overflowX} mobile=${rh.eventsMobile?.style?.overflowX}`)

  const dir = await measureProfile('directeur.recette@gmes.fr', '/app/director-derogations', '/app/director-all-requests', '.director-request-status--approved')
  rec('P4-DIR-PRESENT', 'Directeur : badge « Validée · traitement terminé » présent (Dérogation + Demandes de congés)', Boolean(dir.derog?.text.includes('traitement terminé')) && Boolean(dir.events?.text.includes('traitement terminé')), `derog=${dir.derog?.text} events=${dir.events?.text}`)
  rec('P4-DIR-COULEURS', 'Directeur : Dérogation et Demandes de congés ont les mêmes couleurs', dir.derog?.style?.color === dir.events?.style?.color && dir.derog?.style?.backgroundColor === dir.events?.style?.backgroundColor, `derog=${dir.derog?.style?.color}/${dir.derog?.style?.backgroundColor} events=${dir.events?.style?.color}/${dir.events?.style?.backgroundColor}`)
  rec('P4-DIR-NO-OVERFLOW', 'Directeur : aucun débordement (desktop + mobile)', !dir.derog?.style?.overflowX && !dir.events?.style?.overflowX && !dir.eventsMobile?.style?.overflowX, `derog=${dir.derog?.style?.overflowX} events=${dir.events?.style?.overflowX} mobile=${dir.eventsMobile?.style?.overflowX}`)

  rec('P4-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nP4 BADGE (RH + Directeur) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR P4 BADGE :', e); process.exit(1) })
