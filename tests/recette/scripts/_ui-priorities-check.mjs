// Vérifications navigateur : libellés de profil (P7), masquage des compteurs
// collaborateur (P2) et séparation des notifications (P1, via le switch de
// profil COLLABORATOR).
import { chromium } from 'playwright'

const FRONT = process.env.FRONTEND_URL ?? 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function login(page, email, password = 'RecetteGMES@2026!') {
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const errors = []

  // ── P7 : libellé « Profil RH » pour le compte RH ────────────────────────
  const rh = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh.on('pageerror', (e) => errors.push(String(e)))
  await login(rh, 'rh.recette@gmes.fr')
  await rh.click('.user-menu__button')
  await rh.waitForTimeout(400)
  const rhMenuText = await rh.locator('.dropdown__panel--user').innerText().catch(() => '')
  rec('P7-RH-LABEL', 'Le menu RH affiche « Profil RH » (plus « Profil administrateur »)', /Profil RH/.test(rhMenuText) && !/Profil administrateur/.test(rhMenuText), rhMenuText.replace(/\n/g, ' | ').slice(0, 120))
  await rh.close()

  // ── P7 : libellé « Profil responsable » pour le compte Responsable ──────
  const resp = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  resp.on('pageerror', (e) => errors.push(String(e)))
  await login(resp, 'responsable.recette@gmes.fr')
  await resp.click('.user-menu__button')
  await resp.waitForTimeout(400)
  const respMenuText = await resp.locator('.dropdown__panel--user').innerText().catch(() => '')
  rec('P7-RESP-LABEL', 'Le menu Responsable affiche « Profil responsable »', /Profil responsable/.test(respMenuText), respMenuText.replace(/\n/g, ' | ').slice(0, 120))
  await resp.close()

  // ── P2 : masquage côté Collaborateur ─────────────────────────────────────
  const collab = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  collab.on('pageerror', (e) => errors.push(String(e)))
  await login(collab, 'col-a.recette@gmes.fr')
  await collab.waitForSelector('.balance-period-kpi', { timeout: 10000 }).catch(() => {})
  const prisText = await collab.locator('.balance-period-kpi--taken strong').first().textContent().catch(() => '')
  const pendingText = await collab.locator('.balance-period-kpi--pending strong').first().textContent().catch(() => '')
  const validatedText = await collab.locator('.balance-period-kpi--validated strong').first().textContent().catch(() => '')
  rec('P2-COLLAB-MASK', 'Collaborateur : Pris / En attente / Validées affichent « - j »', prisText === '- j' && pendingText === '- j' && validatedText === '- j', `pris=${prisText} attente=${pendingText} validees=${validatedText}`)
  const acquiredText = await collab.locator('.balance-period-kpi--acquired strong').first().textContent().catch(() => '')
  rec('P2-COLLAB-SOLDE', 'Collaborateur : « Acquis » conserve sa valeur réelle', acquiredText !== '- j', `acquis=${acquiredText}`)
  await collab.close()

  // ── P2 : RH (profil management) n'utilise pas le masquage ──────────────
  const rh2 = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh2.on('pageerror', (e) => errors.push(String(e)))
  await login(rh2, 'rh.recette@gmes.fr')
  await rh2.waitForTimeout(1200)
  const rhHasMaskedCard = await rh2.locator('.balance-period-kpi--taken').count() > 0
  rec('P2-RH-VALEURS', 'RH management : vue RH (pas la carte collaborateur masquée)', !rhHasMaskedCard, `maskedCard=${rhHasMaskedCard}`)
  await rh2.close()

  // ── P1 : le profil COLLABORATOR d'un RH masque aussi (même règle) ───────
  const rh3 = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  rh3.on('pageerror', (e) => errors.push(String(e)))
  await login(rh3, 'rh.recette@gmes.fr')
  await rh3.click('.user-menu__button')
  await rh3.waitForTimeout(300)
  await rh3.locator('.dropdown__panel--user button', { hasText: 'Profil collaborateur' }).click()
  await rh3.waitForURL('**/app/dashboard', { timeout: 15000 })
  await rh3.waitForSelector('.balance-period-kpi', { timeout: 10000 }).catch(() => {})
  const switchPris = await rh3.locator('.balance-period-kpi--taken strong').first().textContent().catch(() => '')
  rec('P1-PROFIL-SWITCH-MASK', 'Profil COLLABORATOR du RH : compteurs masqués « - j »', switchPris === '- j', `pris=${switchPris}`)
  await rh3.close()

  rec('PRIORITIES-NO-PAGEERROR', 'Aucune erreur de page navigateur', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nVÉRIFS PRIORITÉS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR VÉRIFS PRIORITÉS :', e); process.exit(1) })
