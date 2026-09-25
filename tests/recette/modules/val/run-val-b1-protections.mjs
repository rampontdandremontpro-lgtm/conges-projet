import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function run() {
  ensurePreuves()
  const [rh, resp] = await Promise.all([login('rh.recette@gmes.fr'), login('responsable.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map(u => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr']?.id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const respId = U['responsable.recette@gmes.fr']?.id

  const c = await dbConn()
  const [extRows] = await c.execute("SELECT id FROM users WHERE email='ext.recette@gmes.fr'")
  const extExists = extRows.length > 0
  await c.end()

  const browser = await launch()
  const out = {}

  // ===== VAL-024 : Responsable ne peut pas créer de remplacement =====
  {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await page.waitForTimeout(800)
    const navValidatorsVisible = await page.locator('a[href="/app/rh-validators"]').count()
    // tentative d'accès SPA à la page RH valideurs
    await page.evaluate(() => { window.history.pushState({}, '', '/app/rh-validators'); window.dispatchEvent(new PopStateEvent('popstate')) }).catch(() => {})
    await page.waitForTimeout(1200)
    const url = page.url()
    const newReplacementButtonCount = await page.locator('.rh-validators-new-replacement').count()
    const replacementPageAccessible = url.includes('rh-validators')
    out['VAL-024'] = { navValidatorsVisible, replacementPageAccessible, newReplacementButtonCount, finalUrl: url }
    console.log('VAL-024', JSON.stringify(out['VAL-024']))
    await page.close().catch(() => {})
  }

  // ===== Drawer RH : employee + validator options =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(500)
    await page.waitForSelector('.rh-validators-new-replacement', { timeout: 10000 })
    await page.click('.rh-validators-new-replacement')
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(500)

    const empSel = page.locator('.rh-validators-form select').nth(0)
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const valOpts = await valSel.locator('option').allInnerTexts()

    const externalEmployeeVisible = empOpts.some(o => /EXT-/.test(o))
    const rhEmployeeVisible = empOpts.some(o => /RH-/.test(o))
    const responsableEmployeeVisible = empOpts.some(o => /RESP-/.test(o))
    const directorEmployeeVisible = empOpts.some(o => /DIR-/.test(o))

    console.log('DRAWER', JSON.stringify({ empOpts, valOpts }))

    // ASSERTIONS BLOQUANTES
    if (externalEmployeeVisible) throw new Error('VAL-025 FAIL: employé externe visible')
    if (rhEmployeeVisible) throw new Error('VAL-026 FAIL: RH visible')
    if (responsableEmployeeVisible) throw new Error('VAL-027 FAIL: Responsable visible')
    if (directorEmployeeVisible) throw new Error('VAL-028 FAIL: Directeur visible')

    out['VAL-025'] = { externalEmployeeVisible, extExists }
    out['VAL-026'] = { rhEmployeeVisible }
    out['VAL-027'] = { responsableEmployeeVisible }
    out['VAL-028'] = { directorEmployeeVisible }

    // ===== VAL-032 : protection date fin (min=startDate) =====
    const startDate = todayIso()
    const startInput = page.locator('.rh-validators-form input[type=date]').nth(0)
    const endInput = page.locator('.rh-validators-form input[type=date]').nth(1)
    await startInput.fill(startDate)
    await page.waitForTimeout(300)
    const endInputMin = await endInput.getAttribute('min')
    // tenter une date antérieure
    const attemptedEndDate = isoAddDays(startDate, -3)
    await endInput.fill(attemptedEndDate).catch(() => {})
    await page.waitForTimeout(300)
    const validityValid = await endInput.evaluate((el) => el.validity.valid)
    const submitBtn = page.locator('.rh-validators-form .rh-validators-btn--primary')
    const submitEnabled = await submitBtn.isDisabled().then(d => !d).catch(() => false)
    const feedback = await page.locator('.rh-validators-form__error').count()
    out['VAL-032'] = { startDate, attemptedEndDate, endInputMin, validityValid, submitEnabled, feedback }
    console.log('VAL-032', JSON.stringify(out['VAL-032']))
    await page.close().catch(() => {})
  }

  await browser.close()
  console.log('RESULT', JSON.stringify(out, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
