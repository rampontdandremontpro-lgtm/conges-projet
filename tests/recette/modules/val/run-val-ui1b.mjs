import { loginPage, navigateViaSidebar, capture, launch, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function run() {
  ensurePreuves()
  const browser = await launch()
  const page = await loginPage(browser, 'admin.recette@gmes.fr')
  await navigateViaSidebar(page, '/app/admin-validators')
  // filtre par query via SPA (popstate)
  await page.evaluate(() => { window.history.pushState({}, '', '/app/admin-validators?q=Service%20VAL%20UI'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForTimeout(800)

  const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL UI' }).first()
  await card.waitFor({ state: 'visible', timeout: 10000 })
  // déplier
  await card.locator('.rh-validator-service-card__summary').click()
  await page.waitForTimeout(400)
  const expanded = await card.locator('.rh-validator-service-card__expanded').count() > 0
  await capture(page, 'CAP-VAL-001.png')
  console.log('VAL-001 serviceVisible=true expanded=' + expanded)

  async function addValidator(optionText, capFile) {
    await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
    await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
    const sel = page.locator('.rh-validators-form select')
    const opts = await sel.locator('option').allInnerTexts()
    const match = opts.find(o => o.includes(optionText))
    if (!match) { console.log('OPTIONS', JSON.stringify(opts)); return { ok:false } }
    await sel.selectOption({ label: match })
    const p = page.waitForResponse((r) => r.request().method()==='POST' && /\/services\/\d+\/validators$/.test(new URL(r.url()).pathname), { timeout: 8000 })
    await page.locator('.rh-validators-form .rh-validators-btn--primary').click()
    const resp = await p
    await page.waitForTimeout(600)
    await capture(page, capFile)
    return { ok: resp.status()===201, status: resp.status() }
  }

  const a2 = await addValidator('RH-TEST', 'CAP-VAL-002.png')
  console.log('VAL-002', JSON.stringify(a2))
  const a3 = await addValidator('DIR-TEST', 'CAP-VAL-003.png')
  console.log('VAL-003', JSON.stringify(a3))

  // VAL-009 : désactiver RH
  const rowRh = card.locator('.rh-validator-backup-row', { hasText: 'RH-TEST' }).first()
  const dp = page.waitForResponse((r) => r.request().method()==='PATCH' && /\/validators\/\d+\/disable$/.test(new URL(r.url()).pathname), { timeout: 8000 })
  await rowRh.locator('.rh-validator-toggle-action--disable').click()
  const dr = await dp
  await page.waitForTimeout(500)
  await capture(page, 'CAP-VAL-009.png')
  console.log('VAL-009', dr.status())

  // VAL-010 : réactiver RH
  const ep = page.waitForResponse((r) => r.request().method()==='PATCH' && /\/validators\/\d+\/enable$/.test(new URL(r.url()).pathname), { timeout: 8000 })
  await rowRh.locator('.rh-validator-toggle-action--enable').click()
  const er = await ep
  await page.waitForTimeout(500)
  await capture(page, 'CAP-VAL-010.png')
  console.log('VAL-010', er.status())

  // VAL-011 : deux actifs
  const txt = await card.innerText()
  const rhVisible = txt.includes('RH-TEST'), dirVisible = txt.includes('DIR-TEST')
  const rhActive = /RH-TEST[\s\S]{0,80}Actif/.test(txt), dirActive = /DIR-TEST[\s\S]{0,80}Actif/.test(txt)
  console.log('VAL-011', { rhVisible, rhActive, dirVisible, dirActive })
  await capture(page, 'CAP-VAL-011.png')

  await browser.close()
  console.log('done')
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
