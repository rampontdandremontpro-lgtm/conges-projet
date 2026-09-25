import { apiRequest, login, loginPage, navigateViaSidebar, launch, isoAddDays, todayIso, ensurePreuves } from '../../helpers/runner-utils.mjs'

// MISSION VAL-B1 — CONTRÔLE CIBLÉ UNIQUEMENT VAL-033 / VAL-034 / VAL-035.
// Cette passe est volontairement réduite : reset fait en amont, fixture minimale,
// aucun autre scénario VAL n'est exécuté.

function assert(condition, label) {
  return { ok: Boolean(condition), label }
}

async function run() {
  ensurePreuves()

  // ---- Comptes ----
  const [admin, rh, resp, colProrata] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('col-prorata.recette@gmes.fr'),
  ])

  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const prorataId = U['col-prorata.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id

  // ---- Fixture minimale : Service VAL B1, col-prorata, Responsable principal, RH relais ----
  const TAG = 'B1' + Date.now().toString(36)
  const svc = (await apiRequest('/services', {
    method: 'POST',
    token: admin,
    body: { name: 'Service VAL B1 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })).data

  for (const uid of [prorataId, respId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, {
    method: 'PATCH',
    token: admin,
    body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 },
  })
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })

  const today = todayIso()
  const start033 = today
  const end033 = isoAddDays(today, 5)
  const start034 = isoAddDays(today, 2)
  const end034 = isoAddDays(today, 7)

  const countEmployee = async () =>
    (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data.length

  const out = {}

  const browser = await launch()
  const page = await loginPage(browser, 'rh.recette@gmes.fr')
  await navigateViaSidebar(page, '/app/rh-validators')

  // Onglet "Valideurs temporaires"
  await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
  await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
  await page.waitForTimeout(600)

  // Ouverture drawer de création et sélection
  async function openCreateDrawer(empName, valName, start, end) {
    await page.waitForSelector('.rh-validators-new-replacement', { timeout: 10000 })
    await page.click('.rh-validators-new-replacement')
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const empSel = page.locator('.rh-validators-form select').nth(0)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const empMatch = empOpts.find((o) => o.includes(empName))
    if (!empMatch) throw new Error('Collaborateur introuvable : ' + empName + ' — options=' + JSON.stringify(empOpts))
    await empSel.selectOption({ label: empMatch })
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const valOpts = await valSel.locator('option').allInnerTexts()
    const valMatch = valOpts.find((o) => o.includes(valName))
    if (!valMatch) throw new Error('Valideur introuvable : ' + valName + ' — options=' + JSON.stringify(valOpts))
    await valSel.selectOption({ label: valMatch })
    await page.locator('.rh-validators-form input[type=date]').nth(0).fill(start)
    await page.locator('.rh-validators-form input[type=date]').nth(1).fill(end)
    await page.waitForTimeout(300)
  }

  async function clickCreate() {
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/validator-replacements', { timeout: 15000 })
    await page.locator('.rh-validators-form .rh-validators-btn--primary').click()
    return p
  }

  // ===== VAL-033 : création prorata via UI =====
  {
    const countBefore = await countEmployee()
    await openCreateDrawer('COL-PRORATA', 'RH-TEST', start033, end033)
    const resp = await clickCreate()
    const data = await resp.json()
    const countAfter = await countEmployee()
    const checks = [
      assert(resp.status() === 201, 'HTTP === 201'),
      assert(data.id != null, 'replacementId non null'),
      assert(data.employeeId === prorataId, 'employeeId === col-prorata'),
      assert(data.replacementValidatorId === rhId, 'replacementValidatorId exact'),
      assert(data.isActive === true, 'isActive === true'),
      assert(data.startDate === start033, 'startDate exacte'),
      assert(data.endDate === end033, 'endDate exacte'),
      assert(countBefore === 0, 'countBefore === 0'),
      assert(countAfter === 1, 'countAfter === 1'),
    ]
    out['VAL-033'] = {
      employeeId: data.employeeId,
      replacementValidatorId: data.replacementValidatorId,
      startDate: data.startDate,
      endDate: data.endDate,
      countBefore,
      POST: '/api/validator-replacements',
      HTTP: resp.status(),
      replacementId: data.id,
      isActive: data.isActive,
      countAfter,
      checks: checks.map((c) => `${c.label}=${c.ok}`),
      status: checks.every((c) => c.ok) ? 'Conforme' : 'Non conforme',
    }
    console.log('VAL-033', JSON.stringify(out['VAL-033']))
    await page.waitForTimeout(400)
  }

  // ===== VAL-034 : chevauchement refusé (réutilise replacementId VAL-033) =====
  {
    const list = (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data
    const existing = list[0]
    const countBefore = list.length
    const existingStartDate = existing?.startDate
    const existingEndDate = existing?.endDate
    await openCreateDrawer('COL-PRORATA', 'RH-TEST', start034, end034)
    const resp = await clickCreate()
    let message = ''
    try { message = (await resp.json()).message ?? '' } catch {}
    const countAfter = await countEmployee()
    const existingStillActive = existing?.id
      ? (await apiRequest(`/validator-replacements/${existing.id}`, { token: rh })).data.isActive === true
      : false
    const checks = [
      assert(resp.status() === 400, 'HTTP === 400'),
      assert(/chevauche/.test(message), 'message contient la règle de chevauchement'),
      assert(countBefore === countAfter, 'countBefore === countAfter'),
      assert(existingStillActive === true, 'existingStillActive === true'),
    ]
    out['VAL-034'] = {
      existingReplacementId: existing?.id,
      existingDates: { startDate: existingStartDate, endDate: existingEndDate },
      attemptedDates: { startDate: start034, endDate: end034 },
      countBefore,
      POST: '/api/validator-replacements',
      HTTP: resp.status(),
      message,
      countAfter,
      existingStillActive,
      checks: checks.map((c) => `${c.label}=${c.ok}`),
      status: checks.every((c) => c.ok) ? 'Conforme' : 'Non conforme',
    }
    console.log('VAL-034', JSON.stringify(out['VAL-034']))
    await page.locator('.rh-validators-drawer .rh-validators-btn--secondary').first().click().catch(() => {})
    await page.waitForTimeout(400)
  }

  // ===== VAL-035 : désactivation via UI =====
  {
    const list = (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data
    const target = list.find((x) => x.isActive) ?? list[0]
    const isActiveBefore = target?.isActive === true
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const rows = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-PRORATA' })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/api/validator-replacements/${target.id}/disable$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const resp = await p
    await page.waitForTimeout(500)
    const getResp = await apiRequest(`/validator-replacements/${target.id}`, { token: rh })
    const isActiveAfter = getResp.data?.isActive
    const resourceStillExists = getResp.status === 200 && getResp.data?.id === target.id
    const checks = [
      assert(rowCount === 1, 'rowCount === 1'),
      assert(resp.status() === 200, 'HTTP === 200'),
      assert(isActiveBefore === true, 'isActiveBefore === true'),
      assert(isActiveAfter === false, 'isActiveAfter === false'),
      assert(resourceStillExists === true, 'resourceStillExists === true'),
    ]
    out['VAL-035'] = {
      replacementId: target?.id,
      rowCount,
      isActiveBefore,
      PATCH: `/api/validator-replacements/${target?.id}/disable`,
      HTTP: resp.status(),
      isActiveAfter,
      resourceStillExists,
      checks: checks.map((c) => `${c.label}=${c.ok}`),
      status: checks.every((c) => c.ok) ? 'Conforme' : 'Non conforme',
    }
    console.log('VAL-035', JSON.stringify(out['VAL-035']))
    await page.locator('.rh-validators-drawer .rh-validators-btn--secondary').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  await page.close().catch(() => {})
  await browser.close()

  console.log('RESULT', JSON.stringify(out))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
