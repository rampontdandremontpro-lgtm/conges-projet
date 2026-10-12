// Ajustement UI Directeur — indisponibilité (12/10/2026).
// Vérifie : pas de scroll grand écran, centrage vertical, cartes agrandies, responsive.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const PREUVES_DIR = path.resolve(__dirname, '../preuves')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-ajustement-ui-directeur-20261012.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const PASSWORD = 'RecetteGMES@2026!'

const results = []
function push(id, action, expected, observed, pass) {
  results.push({ id, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', date: new Date().toISOString() })
}

const VIEWPORTS = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080, noScrollExpected: true },
  { name: 'desktop-1600x900', width: 1600, height: 900, noScrollExpected: true },
  { name: 'laptop-1366x768', width: 1366, height: 768, noScrollExpected: true },
  { name: 'tablette-768x1024', width: 768, height: 1024, noScrollExpected: false },
  { name: 'mobile-390x844', width: 390, height: 844, noScrollExpected: false },
]

async function main() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await context.newPage()
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
    await page.fill('#login-email', 'directeur.recette@gmes.fr')
    await page.fill('#login-password', PASSWORD)
    await page.click('.login-submit')
    await page.waitForURL('**/app/**', { timeout: 15000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => { window.history.pushState({}, '', '/app/director-availability'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(1200)

    const m = await page.evaluate(() => {
      const layout = document.querySelector('.director-availability-layout')
      const left = document.querySelector('.director-availability-left')
      const r = (el) => el ? { top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height) } : null
      const cs = layout ? getComputedStyle(layout) : null
      return {
        innerH: window.innerHeight,
        scrollH: document.documentElement.scrollHeight,
        hasScroll: document.documentElement.scrollHeight > window.innerHeight,
        layout: r(layout),
        left: r(left),
        alignContent: cs?.alignContent ?? null,
        minHeight: cs?.minHeight ?? null,
        hasSave: Boolean(document.querySelector('.director-availability-save')),
        hasCalendar: Boolean(document.querySelector('.director-availability-calendar')),
      }
    })
    await page.screenshot({ path: path.join(PREUVES_DIR, `CAP-AJUST-DIR-${vp.name}.png`), fullPage: true })

    const scrollOk = vp.noScrollExpected ? !m.hasScroll : true
    const centered = m.alignContent === 'center' && m.minHeight !== '0px' && m.minHeight !== null
    const largerCards = (m.left?.h ?? 0) >= 560
    const functionalOk = m.hasSave && m.hasCalendar
    const pass = vp.noScrollExpected
      ? scrollOk && centered && largerCards
      : scrollOk && functionalOk
    push(`AJUST-${vp.name}`, `Rendu ${vp.name}`, `scroll=${vp.noScrollExpected ? 'aucun' : 'autorisé'}, centré${vp.noScrollExpected ? ', cartes >= 560px' : ''}, fonctionnel`,
      `scroll=${m.hasScroll} scrollH=${m.scrollH}/innerH=${m.innerH} left=${m.left?.h} align=${m.alignContent} save=${m.hasSave} cal=${m.hasCalendar}`, pass)

    console.log(vp.name, '=>', JSON.stringify(m))
    await context.close()
  }

  await browser.close()

  const summary = {
    total: results.length,
    conformes: results.filter((r) => r.pass === 'Conforme').length,
    nonConformes: results.filter((r) => r.pass === 'Non conforme').length,
    allConformes: results.every((r) => r.pass === 'Conforme'),
  }
  const report = {
    title: 'Ajustement UI Directeur — Indisponibilité (12/10/2026)',
    date: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    summary,
    results,
    notes: [
      'Grand écran : aucun scroll vertical (scrollHeight == innerHeight), centrage vertical (align-content center).',
      'Cartes agrandies : padding 22px, mode indisponibilité 86px, textarea 88px, cellules calendrier 60px.',
      'Tablette/mobile : scroll autorisé (contenu empilé), aucune hauteur rigide imposée.',
    ],
  }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== AJUSTEMENT UI DIRECTEUR INDISPONIBILITÉ ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
