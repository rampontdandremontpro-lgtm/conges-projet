// Test navigateur des comportements overlay + verrouillage du défilement.
// Environnement isolé : frontend 5174 -> API 3001 -> gestion_conges_gmes_test.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { navigateViaSidebar } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES = path.resolve(__dirname, '../preuves')
const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:5174'

const results = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const r1 = (n) => Math.round(n * 10) / 10

async function state(page) {
  return page.evaluate(() => {
    const rect = (el) => (el ? { top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height } : null)
    const backdrop = document.querySelector('.rh-pc-backdrop')
    const modal = document.querySelector('.rh-pc-modal')
    const bodyEl = document.querySelector('.rh-pc-body')
    const card = document.querySelector('.rh-balances-card')
    const confirm = document.querySelector('.rh-pc-confirm')
    return {
      scrollY: window.scrollY,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      backdrop: rect(backdrop),
      backdropFilter: backdrop ? getComputedStyle(backdrop).backdropFilter : null,
      modal: rect(modal),
      body: bodyEl ? { scrollTop: bodyEl.scrollTop, scrollHeight: bodyEl.scrollHeight, clientHeight: bodyEl.clientHeight } : null,
      cardTop: card ? card.getBoundingClientRect().top : null,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyPaddingRight: document.body.style.paddingRight,
      confirmVisible: Boolean(confirm),
      confirmZ: confirm ? getComputedStyle(confirm).zIndex : null,
    }
  })
}

async function openModal(page) {
  await page.getByRole('button', { name: 'Clôture de période' }).dispatchEvent('click')
  await page.waitForSelector('.rh-pc-modal', { timeout: 15000 })
  await page.waitForSelector('.rh-pc-status', { timeout: 15000 })
  await page.waitForTimeout(350)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })

try {
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await navigateViaSidebar(page, '/app/rh-balances')
  await page.waitForSelector('.rh-balances-card', { timeout: 15000 })

  // 1. Faire défiler la page vers le bas avant d'ouvrir.
  await page.mouse.move(800, 500)
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(400)
  const before = await state(page)
  rec('Prérequis : page défilée (scrollY > 0)', before.scrollY > 0, `scrollY=${r1(before.scrollY)}`)
  const cardTopBefore = before.cardTop

  // 2. Ouvrir la fenêtre.
  await openModal(page)
  const open = await state(page)
  rec('Overlay : fond couvre le viewport entier', open.backdrop && open.backdrop.left === 0 && open.backdrop.top === 0 && Math.abs(open.backdrop.width - open.viewport.w) <= 1 && Math.abs(open.backdrop.height - open.viewport.h) <= 1, `backdrop=${r1(open.backdrop?.width)}×${r1(open.backdrop?.height)}`)
  rec('Overlay : backdrop-filter flou appliqué', Boolean(open.backdropFilter) && open.backdropFilter !== 'none', `${open.backdropFilter}`)
  rec('Verrouillage : body en position fixed', open.bodyPosition === 'fixed', open.bodyPosition)
  rec('Gel : position visuelle de la page conservée', Math.abs(open.cardTop - cardTopBefore) <= 1, `avant=${r1(cardTopBefore)} après=${r1(open.cardTop)}`)
  rec('Pas de décalage horizontal (barre compensée)', open.horizontalOverflow <= 0, `overflow=${r1(open.horizontalOverflow)}px`)
  await page.screenshot({ path: path.join(PREUVES, 'overlay-full-1366.png') })

  // 3. Molette sur le fond (hors fenêtre) : la page ne bouge pas.
  await page.mouse.move(12, 12)
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(200)
  const afterWheel = await state(page)
  rec('Molette sur fond : page arrière figée', Math.abs(afterWheel.cardTop - cardTopBefore) <= 1, `avant=${r1(cardTopBefore)} après=${r1(afterWheel.cardTop)}`)

  // 4. Touches clavier de défilement (focus hors fenêtre).
  await page.evaluate(() => document.activeElement?.blur?.())
  for (const key of ['PageDown', 'ArrowDown', 'End', 'Home', ' ']) {
    await page.keyboard.press(key)
  }
  await page.waitForTimeout(200)
  const afterKeys = await state(page)
  rec('Touches (PageDown/flèches/End/Home/espace) : page figée', Math.abs(afterKeys.cardTop - cardTopBefore) <= 1, `avant=${r1(cardTopBefore)} après=${r1(afterKeys.cardTop)}`)

  // 5. Défilement interne de la fenêtre.
  const scrollable = await page.evaluate(() => {
    const b = document.querySelector('.rh-pc-body')
    return b ? b.scrollHeight > b.clientHeight : false
  })
  rec('Contenu interne dépassant (défilement possible)', scrollable === true)
  const bodyBox = await page.locator('.rh-pc-body').boundingBox()
  if (bodyBox && scrollable) {
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(300)
    const internal = await state(page)
    rec('Défilement interne : le corps de la fenêtre défile', internal.body.scrollTop > 0, `scrollTop=${r1(internal.body.scrollTop)}`)
    rec('Défilement interne : page arrière toujours figée', Math.abs(internal.cardTop - cardTopBefore) <= 1, `avant=${r1(cardTopBefore)} après=${r1(internal.cardTop)}`)

    await page.evaluate(() => { const b = document.querySelector('.rh-pc-body'); b.scrollTop = b.scrollHeight })
    await page.waitForTimeout(200)
    const atBottom = await state(page)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(200)
    const afterOverscroll = await state(page)
    rec('Fin de défilement interne : aucun report vers la page', Math.abs(afterOverscroll.cardTop - cardTopBefore) <= 1 && afterOverscroll.body.scrollTop >= atBottom.body.scrollTop - 1, `cardTop=${r1(afterOverscroll.cardTop)}`)
  }

  // 6. Changer d'onglet et de période : le verrouillage reste actif.
  await page.locator('.rh-pc-tab', { hasText: 'Reports exceptionnels' }).click()
  await page.waitForTimeout(200)
  await page.locator('.rh-pc-header__controls select').selectOption('2026-2027')
  await page.waitForFunction(() => document.body.innerText.includes('Période en cours'), null, { timeout: 15000 })
  const afterTabSwitch = await state(page)
  rec('Verrouillage maintenu après changement onglet + période', afterTabSwitch.bodyPosition === 'fixed' && Math.abs(afterTabSwitch.cardTop - cardTopBefore) <= 1, `position=${afterTabSwitch.bodyPosition}`)

  // 7. Confirmation finale (sans clôture) au-dessus de la fenêtre.
  await page.locator('.rh-pc-header__controls select').selectOption('2025-2026')
  await page.waitForFunction(() => document.body.innerText.includes('Prête à clôturer'), null, { timeout: 15000 })
  await page.locator('.rh-pc-footer .rh-pc-btn--primary').click()
  await page.waitForSelector('.rh-pc-confirm__panel', { timeout: 10000 })
  const confirm = await state(page)
  rec('Confirmation visible au-dessus (z-index supérieur)', confirm.confirmVisible && Number(confirm.confirmZ) > 141, `z=${confirm.confirmZ}`)
  rec('Confirmation : page arrière toujours verrouillée', confirm.bodyPosition === 'fixed')
  await page.screenshot({ path: path.join(PREUVES, 'overlay-confirm-1366.png') })

  await page.keyboard.press('Escape')
  await page.waitForSelector('.rh-pc-confirm__panel', { state: 'detached', timeout: 10000 })
  const afterEsc = await state(page)
  rec('Échap : retour à la fenêtre principale, verrou maintenu', afterEsc.confirmVisible === false && afterEsc.bodyPosition === 'fixed')

  // 8. Fermer puis rouvrir : aucun verrouillage résiduel, position restaurée.
  await page.locator('.rh-pc-header__actions .rh-pc-btn--ghost').click()
  await page.waitForSelector('.rh-pc-modal', { state: 'detached', timeout: 10000 })
  await page.waitForTimeout(300)
  const afterClose = await state(page)
  rec('Fermeture : défilement restauré (position conservée)', Math.abs(afterClose.scrollY - before.scrollY) <= 2 && afterClose.bodyPosition !== 'fixed', `scrollY=${r1(afterClose.scrollY)} avant=${r1(before.scrollY)} position=${afterClose.bodyPosition || 'static'}`)

  await openModal(page)
  const reopen = await state(page)
  rec('Réouverture : verrouillage actif sans résidu', reopen.bodyPosition === 'fixed')
  await page.locator('.rh-pc-header__actions .rh-pc-btn--ghost').click()
  await page.waitForSelector('.rh-pc-modal', { state: 'detached', timeout: 10000 })

  // 9. Zoom 125 %.
  await openModal(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 })
  await page.waitForTimeout(400)
  const zoomed = await state(page)
  rec('Zoom 125% : fond couvre le viewport', zoomed.backdrop && Math.abs(zoomed.backdrop.width - zoomed.viewport.w) <= 2 && Math.abs(zoomed.backdrop.height - zoomed.viewport.h) <= 2, `backdrop=${r1(zoomed.backdrop?.width)}×${r1(zoomed.backdrop?.height)} viewport=${zoomed.viewport.w}×${zoomed.viewport.h}`)
  rec('Zoom 125% : pas de défilement horizontal', zoomed.horizontalOverflow <= 2, `overflow=${r1(zoomed.horizontalOverflow)}px`)
  await page.screenshot({ path: path.join(PREUVES, 'overlay-zoom125.png') })
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {})
  await page.locator('.rh-pc-header__actions .rh-pc-btn--ghost').click().catch(() => {})
  await page.waitForSelector('.rh-pc-modal', { state: 'detached', timeout: 10000 }).catch(() => {})

  // 10. 1920×1080 : fond + verrouillage.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(300)
  await openModal(page)
  const w1920 = await state(page)
  rec('1920×1080 : fond couvre le viewport', w1920.backdrop && Math.abs(w1920.backdrop.width - w1920.viewport.w) <= 1 && Math.abs(w1920.backdrop.height - w1920.viewport.h) <= 1, `backdrop=${r1(w1920.backdrop?.width)}×${r1(w1920.backdrop?.height)}`)
  rec('1920×1080 : page arrière verrouillée', w1920.bodyPosition === 'fixed')
  await page.screenshot({ path: path.join(PREUVES, 'overlay-full-1920.png') })
  await page.locator('.rh-pc-header__actions .rh-pc-btn--ghost').click()
  await page.waitForSelector('.rh-pc-modal', { state: 'detached', timeout: 10000 })

  // 11. Mobile.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await openModal(page)
  const mobile = await state(page)
  rec('Mobile : fond couvre le viewport', mobile.backdrop && Math.abs(mobile.backdrop.width - mobile.viewport.w) <= 1 && Math.abs(mobile.backdrop.height - mobile.viewport.h) <= 1, `backdrop=${r1(mobile.backdrop?.width)}×${r1(mobile.backdrop?.height)}`)
  rec('Mobile : page arrière verrouillée', mobile.bodyPosition === 'fixed')
  await page.screenshot({ path: path.join(PREUVES, 'overlay-mobile.png') })
} catch (error) {
  console.error('ERREUR NAVIGATEUR :', error.message)
  rec('Déroulement du test', false, error.message)
  await page.screenshot({ path: path.join(PREUVES, 'overlay-error.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT OVERLAY/SCROLL : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
