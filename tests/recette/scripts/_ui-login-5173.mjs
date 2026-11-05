import { chromium } from 'playwright'

const FRONT = 'http://localhost:5173'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ headless: true })
const errors = []
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.on('pageerror', (e) => errors.push(String(e)))

// 1. Chargement /login
await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
rec('C1-LOGIN-PAGE', 'Page /login sur 5173', page.url().includes('/login'))

// 2. Connexion RH
await page.fill('#login-email', 'rh.recette@gmes.fr')
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
rec('C2-LOGIN-REDIRECT', 'Redirection vers espace connecté', page.url().includes('/app/'), page.url())

// 3. Espace RH visible
await page.waitForTimeout(1500)
const body = await page.locator('body').innerText().catch(() => '')
rec('C3-RH-SPACE', 'Espace connecté RH visible (nom/Profil RH)', /RH|Responsable|Tableau de bord|Demandes/i.test(body), body.slice(0, 80).replace(/\n/g, ' | '))

// 4. Déconnexion
await page.locator('button[aria-label="Menu utilisateur"]').first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Déconnexion' }).first().click()
await page.waitForURL('**/login', { timeout: 10000 })
rec('C4-LOGOUT', 'Déconnexion → /login', page.url().includes('/login'), page.url())

// 5. Reconnexion
await page.fill('#login-email', 'rh.recette@gmes.fr')
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })
rec('C5-RELOGIN', 'Reconnexion réussie', page.url().includes('/app/'), page.url())

rec('C6-NO-PAGEERROR', 'Aucune erreur de page', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\nLOGIN 5173 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed ? 1 : 0
