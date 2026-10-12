// Playwright — téléchargements réels + dimensions (12/10/2026).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-corrections-ui-final-20261012.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const PASSWORD = 'RecetteGMES@2026!'

const results = []
function push(id, action, expected, observed, pass) {
  results.push({ id, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', date: new Date().toISOString() })
}

async function loginPage(browser, email, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true })
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

async function downloadReal(page, format, label) {
  const btn = page.locator(`button:has-text("${label}"):not([disabled])`).first()
  if (await btn.count() === 0) return { ok: false, reason: 'bouton désactivé/absent', name: null, size: 0 }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    btn.click(),
  ])
  if (!download) return { ok: false, reason: 'aucun download', name: null, size: 0 }
  const name = download.suggestedFilename()
  const stream = await download.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  const size = Buffer.concat(chunks).length
  return { ok: size > 0 && name, reason: '', name, size }
}

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  // ===== Téléchargements Directeur + RH =====
  for (const role of ['directeur.recette@gmes.fr', 'rh.recette@gmes.fr']) {
    const label = role.includes('directeur') ? 'Directeur' : 'RH'
    const target = role.includes('directeur') ? '/app/director-exports' : '/app/rh-exports'
    const { context, page } = await loginPage(browser, role)
    await spaNavigate(page, target)
    await page.waitForTimeout(800)
    const csv = await downloadReal(page, 'csv', 'CSV')
    const xlsx = await downloadReal(page, 'xlsx', 'Excel')
    push(`DL-${label}-CSV`, `Téléchargement CSV réel (${label})`, 'fichier non vide téléchargé', `ok=${csv.ok} fichier=${csv.name ?? csv.reason} taille=${csv.size}`, csv.ok)
    push(`DL-${label}-XLSX`, `Téléchargement XLSX réel (${label})`, 'fichier non vide téléchargé', `ok=${xlsx.ok} fichier=${xlsx.name ?? xlsx.reason} taille=${xlsx.size}`, xlsx.ok)
    await context.close()
  }

  // ===== Dimensions / scroll page indisponibilité =====
  const VIEWPORTS = [
    { name: '1920x1080', width: 1920, height: 1080, noScroll: true },
    { name: '1666x900', width: 1666, height: 900, noScroll: true },
    { name: '1600x900', width: 1600, height: 900, noScroll: true },
    { name: '1366x768', width: 1366, height: 768, noScroll: true },
    { name: 'tablette-768x1024', width: 768, height: 1024, noScroll: false },
    { name: 'mobile-390x844', width: 390, height: 844, noScroll: false },
  ]
  for (const vp of VIEWPORTS) {
    const { context, page } = await loginPage(browser, 'directeur.recette@gmes.fr', { width: vp.width, height: vp.height })
    await spaNavigate(page, '/app/director-availability')
    await page.waitForTimeout(1000)
    const m = await page.evaluate(() => {
      const doc = document.documentElement
      const layout = document.querySelector('.director-availability-layout')
      return {
        innerH: window.innerHeight,
        clientH: doc.clientHeight,
        scrollH: doc.scrollHeight,
        hasScroll: doc.scrollHeight > doc.clientHeight,
        hOverflow: doc.scrollWidth > doc.clientWidth,
        layoutTop: layout ? Math.round(layout.getBoundingClientRect().top) : null,
        layoutH: layout ? Math.round(layout.getBoundingClientRect().height) : null,
      }
    })
    await page.screenshot({ path: path.join(PREUVES_DIR, `CAP-FINAL-${vp.name}.png`), fullPage: true })
    const ok = vp.noScroll ? (!m.hasScroll && !m.hOverflow) : true
    push(`UI-${vp.name}`, `Rendu ${vp.name}`, vp.noScroll ? 'aucun scroll (V+H)' : 'scroll autorisé si nécessaire', `innerH=${m.innerH} scrollH=${m.scrollH} clientH=${m.clientH} vScroll=${m.hasScroll} hOverflow=${m.hOverflow} layoutTop=${m.layoutTop}`, ok)
    await context.close()
  }

  await browser.close()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Téléchargements + dimensions UI (12/10/2026)', date: new Date().toISOString(), frontendUrl: FRONTEND_URL, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== TÉLÉCHARGEMENTS + DIMENSIONS ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
