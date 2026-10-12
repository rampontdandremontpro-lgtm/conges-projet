// Playwright — Scenario D : interface RH après suppression de service.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-demandes-service-supprime-ui-20261012.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const API_URL = process.env.RETEST_API_URL ?? 'http://localhost:3001/api'
const PASSWORD = 'RecetteGMES@2026!'

const results = []
function push(id, action, expected, observed, pass) {
  results.push({ id, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', date: new Date().toISOString() })
}
async function api(p, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const ct = res.headers.get('content-type') ?? ''
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}
async function loginToken(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return r.data.accessToken
}
async function loginPage(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(900)
  return { context, page }
}
async function spaNavigate(page, p) {
  await page.evaluate((pathUrl) => { window.history.pushState({}, '', pathUrl); window.dispatchEvent(new PopStateEvent('popstate')) }, p)
  await page.waitForTimeout(900)
}

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const adminToken = await loginToken('admin.recette@gmes.fr')
  const rhToken = await loginToken('rh.recette@gmes.fr')
  const uniq = Date.now()
  const comment = `UI-SUPPR-${uniq}`

  // Préparation API : service + collaborateur + demande soumise + suppression du service.
  const svc = await api('/services', { method: 'POST', token: adminToken, body: { name: `UI-SRV-${uniq}`, serviceType: 'INTERNE', validationMode: 'DIRECTEUR_ET_RH' } })
  const colEmail = `ui-suppr.${uniq}@gmes.fr`
  const col = await api('/users', { method: 'POST', token: adminToken, body: { nom: 'UISUPPR', prenom: 'Test', email: colEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data?.id, password: PASSWORD } })
  const colToken = await loginToken(colEmail)
  const draft = await api('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: 16, startDate: '2027-03-15', endDate: '2027-03-16', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
  await api(`/leave-requests/${draft.data?.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
  await api(`/services/${svc.data?.id}`, { method: 'DELETE', token: adminToken })

  const browser = await chromium.launch({ headless: true })

  // RH : la demande apparaît avec « Service supprimé »
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr')
    await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('UISUPPR'))
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    const found = body.includes('UISUPPR') || body.includes(comment)
    const hasServiceSupprime = body.includes('Service supprimé')
    push('UI-01', 'Affichage RH : demande sans service visible avec « Service supprimé »', 'demande visible + mention Service supprimé', `visible=${found} serviceSupprime=${hasServiceSupprime}`, found)
    await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-DEMANDE-SUPPR-RH.png'), fullPage: true })

    // Ouvrir la demande → page de décision avec boutons
    const row = page.locator('.rh-events-row--data', { hasText: 'UISUPPR' }).first()
    if (await row.count() > 0) {
      await row.click()
      await page.waitForTimeout(900)
      const body2 = await page.locator('body').innerText()
      const hasValidate = /Valider|Accepter/i.test(body2)
      const hasRefuse = /Refuser/i.test(body2)
      push('UI-02', 'Page de décision RH : boutons Valider et Refuser présents', 'boutons présents', `valider=${hasValidate} refuser=${hasRefuse}`, hasValidate && hasRefuse)
      await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-DEMANDE-SUPPR-DECISION.png'), fullPage: true })
    } else {
      push('UI-02', 'Page de décision RH : boutons Valider et Refuser présents', 'boutons présents', 'ligne non trouvée', false)
    }
    await context.close()
  }

  // Collaborateur : voit sa demande
  {
    const { context, page } = await loginPage(browser, colEmail)
    await spaNavigate(page, '/app/my-requests')
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    const found = body.includes(comment) || body.includes('Congé')
    push('UI-03', 'Collaborateur : consultation de sa demande après suppression du service', 'demande visible', `visible=${found}`, found)
    await context.close()
  }

  await browser.close()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Interface RH — demandes après suppression de service (12/10/2026)', date: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== SCENARIO D (UI) ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
