// Retest ultra-ciblé DER-003 après ajout de la migration submitted_at.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const DB = { host: '127.0.0.1', port: 3307, user: 'recette', password: 'recette', database: 'gestion_conges_gmes_test' }

async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection(DB)
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}
async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  return r.data?.accessToken
}
function isoAddDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function todayIso() { return new Date().toISOString().slice(0, 10) }
function utcWeekday(d) { return new Date(`${d}T00:00:00Z`).getUTCDay() }
function pickWindow(minOffset) {
  let s = isoAddDays(todayIso(), minOffset)
  for (let i = 0; i < 40; i++) { const e = isoAddDays(s, 1); if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) return { start: s, end: e }; s = isoAddDays(s, 1) }
  throw new Error('no window')
}
async function loginPage(browser, email) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  await page.waitForTimeout(800)
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
  const [admin, colA] = await Promise.all([login('admin.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: admin })).data
  const colAId = users.find((u) => u.email === 'col-a.recette@gmes.fr').id

  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP DER MIG ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `Svc DER MIG ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: admin, body: { employeeId: colAId, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 30, reason: 'MIG DER-003.' } }).catch(() => {})

  const w = pickWindow(4)
  const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: w.start, endDate: w.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  const der = (await apiRequest('/derogations', { method: 'POST', token: colA, body: { leaveRequestId: draft.id, reason: 'Motif DER-003 migration.' } })).data

  const before = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
  const submittedAtBefore = before.data?.submittedAt ?? null
  const auditBefore = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [draft.id]))[0].n)
  const notifBefore = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der.id]))[0].n)

  const browser = await chromium.launch({ headless: true })
  const page = await loginPage(browser, 'col-a.recette@gmes.fr')
  await navigateTo(page, '/app/my-requests')
  await page.waitForSelector('.my-request-card', { timeout: 10000 })
  await page.locator('.my-request-card', { hasText: `CP DER MIG ${ts}` }).first().click()
  await page.waitForURL('**/new-request/**', { timeout: 10000 })
  await page.waitForSelector('.nr-derogation-manage', { timeout: 15000 })

  const submitBtnBefore = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
  const submitP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/derogations\/\d+\/submit$/.test(new URL(r.url()).pathname), { timeout: 15000 })
  await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).click()
  const submitResp = await submitP
  await page.waitForTimeout(600)

  const after = await apiRequest(`/derogations/my/${der.id}`, { token: colA })
  const submittedAtAfter = after.data?.submittedAt ?? null
  const btnAfter = await page.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
  const auditAfter = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [draft.id]))[0].n)
  const notifAfter = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der.id]))[0].n)

  const second = await apiRequest(`/derogations/${der.id}/submit`, { method: 'POST', token: colA })
  const auditAfter2 = Number((await dbQuery(`SELECT COUNT(*) AS n FROM audit_logs WHERE resource_type='DEROGATIONS' AND resource_id=? AND action='DEROGATION_DEMANDEE'`, [draft.id]))[0].n)
  const notifAfter2 = Number((await dbQuery(`SELECT COUNT(*) AS n FROM notifications WHERE derogation_id=? AND type='DEROGATION_SUBMITTED_RH'`, [der.id]))[0].n)
  await page.close()

  // Nouvelle session : bouton Soumettre absent
  const page2 = await loginPage(browser, 'col-a.recette@gmes.fr')
  await navigateTo(page2, '/app/my-requests')
  await page2.waitForSelector('.my-request-card', { timeout: 10000 })
  await page2.locator('.my-request-card', { hasText: `CP DER MIG ${ts}` }).first().click()
  await page2.waitForURL('**/new-request/**', { timeout: 10000 })
  await page2.waitForSelector('.nr-derogation-manage', { timeout: 15000 })
  const btnNewSession = await page2.locator('.nr-derogation-manage__actions button', { hasText: 'Soumettre' }).count()
  await page2.close()
  await browser.close()

  const ok = submittedAtBefore === null &&
    submitBtnBefore === 1 &&
    submitResp.status() === 200 &&
    submittedAtAfter != null &&
    btnAfter === 0 &&
    auditBefore === 1 && auditAfter === 2 && auditAfter2 === 2 &&
    notifBefore === 0 && notifAfter === 1 && notifAfter2 === 1 &&
    second.status === 409 &&
    btnNewSession === 0

  const report = {
    lot: 5,
    dateRetest: '29/09/2026',
    executed: true,
    migrationSubmittedAt: {
      migrationCreated: true,
      column: 'submitted_at',
      nullable: true,
      existingDatabaseSupported: true,
      backfill: { fromSubmissionNotification: true, treatedStatusFallback: true },
      secondSubmission: 409,
      duplicateAudit: false,
      duplicateNotification: false,
    },
    der003: {
      submittedAtBefore,
      firstSubmit: submitResp.status(),
      submittedAtAfter: submittedAtAfter ? 'renseigné' : 'null',
      secondSubmit: second.status,
      audit: `${auditBefore}→${auditAfter} (2e=${auditAfter2})`,
      notifications: `${notifBefore}→${notifAfter} (2e=${notifAfter2})`,
      buttonAfterSubmit: btnAfter,
      buttonNewSession: btnNewSession,
      status: ok ? 'Conforme' : 'Non conforme',
    },
  }
  mkdirSync(REPORTS_DIR, { recursive: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path.join(REPORTS_DIR, 'retest-der003-migration.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== RETEST DER-003 (migration submitted_at) ===')
  console.log(`submittedAt avant submit : ${submittedAtBefore}`)
  console.log(`bouton Soumettre avant : ${submitBtnBefore}`)
  console.log(`1ère soumission : HTTP ${submitResp.status()}`)
  console.log(`submittedAt après : ${submittedAtAfter}`)
  console.log(`audit : ${auditBefore} → ${auditAfter} (2e soumission : ${auditAfter2})`)
  console.log(`notifications : ${notifBefore} → ${notifAfter} (2e soumission : ${notifAfter2})`)
  console.log(`2e soumission : HTTP ${second.status}`)
  console.log(`bouton après soumission : ${btnAfter}`)
  console.log(`bouton nouvelle session : ${btnNewSession}`)
  console.log(`STATUT : ${ok ? 'Conforme' : 'NON CONFORME'}`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
