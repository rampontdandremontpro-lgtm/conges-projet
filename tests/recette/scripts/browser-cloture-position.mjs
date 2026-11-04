// Vérification navigateur du positionnement de la fenêtre « Clôture de période ».
// Le fond est plein écran : la sidebar ne peut plus être basculée fenêtre ouverte,
// donc on bascule la sidebar fenêtre FERMÉE puis on rouvre pour mesurer.
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

async function measure(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const modal = box('.rh-pc-modal')
    const sidebar = box('.sidebar')
    const header = box('.header')
    const refresh = box('.rh-pc-header__actions .rh-pc-btn:not(.rh-pc-btn--ghost)')
    const close = box('.rh-pc-header__actions .rh-pc-btn--ghost')
    const shell = document.querySelector('.app-shell')
    const mainLeft = sidebar ? sidebar.right : 0
    const mainRight = window.innerWidth
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      modal, sidebar, header, refresh, close,
      mainLeft, mainRight,
      mainCenter: (mainLeft + mainRight) / 2,
      modalCenter: modal ? modal.left + modal.width / 2 : 0,
      collapsed: shell ? shell.classList.contains('app-shell--collapsed') : false,
      scrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

async function checkPosition(page, label) {
  const m = await measure(page)
  if (!m.modal || !m.sidebar || !m.header) {
    rec(`${label} : éléments présents`, false)
    return
  }
  const leftGap = m.modal.left - m.sidebar.right
  const rightGap = m.viewport.w - m.modal.right
  const topGap = m.modal.top - m.header.bottom
  const bottomGap = m.viewport.h - m.modal.bottom
  const centerDelta = Math.abs(m.modalCenter - m.mainCenter)

  rec(`${label} : marge gauche ≥ 16 px (sidebar)`, leftGap >= 16, `gauche=${r1(leftGap)}px`)
  rec(`${label} : marge droite ≥ 16 px`, rightGap >= 16, `droite=${r1(rightGap)}px`)
  rec(`${label} : sous le header (marge ≥ 18 px)`, topGap >= 18, `haut=${r1(topGap)}px`)
  rec(`${label} : marge basse ≥ 16 px`, bottomGap >= 16, `bas=${r1(bottomGap)}px`)
  rec(`${label} : centré dans la zone principale (Δ ≤ 8 px)`, centerDelta <= 8, `Δ=${r1(centerDelta)}px`)

  const refreshTopOk = m.refresh && m.refresh.top < m.modal.top + 90
  const closeTopOk = m.close && m.close.top < m.modal.top + 90
  const orderOk = m.refresh && m.close && m.close.left >= m.refresh.right - 4
  const withinRight = m.close && m.close.right <= m.modal.right - 8
  rec(`${label} : Actualiser/Fermer en haut à droite`, refreshTopOk && closeTopOk && orderOk && withinRight,
    `refresh.top=${r1(m.refresh?.top)} close.top=${r1(m.close?.top)}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

async function openModal() {
  await page.getByRole('button', { name: 'Clôture de période' }).click()
  await page.waitForSelector('.rh-pc-modal', { timeout: 15000 })
  await page.waitForSelector('.rh-pc-status', { timeout: 15000 })
  await page.waitForTimeout(400)
}
async function closeModal() {
  await page.locator('.rh-pc-header__actions .rh-pc-btn--ghost').click()
  await page.waitForSelector('.rh-pc-modal', { state: 'detached', timeout: 10000 })
  await page.waitForTimeout(200)
}
async function setCollapsed(collapsed) {
  const current = await page.evaluate(() => document.querySelector('.app-shell')?.classList.contains('app-shell--collapsed'))
  if (current !== collapsed) {
    await page.locator('.sidebar__collapse-toggle').click()
    await page.waitForTimeout(450)
  }
}

try {
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await navigateViaSidebar(page, '/app/rh-balances')
  await page.waitForSelector('.rh-balances-card', { timeout: 15000 })

  // 1920×1080 — sidebar ouverte
  await openModal()
  await checkPosition(page, '1920 ouvert')
  await page.screenshot({ path: path.join(PREUVES, 'pos-1920-open.png') })
  await closeModal()

  // 1920×1080 — sidebar réduite
  await setCollapsed(true)
  await openModal()
  await checkPosition(page, '1920 réduit')
  await page.screenshot({ path: path.join(PREUVES, 'pos-1920-collapsed.png') })
  await closeModal()
  await setCollapsed(false)

  // 1366×768 — sidebar ouverte puis réduite
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(400)
  await openModal()
  await checkPosition(page, '1366 ouvert')
  await page.screenshot({ path: path.join(PREUVES, 'pos-1366-open.png') })
  await closeModal()
  await setCollapsed(true)
  await openModal()
  await checkPosition(page, '1366 réduit')
  await page.screenshot({ path: path.join(PREUVES, 'pos-1366-collapsed.png') })
  await closeModal()
  await setCollapsed(false)

  // Petite largeur (tablette 800×600 -> sidebar auto-réduite)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.waitForTimeout(400)
  await openModal()
  const m800 = await measure(page)
  rec('800×600 : sidebar réduite automatiquement', m800.collapsed === true)
  rec('800×600 : fenêtre dans la zone (droite ≤ largeur)', m800.modal && m800.modal.right <= m800.viewport.w + 1, `right=${r1(m800.modal?.right)}`)
  await page.screenshot({ path: path.join(PREUVES, 'pos-800.png') })
  await closeModal()

  // Zoom 125 % (1920×1080, sidebar ouverte)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(300)
  await openModal()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 })
  await page.waitForTimeout(400)
  const zoomed = await measure(page)
  rec('Zoom 125% : pas de débordement horizontal', zoomed.scrollOverflow <= 2, `scrollOverflow=${r1(zoomed.scrollOverflow)}px`)
  await page.screenshot({ path: path.join(PREUVES, 'pos-zoom125.png') })
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {})
  await closeModal()

  // Mobile 390×844
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await openModal()
  const mob = await measure(page)
  rec('Mobile : fenêtre plein écran (left=0, right=largeur)', mob.modal && mob.modal.left <= 1 && Math.abs(mob.modal.right - mob.viewport.w) <= 1, `left=${r1(mob.modal?.left)} right=${r1(mob.modal?.right)}`)
  rec('Mobile : sous le header', mob.modal && mob.modal.top >= mob.header.bottom + 12, `top=${r1(mob.modal?.top)} header.bottom=${r1(mob.header?.bottom)}`)
  await page.screenshot({ path: path.join(PREUVES, 'pos-mobile.png') })
} catch (error) {
  console.error('ERREUR NAVIGATEUR :', error.message)
  rec('Déroulement du test', false, error.message)
  await page.screenshot({ path: path.join(PREUVES, 'pos-error.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT POSITION : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
