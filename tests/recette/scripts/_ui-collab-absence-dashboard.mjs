import { chromium } from 'playwright'
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'DASH' + Date.now().toString(36)
  const [[colA]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  // 5 demandes pour col-a (base de test uniquement)
  for (let i = 1; i <= 5; i++) {
    await conn.query(
      "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, created_at) VALUES (?, ?, ?, ?, 1, 1, 'EN_ATTENTE_VALIDATION', NOW() + INTERVAL ? SECOND)",
      [colA.id, type.id, `2026-12-0${i}`, `2026-12-0${i}`, i],
    )
  }

  const browser = await chromium.launch({ headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'col-a.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })

  const sidebarText = await page.locator('.sidebar').innerText().catch(() => '')
  rec('COL-NO-ABSENCE-SIDEBAR', 'Collaborateur : « Déclarer une absence » absent du sidebar', !/Déclarer une absence/.test(sidebarText))

  await page.locator('.balance-period-kpi').first().waitFor({ timeout: 15000 })
  const balanceText = await page.locator('.dash-card--leave-balance').innerText().catch(() => '')
  rec('COL-NO-ACQUIS-DISPO', 'Tableau de bord : Acquis et Disponible absents', !/Acquis/.test(balanceText) && !/Disponible/.test(balanceText))
  rec('COL-MASK-3', 'Tableau de bord : Pris / En attente / Validées = « - j »', /Pris/.test(balanceText) && /En attente/.test(balanceText) && /Validées/.test(balanceText) && /- j/.test(balanceText), balanceText.replace(/\n/g,' | ').slice(0,120))

  const recentRows = await page.locator('.recent-row').count()
  rec('COL-RECENT-MAX-4', 'Tableau de bord : 4 demandes récentes max (5 créées)', recentRows === 4, `rows=${recentRows}`)

  rec('COL-NO-PAGEERROR', 'Aucune erreur de page', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  await conn.end()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nCOLLAB ABSENCE+DASHBOARD : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR :', e); process.exit(1) })
