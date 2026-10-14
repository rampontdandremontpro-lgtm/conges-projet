// Retest visuel du bloc « Congé anticipé » (design compact bleu).
// Vérifie les styles calculés réels + capture d'écran.
// Base : gestion_conges_gmes_test. Frontend test : 5174 -> backend 3001.

import { apiRequest, login, loginPage, ensurePreuves, launch, navigateViaSidebar, capture } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'ANTIC' + Date.now().toString(36)
const out = {}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const deductType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP SOLDE ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'ANTIC', prenom: 'Col', email: `antic.col.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const token = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })

  const n1 = '2027-06-15'
  await apiRequest('/leave-requests', { method: 'POST', token, body: { leaveTypeId: deductType.id, startDate: n1, endDate: n1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })

  const browser = await launch()
  const page = await loginPage(browser, col.email, 'RecetteGMES@2026!')
  await navigateViaSidebar(page, '/app/my-requests')
  await page.waitForSelector('.my-request-card', { timeout: 15000 })
  await page.locator('.my-request-card', { hasText: deductType.name }).first().click()
  await page.waitForURL('**/new-request/**', { timeout: 15000 })
  await page.waitForSelector('.nr-anticipated-panel', { timeout: 15000 })

  const styles = await page.evaluate(() => {
    const panel = document.querySelector('.nr-anticipated-panel')
    const head = document.querySelector('.nr-anticipated-panel__head')
    const strong = document.querySelector('.nr-anticipated-panel__head strong')
    const badge = document.querySelector('.nr-anticipated-panel__badge')
    const text = document.querySelector('.nr-anticipated-panel__text')
    const icon = document.querySelector('.nr-anticipated-panel__icon svg')
    const cs = (el) => el ? getComputedStyle(el) : null
    return {
      panelBg: cs(panel)?.backgroundColor,
      panelBorder: cs(panel)?.borderColor,
      panelRadius: cs(panel)?.borderRadius,
      panelPadding: cs(panel)?.padding,
      headDisplay: cs(head)?.display,
      strongColor: cs(strong)?.color,
      strongFontSize: cs(strong)?.fontSize,
      badgeText: badge?.textContent,
      textColor: cs(text)?.color,
      textFontSize: cs(text)?.fontSize,
      textLineHeight: cs(text)?.lineHeight,
      iconSize: icon ? { w: icon.getAttribute('width') || icon.getBoundingClientRect().width, h: icon.getAttribute('height') || icon.getBoundingClientRect().height } : null,
      overflowX: panel ? panel.scrollWidth - panel.clientWidth : null,
      oldBadgePresent: Boolean(document.querySelector('.nr-anticipated-badge')),
    }
  })

  out['styles'] = styles
  await capture(page, 'CAP-ANTIC-1-N1.png')

  // Responsive mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const mobile = await page.evaluate(() => {
    const panel = document.querySelector('.nr-anticipated-panel')
    return {
      overflowX: panel ? panel.scrollWidth - panel.clientWidth : null,
      width: panel ? panel.getBoundingClientRect().width : null,
    }
  })
  out['mobile'] = mobile
  await capture(page, 'CAP-ANTIC-2-N1-mobile.png')

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
