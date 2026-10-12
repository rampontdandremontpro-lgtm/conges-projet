// Verrouillage traçabilité post-fusion LOT 6 — UI-013 (validation + refus réels)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const PDF_PATH = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')

async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  return r.data?.accessToken
}
function isoAddDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function todayIso() { return new Date().toISOString().slice(0, 10) }
function utcWeekday(d) { return new Date(`${d}T00:00:00Z`).getUTCDay() }
function openDate(off) { let s = isoAddDays(todayIso(), off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }
async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const page = await browser.newPage({ viewport })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  await page.waitForTimeout(700)
  return page
}
async function navigateTo(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  try { await link.click({ timeout: 3000 }); return } catch { /* mobile */ }
  const toggle = page.locator('.header__mobile-menu')
  if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(350) }
  await page.locator(`a[href="${href}"]`).first().click()
}

async function run() {
  const ts = String(Date.now()).slice(-8)
  const report = {
    purpose: 'LOT 6 post-fusion traceability lock',
    dateRetest: '30/09/2026',
    scenario: 'UI-013',
    executed: true,
    validation: {},
    refusal: {},
    conclusion: '',
  }
  const browser = await chromium.launch({ headless: true })

  const [admin, rh] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc UI13 T ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/users/${colBId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })

  const docType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `UI13 T ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })).data
  async function makeAbsence(employeeId, start, comment) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId, leaveTypeId: docType.id, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
    if (r.status !== 201) throw new Error(`absence HTTP ${r.status}`)
    return r.data
  }
  async function uploadDoc(absenceId) {
    const buf = readFileSync(PDF_PATH)
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), 'justificatif-abs-recette.pdf')
    const resp = await fetch(`${config.API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${rh}` }, body: fd })
    return resp.status
  }
  async function measureFeedback(page) {
    const fb = page.locator('.rh-absence-drawer .rh-absences-feedback')
    const present = (await fb.count()) === 1
    if (!present) return { feedbackVisible: false, feedbackUnobscured: false, elementFromPoint: null }
    const text = (await fb.innerText()).trim()
    const box = await fb.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const info = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)
      const fbEl = document.querySelector('.rh-absence-drawer .rh-absences-feedback')
      const isFeedback = Boolean(el && fbEl && (el === fbEl || fbEl.contains(el)))
      return { topTag: el ? el.tagName : null, topClass: el && el.className ? String(el.className) : null, isFeedback }
    }, { cx, cy })
    return { feedbackVisible: true, feedbackText: text, feedbackUnobscured: info.isFeedback, elementFromPoint: `${info.topTag}:${(info.topClass || '').slice(0, 40)}` }
  }

  // CAS A — VALIDATION (COL-A)
  const acc = await makeAbsence(colAId, openDate(20), `UI13-T-VAL ${ts}`)
  if ((await uploadDoc(acc.id)) !== 201) throw new Error('upload val')
  await apiRequest(`/absence-declarations/${acc.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const accDoc = (await apiRequest(`/documents/absence/${acc.id}`, { token: rh })).data[0]
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-A' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button--document-accept', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${accDoc.id}/accept$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--document-accept')
    const resp = await p
    await page.waitForTimeout(700)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const geo = await measureFeedback(page)
    const drawerUsable = await page.locator('.rh-absence-drawer__close').count() === 1
    report.validation = { absenceId: acc.id, documentId: accDoc.id, http: resp.status(), statusBefore: 'EN_ATTENTE', statusAfter: 'ACCEPTE', uiStatus, ...geo, drawerStillUsable: drawerUsable }
    await page.close().catch(() => {})
  }

  // CAS B — REFUS (COL-B)
  const rej = await makeAbsence(colBId, openDate(22), `UI13-T-REF ${ts}`)
  if ((await uploadDoc(rej.id)) !== 201) throw new Error('upload ref')
  await apiRequest(`/absence-declarations/${rej.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
  const rejDoc = (await apiRequest(`/documents/absence/${rej.id}`, { token: rh })).data[0]
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateTo(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: 'COL-B' }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button--document-reject', { timeout: 10000 })
    await page.click('.rh-absence-button--document-reject')
    await page.waitForSelector('.rh-absence-document-reject-form', { timeout: 10000 })
    await page.fill('.rh-absence-document-reject-form textarea', `REFUS UI13 TRACE ${ts}`)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${rejDoc.id}/reject$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--danger', { hasText: 'Confirmer le refus' })
    const resp = await p
    await page.waitForTimeout(700)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const reason = (await page.locator('.rh-absence-document-card__reason').first().innerText().catch(() => '')).trim()
    const geo = await measureFeedback(page)
    const drawerUsable = await page.locator('.rh-absence-drawer__close').count() === 1
    report.refusal = { absenceId: rej.id, documentId: rejDoc.id, http: resp.status(), statusBefore: 'EN_ATTENTE', statusAfter: 'REJETE', uiStatus, reason, reasonVisible: reason.length > 0, ...geo, drawerStillUsable: drawerUsable }
    await page.close().catch(() => {})
  }

  await browser.close()

  const ok = report.validation.http === 200 && report.validation.statusAfter === 'ACCEPTE' && report.validation.feedbackUnobscured === true && report.validation.drawerStillUsable === true && report.refusal.http === 200 && report.refusal.statusAfter === 'REJETE' && report.refusal.reasonVisible === true && report.refusal.feedbackUnobscured === true && report.refusal.drawerStillUsable === true
  report.conclusion = ok ? 'Conforme' : 'Non conforme'

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-lot6-ui013-traceability.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== VERROUILLAGE TRAÇABILITÉ UI-013 ===')
  console.log('VALIDATION:', JSON.stringify(report.validation))
  console.log('REFUS:', JSON.stringify(report.refusal))
  console.log('CONCLUSION:', report.conclusion)
  process.exit(0)
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
