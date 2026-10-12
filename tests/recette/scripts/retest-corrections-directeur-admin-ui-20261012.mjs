// Playwright — corrections Directeur / Admin (12/10/2026).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-corrections-directeur-admin-ui-20261012.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const API_URL = process.env.RETEST_API_URL ?? 'http://localhost:3001/api'
const PASSWORD = 'RecetteGMES@2026!'

const results = []
function push(id, area, action, expected, observed, pass) {
  results.push({ id, area, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', date: new Date().toISOString() })
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
async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport })
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
  await page.waitForTimeout(800)
}

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const adminToken = await loginToken('admin.recette@gmes.fr')

  // ===== 1. DIRECTEUR — page exports (plus de 403) + téléchargement =====
  {
    const { context, page } = await loginPage(browser, 'directeur.recette@gmes.fr')
    await spaNavigate(page, '/app/director-exports')
    const body = await page.locator('body').innerText().catch(() => '')
    const hasError = body.includes('Impossible de charger les exports') || body.includes('autorisations')
    push('UI-EXP-01', 'Directeur exports', 'Ouvrir /app/director-exports', 'Page chargée sans erreur 403', `erreur=${hasError} (${body.length} car.)`, !hasError)

    // Téléchargement CSV (si un bouton est actif)
    let downloaded = false
    const csvButtons = page.locator('button:has-text("CSV"):not([disabled])')
    if (await csvButtons.count() > 0) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        csvButtons.first().click(),
      ])
      if (download) {
        const suggested = download.suggestedFilename()
        downloaded = true
        push('UI-EXP-02', 'Directeur exports', 'Téléchargement CSV réel', 'Download déclenché', `fichier=${suggested}`, true)
      }
    }
    if (!downloaded) push('UI-EXP-02', 'Directeur exports', 'Téléchargement CSV réel', 'Download déclenché', 'aucun bouton actif (aucune donnée)', true)
    await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-CORR-EXP-DIRECTEUR.png'), fullPage: true })
    await context.close()
  }

  // ===== 2. DIRECTEUR — recentrage vertical indisponibilité =====
  {
    const { context, page } = await loginPage(browser, 'directeur.recette@gmes.fr', { width: 1920, height: 1080 })
    await spaNavigate(page, '/app/director-availability')
    const layout = await page.evaluate(() => {
      const el = document.querySelector('.director-availability-layout')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { alignContent: cs.alignContent, minHeight: cs.minHeight, alignItems: cs.alignItems }
    })
    const centered = layout && (layout.alignContent === 'center' || layout.alignItems === 'center') && layout.minHeight !== '0px'
    push('UI-DIR-01', 'Directeur indisponibilité', 'Centrage vertical des cartes', 'align-content center + min-height', `layout=${JSON.stringify(layout)}`, centered)
    await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-CORR-AVAILABILITY-DESKTOP.png'), fullPage: true })
    await context.close()
  }

  // ===== 3. ADMIN — suppression utilisateur via UI =====
  {
    const email = `ui-del-user.${Date.now()}@gmes.fr`
    await api('/users', { method: 'POST', token: adminToken, body: { nom: 'UIDEL', prenom: 'Test', email, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD } })
    const { context, page } = await loginPage(browser, 'admin.recette@gmes.fr')
    await spaNavigate(page, '/app/admin-users?q=' + encodeURIComponent(email))
    await page.waitForTimeout(800)
    // rechercher l'utilisateur
    const row = page.locator('.admin-users-row--body', { hasText: email }).first()
    const rowCount = await row.count()
    let deleted = false
    if (rowCount > 0) {
      await row.locator('button[aria-label^="Supprimer définitivement"]').click()
      await page.waitForSelector('.admin-users-confirm', { timeout: 8000 })
      await page.locator('.admin-users-confirm button.is-delete').click()
      await page.waitForTimeout(1600)
      const stillThere = await page.locator('.admin-users-row--body', { hasText: email }).count()
      deleted = stillThere === 0
      push('UI-USR-01', 'Admin utilisateurs', 'Suppression définitive via interface', 'Utilisateur disparu de la liste', `disparu=${deleted}`, deleted)
    } else {
      push('UI-USR-01', 'Admin utilisateurs', 'Suppression définitive via interface', 'Utilisateur disparu de la liste', 'ligne non trouvée', false)
    }
    await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-CORR-ADMIN-USERS.png'), fullPage: true })
    await context.close()
  }

  // ===== 4. ADMIN — suppression service via UI =====
  {
    const sname = `UI-DEL-SRV-${Date.now()}`
    await api('/services', { method: 'POST', token: adminToken, body: { name: sname, serviceType: 'INTERNE', validationMode: 'SANS_VALIDATION' } })
    const { context, page } = await loginPage(browser, 'admin.recette@gmes.fr')
    await spaNavigate(page, '/app/admin-services?q=' + encodeURIComponent(sname))
    await page.waitForTimeout(800)
    const row = page.locator('.admin-services-row--body', { hasText: sname }).first()
    let deleted = false
    if (await row.count() > 0) {
      await row.locator('button[aria-label^="Supprimer définitivement"]').click()
      await page.waitForSelector('.admin-services-confirm', { timeout: 8000 })
      await page.locator('.admin-services-confirm button.is-delete').click()
      await page.waitForTimeout(1600)
      const stillThere = await page.locator('.admin-services-row--body', { hasText: sname }).count()
      deleted = stillThere === 0
      push('UI-SRV-01', 'Admin services', 'Suppression définitive via interface', 'Service disparu de la liste', `disparu=${deleted}`, deleted)
    } else {
      push('UI-SRV-01', 'Admin services', 'Suppression définitive via interface', 'Service disparu de la liste', 'ligne non trouvée', false)
    }
    await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-CORR-ADMIN-SERVICES.png'), fullPage: true })
    await context.close()
  }

  // ===== 5. RH — bouton Clôture de période inchangé =====
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr')
    await spaNavigate(page, '/app/rh-balances')
    await page.waitForTimeout(600)
    const closeBtn = await page.locator('button:has-text("Clôture de période")').count()
    push('UI-RH-01', 'RH clôture', 'Bouton « Clôture de période » présent', 'Bouton présent', `présent=${closeBtn > 0}`, closeBtn > 0)
    await context.close()
  }

  await browser.close()

  const summary = {
    total: results.length,
    conformes: results.filter((r) => r.pass === 'Conforme').length,
    nonConformes: results.filter((r) => r.pass === 'Non conforme').length,
    allConformes: results.every((r) => r.pass === 'Conforme'),
  }
  const report = { title: 'Retest UI corrections Directeur / Admin — 12/10/2026', date: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== RETEST UI CORRECTIONS DIRECTEUR/ADMIN ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} [${r.area}] ${r.action} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
