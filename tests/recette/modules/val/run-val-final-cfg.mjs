import { loginPage, navigateViaSidebar, capture, launch, ensurePreuves } from '../../helpers/runner-utils.mjs'
import fs from 'node:fs'
import path from 'node:path'

function info(file) { const p = path.resolve('preuves', file); const s = fs.statSync(p); return `${file} ${s.size}B ${new Date(s.mtime).toISOString()}` }

async function run() {
  ensurePreuves()
  const browser = await launch()

  // ===== VAL-003 : vraie action RH =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.evaluate(() => { window.history.pushState({}, '', '/app/rh-validators?q=Service%20VAL%20UI'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(1000)
    const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL UI' }).first()
    await card.waitFor({ state: 'visible', timeout: 10000 })
    await card.locator('.rh-validator-service-card__summary').click()
    await page.waitForTimeout(400)
    await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
    await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
    const sel = page.locator('.rh-validators-form select')
    const opts = await sel.locator('option').allInnerTexts()
    const dirCandidate = opts.some(o => o.includes('DIR-TEST'))
    console.log('VAL-003 DirectorCandidateVisible=' + dirCandidate, 'opts=', JSON.stringify(opts))
    if (dirCandidate) {
      await sel.selectOption({ label: opts.find(o => o.includes('DIR-TEST')) })
      const p = page.waitForResponse(r => r.request().method()==='POST' && /\/services\/18\/validators$/.test(new URL(r.url()).pathname), { timeout: 8000 })
      await page.locator('.rh-validators-form .rh-validators-btn--primary').click()
      const resp = await p
      await page.waitForTimeout(600)
      console.log('VAL-003 POST', resp.status())
    }
    await capture(page, 'CAP-VAL-003.png')
    await page.close().catch(() => {})
  }

  // ===== VAL-004 : COL-A absence accès =====
  {
    const page = await loginPage(browser, 'col-a.recette@gmes.fr')
    await page.waitForTimeout(500)
    const nav = await page.locator('a[href*="validators"]').count()
    await capture(page, 'CAP-VAL-004.png')
    console.log('VAL-004 navValidators=' + nav)
    await page.close().catch(() => {})
  }

  // ===== VAL-005/006/008 : drawer candidats (ADMIN) =====
  {
    const page = await loginPage(browser, 'admin.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/admin-validators')
    await page.evaluate(() => { window.history.pushState({}, '', '/app/admin-validators?q=Service%20VAL%20UI'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(1000)
    const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL UI' }).first()
    await card.locator('.rh-validator-service-card__summary').click()
    await page.waitForTimeout(400)
    await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
    await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
    const opts = await page.locator('.rh-validators-form select option').allInnerTexts()
    const primaryC = opts.some(o => o.includes('RESP-TEST'))
    const colaC = opts.some(o => o.includes('COL-A'))
    const colbC = opts.some(o => o.includes('COL-B'))
    const rhDup = opts.some(o => o.includes('RH-TEST'))
    await capture(page, 'CAP-VAL-005.png')
    await capture(page, 'CAP-VAL-006.png')
    await capture(page, 'CAP-VAL-008.png')
    console.log('drawer opts=', JSON.stringify(opts), { primaryC, colaC, colbC, rhDup })
    await page.close().catch(() => {})
  }

  // ===== VAL-007 : service hors circuit =====
  {
    const page = await loginPage(browser, 'admin.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/admin-validators')
    await page.evaluate(() => { window.history.pushState({}, '', '/app/admin-validators?q=Service%20VAL%20A2'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForTimeout(1000)
    const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL A2' }).first()
    await card.locator('.rh-validator-service-card__summary').click()
    await page.waitForTimeout(400)
    const add = await card.locator('button', { hasText: 'Ajouter un valideur' }).count()
    const unsup = await card.locator('.rh-validator-service-card__unsupported').count()
    await capture(page, 'CAP-VAL-007.png')
    console.log('VAL-007 addButton=' + add + ' unsupported=' + unsup)
    await page.close().catch(() => {})
  }

  await browser.close()
  for (const f of ['CAP-VAL-003.png','CAP-VAL-004.png','CAP-VAL-005.png','CAP-VAL-006.png','CAP-VAL-007.png','CAP-VAL-008.png']) console.log(info(f))
  console.log('done')
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
