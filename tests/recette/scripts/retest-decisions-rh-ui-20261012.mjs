// Preuve Playwright : décisions RH réelles (Valider / Refuser) après suppression de service.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-decisions-rh-ui-20261012.json')

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

async function prepare(adminToken, nom, uniq) {
  const svc = await api('/services', { method: 'POST', token: adminToken, body: { name: `DEC-SRV-${nom}-${uniq}`, serviceType: 'INTERNE', validationMode: 'DIRECTEUR_ET_RH' } })
  const email = `dec-${nom.toLowerCase()}.${uniq}@gmes.fr`
  await api('/users', { method: 'POST', token: adminToken, body: { nom, prenom: 'Test', email, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data?.id, password: PASSWORD } })
  const colToken = await loginToken(email)
  const draft = await api('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: 16, startDate: '2027-04-12', endDate: '2027-04-13', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `DEC-${nom}-${uniq}` } })
  await api(`/leave-requests/${draft.data?.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
  await api(`/services/${svc.data?.id}`, { method: 'DELETE', token: adminToken })
  return { requestId: draft.data?.id, email }
}

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const adminToken = await loginToken('admin.recette@gmes.fr')
  const uniq = Date.now()

  const A = await prepare(adminToken, 'UIVALID', uniq)
  const B = await prepare(adminToken, 'UIREFUS', uniq)

  const browser = await chromium.launch({ headless: true })

  // ===== Demande 1 : VALIDER =====
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr')
    await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('UIVALID'))
    const row = page.locator('.rh-events-row--data', { hasText: 'UIVALID' }).first()
    let validated = false
    if (await row.count() > 0) {
      await row.click()
      await page.waitForTimeout(900)
      await page.locator('button:has-text("Valider la demande")').click()
      await page.waitForSelector('#signature-initials', { timeout: 8000 })
      await page.fill('#signature-initials', 'DR')
      await page.locator('.nr-modal__footer .nr-btn--primary').click()
      await page.waitForTimeout(1800)
      const errVisible = await page.locator('.manager-request-detail-feedback--error').count()
      validated = errVisible === 0
      await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-DEC-VALIDER.png'), fullPage: true })
    }
    // Vérifier le statut dans l'interface RH (réouverture)
    let statusRh = ''
    if (validated) {
      await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('UIVALID'))
      const r2 = page.locator('.rh-events-row--data', { hasText: 'UIVALID' }).first()
      if (await r2.count() > 0) {
        await r2.click()
        await page.waitForTimeout(900)
        statusRh = (await page.locator('body').innerText()).includes('Validée') ? 'Validée' : '—'
      }
    }
    push('DEC-01', 'RH valide réellement (signature) la demande sans service', 'VALIDEE, aucune erreur', `validé=${validated} statutRH=${statusRh}`, validated && statusRh === 'Validée')
    await context.close()
  }

  // ===== Demande 2 : REFUSER =====
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr')
    await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('UIREFUS'))
    const row = page.locator('.rh-events-row--data', { hasText: 'UIREFUS' }).first()
    let refused = false
    if (await row.count() > 0) {
      await row.click()
      await page.waitForTimeout(900)
      await page.locator('button:has-text("Refuser la demande")').click()
      await page.waitForSelector('#manager-refusal-comment', { timeout: 8000 })
      await page.fill('#manager-refusal-comment', 'Motif de test — refus après suppression du service.')
      await page.locator('.manager-decision-btn--danger').click()
      await page.waitForTimeout(1800)
      const errVisible = await page.locator('.manager-request-detail-feedback--error').count()
      refused = errVisible === 0
      await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-DEC-REFUSER.png'), fullPage: true })
    }
    let statusRh = ''
    if (refused) {
      await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('UIREFUS'))
      const r2 = page.locator('.rh-events-row--data', { hasText: 'UIREFUS' }).first()
      if (await r2.count() > 0) {
        await r2.click()
        await page.waitForTimeout(900)
        statusRh = (await page.locator('body').innerText()).includes('Refusée') ? 'Refusée' : '—'
      }
    }
    push('DEC-02', 'RH refuse réellement (motif) la demande sans service', 'REFUSEE, aucune erreur', `refusé=${refused} statutRH=${statusRh}`, refused && statusRh === 'Refusée')
    await context.close()
  }

  // ===== Statut côté collaborateur =====
  {
    const { context, page } = await loginPage(browser, A.email)
    await spaNavigate(page, '/app/my-requests')
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    const seesValidated = /Validée/i.test(body)
    push('DEC-03', 'Collaborateur voit sa demande Validée', 'statut Validée visible', `visible=${seesValidated}`, seesValidated)
    await context.close()
  }
  {
    const { context, page } = await loginPage(browser, B.email)
    await spaNavigate(page, '/app/my-requests')
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    const seesRefused = /Refusée/i.test(body)
    push('DEC-04', 'Collaborateur voit sa demande Refusée', 'statut Refusée visible', `visible=${seesRefused}`, seesRefused)
    await context.close()
  }

  // ===== Étiquette « Service supprimé » : pas à tort pour un service normal =====
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr')
    await spaNavigate(page, '/app/rh-leaves-absences?q=' + encodeURIComponent('COL-A'))
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    // COL-A a un service réel (Service UI A3F) : le libellé « Service supprimé » ne doit pas apparaître pour ses demandes.
    const hasServiceName = body.includes('Service UI A3F')
    const wrongLabel = body.includes('Service supprimé')
    push('DEC-05', 'Étiquette « Service supprimé » absente pour un service normal', 'nom du service affiché, pas « Service supprimé »', `serviceNom=${hasServiceName} serviceSupprime=${wrongLabel}`, hasServiceName && !wrongLabel)
    await context.close()
  }

  await browser.close()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Décisions RH réelles après suppression de service (12/10/2026)', date: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== DÉCISIONS RH RÉELLES ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
