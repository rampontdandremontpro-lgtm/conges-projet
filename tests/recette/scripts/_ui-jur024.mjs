// Vérification navigateur de la section JUR-024 (convention par entité).
import { chromium } from 'playwright'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5173'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('400') && !m.text().includes('404')) consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  await page.locator('.sidebar__nav-item', { hasText: 'Droits supplémentaires' }).click()
  await page.waitForSelector('.rh-extra-days-header h2', { timeout: 10000 })

  const titles = await page.locator('.rh-extra-days-header h2').allTextContents()
  rec('J24-UI-LOAD', 'Section JUR-024 visible', titles.some((t) => t.includes('Convention collective')), titles.join(' | '))

  const card = page.locator('.rh-extra-days-card').filter({ hasText: 'Convention collective par entité' })
  const row = card.locator('.rh-extra-days-jur24-row').filter({ has: page.locator('.rh-extra-days-jur24-name', { hasText: /^GMES$/ }) })
  await row.locator('select').selectOption('SYNTEC')
  await row.locator('input[type="text"]').fill('1486')
  await row.getByRole('button', { name: 'Enregistrer' }).click()
  await page.waitForTimeout(900)
  rec('J24-UI-SAVE', 'Convention Syntec enregistrée pour GMES', await page.getByText(/Convention de GMES enregistrée \(SYNTEC\)/).isVisible())

  rec('J24-UI-NOERR', 'Aucune erreur console/page', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await page.screenshot({ path: 'tests/recette/preuves/rh-jur024.png', fullPage: true })
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nUI JUR-024 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await browser.close()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR UI JUR-024 :', e); process.exit(1) })
