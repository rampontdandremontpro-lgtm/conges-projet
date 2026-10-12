// Preuves Playwright : pop-up d'information temporaire Collaborateur (phase de test production).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-popup-collab-20261012.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const API_URL = process.env.RETEST_API_URL ?? 'http://localhost:3001/api'
const PASSWORD = 'RecetteGMES@2026!'
const COLLAB = 'col-a.recette@gmes.fr'

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
async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(1000)
  return { context, page }
}
async function fillLogin(page, email) {
  await page.waitForSelector('#login-email', { timeout: 15000 })
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(1000)
}
async function popupCount(page) {
  return page.locator('.ppinfo-modal').count()
}

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  // ===== T10 (pré-test) : soldes inchangés — capture AVANT =====
  const colTokenBefore = await loginToken(COLLAB)
  const balancesBefore = (await api('/leave-balances/my/summary', { token: colTokenBefore })).data

  // ===== T1 : Connexion Collaborateur → fenêtre affichée (desktop) =====
  const collabCtx = await loginPage(browser, COLLAB)
  const collabPage = collabCtx.page
  const t1Visible = (await popupCount(collabPage)) === 1
  const t1Title = t1Visible ? await collabPage.locator('#ppinfo-title').innerText().catch(() => '') : ''
  const t1Button = t1Visible ? await collabPage.locator('.ppinfo-button').innerText().catch(() => '') : ''
  push('T1', 'Connexion Collaborateur', 'fenêtre affichée (titre + bouton)', `visible=${t1Visible} titre="${t1Title}" bouton="${t1Button}"`, t1Visible && t1Title.includes('Information importante') && t1Button.includes("J'ai compris"))
  if (t1Visible) await collabPage.screenshot({ path: path.join(PREUVES_DIR, 'CAP-POPUP-DESKTOP.png'), fullPage: false })

  // ===== T2 : « J'ai compris » → fermée =====
  if (t1Visible) await collabPage.click('.ppinfo-button')
  await collabPage.waitForTimeout(400)
  const t2Closed = (await popupCount(collabPage)) === 0
  push('T2', "Clic « J'ai compris »", 'fenêtre fermée', `fermée=${t2Closed}`, t2Closed)

  // ===== T3 : Navigation entre pages → pas de réapparition =====
  await collabPage.click('a[href="/app/my-requests"]')
  await collabPage.waitForTimeout(900)
  const t3a = (await popupCount(collabPage)) === 0
  await collabPage.click('a[href="/app/dashboard"]')
  await collabPage.waitForTimeout(900)
  const t3b = (await popupCount(collabPage)) === 0
  push('T3', 'Navigation entre pages', 'pas de réapparition', `mes-demandes=${t3a} dashboard=${t3b}`, t3a && t3b)

  // ===== T4 : Rafraîchissement → pas de réapparition durant la même session =====
  await collabPage.reload({ waitUntil: 'networkidle' })
  // Le jeton est en mémoire : le rafraîchissement ramène à l'écran de connexion.
  await fillLogin(collabPage, COLLAB)
  const t4 = (await popupCount(collabPage)) === 0
  push('T4', 'Rafraîchissement + reconnexion (même session navigateur)', 'pas de réapparition', `réapparition=${!t4}`, t4)

  // ===== T5 : Déconnexion → nouvelle connexion → réaffichée =====
  await collabPage.click('.user-menu__button')
  await collabPage.waitForTimeout(300)
  await collabPage.click('button:has-text("Déconnexion")')
  await collabPage.waitForURL('**/login', { timeout: 10000 })
  await fillLogin(collabPage, COLLAB)
  const t5 = (await popupCount(collabPage)) === 1
  push('T5', 'Déconnexion puis nouvelle connexion', 'fenêtre réaffichée', `réaffichée=${t5}`, t5)
  await collabCtx.context.close()

  // ===== T6/T7/T8 : RH, Directeur, Administrateur → aucune fenêtre =====
  for (const [id, email] of [['T6', 'rh.recette@gmes.fr'], ['T7', 'directeur.recette@gmes.fr'], ['T8', 'admin.recette@gmes.fr']]) {
    const { context, page } = await loginPage(browser, email)
    const none = (await popupCount(page)) === 0
    push(id, `Connexion ${id === 'T6' ? 'RH' : id === 'T7' ? 'Directeur' : 'Administrateur'}`, 'aucune fenêtre', `présente=${!none}`, none)
    await context.close()
  }

  // ===== T9 : Affichage mobile =====
  {
    const { context, page } = await loginPage(browser, COLLAB, { width: 390, height: 844 })
    const visible = (await popupCount(page)) === 1
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (visible) await page.screenshot({ path: path.join(PREUVES_DIR, 'CAP-POPUP-MOBILE.png'), fullPage: false })
    push('T9', 'Affichage mobile (390×844)', 'fenêtre affichée, pas de débordement horizontal', `visible=${visible} overflow=${overflow}`, visible && !overflow)
    await context.close()
  }

  await browser.close()

  // ===== T10 : soldes inchangés — capture APRÈS =====
  const colTokenAfter = await loginToken(COLLAB)
  const balancesAfter = (await api('/leave-balances/my/summary', { token: colTokenAfter })).data
  const t10 = JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter)
  push('T10', 'Soldes et calculs inchangés', 'résumé des soldes identique avant/après', `identique=${t10}`, t10)

  const summary = { total: results.length, conformes: results.filter((r) => r.pass === 'Conforme').length, nonConformes: results.filter((r) => r.pass === 'Non conforme').length, allConformes: results.every((r) => r.pass === 'Conforme') }
  const report = { title: 'Pop-up information temporaire Collaborateur (12/10/2026)', date: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== POP-UP INFORMATION COLLABORATEUR ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
