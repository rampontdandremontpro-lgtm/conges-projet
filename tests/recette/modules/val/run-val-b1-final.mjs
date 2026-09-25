import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function run() {
  ensurePreuves()
  const [admin, rh, resp, colA, colB, colC, colProrata, dir] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('responsable.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'), login('col-b.recette@gmes.fr'), login('col-c.recette@gmes.fr'),
    login('col-prorata.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map(u => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const colCId = U['col-c.recette@gmes.fr'].id
  const prorataId = U['col-prorata.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  const TAG = 'D1' + Date.now().toString(36)
  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const paid038 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL038 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const paid041 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL041 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service VAL B1 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [colAId, colBId, colCId, prorataId, respId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } })
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: rh, body: { validatorId: dirId } })

  const today = todayIso()
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }
  async function newReq(empToken, type, off) {
    const s = openDate(off)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: empToken, body: { leaveTypeId: type.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    if (r.status !== 201) throw new Error('create ' + r.status)
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: empToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    if (sub.status !== 200) throw new Error('submit ' + sub.status)
    return r.data.id
  }

  const browser = await launch()
  const out = {}

  async function openReplacementsTab(page) {
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(500)
  }

  // create replacement via UI drawer
  async function createReplacementUI(page, empName, valName, start, end) {
    await page.waitForSelector('.rh-validators-new-replacement', { timeout: 10000 })
    await page.click('.rh-validators-new-replacement')
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const empSel = page.locator('.rh-validators-form select').nth(0)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const empMatch = empOpts.find(o => o.includes(empName))
    if (!empMatch) throw new Error('emp not found: ' + empName)
    await empSel.selectOption({ label: empMatch })
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const valOpts = await valSel.locator('option').allInnerTexts()
    const valMatch = valOpts.find(o => o.includes(valName))
    if (!valMatch) throw new Error('val not found: ' + valName)
    await valSel.selectOption({ label: valMatch })
    await page.locator('.rh-validators-form input[type=date]').nth(0).fill(start)
    await page.locator('.rh-validators-form input[type=date]').nth(1).fill(end)
    await page.waitForTimeout(300)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/validator-replacements', { timeout: 15000 })
    await page.locator('.rh-validators-form .rh-validators-btn--primary').click()
    const r = await p
    return r
  }

  const page = await loginPage(browser, 'rh.recette@gmes.fr')
  await navigateViaSidebar(page, '/app/rh-validators')
  await openReplacementsTab(page)

  // ===== VAL-033 : création prorata UI =====
  {
    const r = await createReplacementUI(page, 'COL-PRORATA', 'RH-TEST', today, isoAddDays(today, 5))
    const data = await r.json()
    out['VAL-033'] = { http: r.status(), replacementId: data.id, employeeId: data.employeeId, isActive: data.isActive }
    console.log('VAL-033', JSON.stringify(out['VAL-033']))
  }

  // ===== VAL-034 : chevauchement UI (même prorata, période chevauchante) =====
  {
    const list = (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data
    const existing = list[0]
    const countBefore = list.length
    const r = await createReplacementUI(page, 'COL-PRORATA', 'DIR-TEST', isoAddDays(today, 2), isoAddDays(today, 7))
    const countAfter = (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data.length
    let msg = ''
    try { msg = (await r.json()).message ?? '' } catch {}
    const feedbackCount = await page.locator('.rh-validators-form__error').count()
    out['VAL-034'] = { existingReplacementId: existing.id, http: r.status(), message: msg, countBefore, countAfter, feedbackCount }
    console.log('VAL-034', JSON.stringify(out['VAL-034']))
    await page.locator('.rh-validators-drawer .rh-validators-btn--secondary').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  // ===== VAL-035 : désactivation UI du remplacement prorata =====
  {
    const list = (await apiRequest(`/validator-replacements?employeeId=${prorataId}`, { token: rh })).data
    const target = list.find(x => x.isActive) ?? list[0]
    const isActiveBefore = target.isActive
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const row = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-PRORATA' }).first()
    await row.click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/validator-replacements\/\d+\/disable$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const r = await p
    await page.waitForTimeout(500)
    const isActiveAfter = (await apiRequest(`/validator-replacements/${target.id}`, { token: rh })).data.isActive
    out['VAL-035'] = { replacementId: target.id, http: r.status(), isActiveBefore, isActiveAfter }
    console.log('VAL-035', JSON.stringify(out['VAL-035']))
    await page.locator('.rh-validators-drawer .rh-validators-btn--secondary').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  // ===== VAL-036 : création colA UI =====
  {
    const r = await createReplacementUI(page, 'COL-A', 'RH-TEST', today, isoAddDays(today, 10))
    const data = await r.json()
    out['VAL-036'] = { http: r.status(), replacementId: data.id, employeeId: data.employeeId, isActive: data.isActive }
    console.log('VAL-036', JSON.stringify(out['VAL-036']))
  }

  // ===== VAL-037 : création colB UI =====
  {
    const r = await createReplacementUI(page, 'COL-B', 'DIR-TEST', today, isoAddDays(today, 10))
    const data = await r.json()
    out['VAL-037'] = { http: r.status(), replacementId: data.id, employeeId: data.employeeId, distinct: data.id !== out['VAL-036'].replacementId }
    console.log('VAL-037', JSON.stringify(out['VAL-037']))
  }

  // ===== VAL-040 : bornes inclusives start=end=today (colC libre) =====
  {
    const r = await createReplacementUI(page, 'COL-C', 'RH-TEST', today, today)
    const data = await r.json()
    // onglet "En cours" : la ligne doit apparaître
    const tab = page.locator('.rh-validator-replacement-filters button', { hasText: 'En cours' }).first()
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(600) }
    const visible = await page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-C' }).count()
    out['VAL-040'] = { http: r.status(), replacementId: data.id, startDate: data.startDate, endDate: data.endDate, visibleInCurrentTab: visible >= 1 }
    console.log('VAL-040', JSON.stringify(out['VAL-040']))
  }
  await page.close().catch(() => {})

  // ===== VAL-038 : Responsable remplacé bloqué sur demande colB =====
  {
    const rid = await newReq(colB, paid038, 120)
    const repl = (await apiRequest(`/validator-replacements?employeeId=${colBId}&isActive=true`, { token: rh })).data[0]
    const p = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(p, '/app/requests')
    await p.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 }).catch(() => {})
    await p.waitForTimeout(600)
    const rows = p.locator('.manager-all-requests-row--data', { hasText: paid038.name })
    const rowCount = await rows.count()
    let validateButtonCount = -1
    if (rowCount >= 1) {
      await rows.first().click()
      await p.waitForURL('**/requests/**', { timeout: 10000 }).catch(() => {})
      await p.waitForTimeout(600)
      validateButtonCount = await p.locator('.manager-request-action--validate').count()
    }
    // corroboration API
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    const statusAfter = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    out['VAL-038'] = { requestId: rid, replacementId: repl?.id, rowCount, validateButtonCount, apiHTTP: v.status, statusAfter }
    console.log('VAL-038', JSON.stringify(out['VAL-038']))
    await p.close().catch(() => {})
  }

  // ===== VAL-041 : Responsable reste autorisé sur prorata (remplacement prorata désactivé) =====
  {
    const rid = await newReq(colProrata, paid041, 125)
    const replCount = (await apiRequest(`/validator-replacements?employeeId=${prorataId}&isActive=true`, { token: rh })).data.length
    const p = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(p, '/app/requests')
    await p.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    await p.waitForTimeout(600)
    const rows = p.locator('.manager-all-requests-row--data', { hasText: paid041.name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error('VAL-041 rowCount=' + rowCount)
    await rows.first().click()
    await p.waitForURL('**/requests/**', { timeout: 10000 })
    await p.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const vp = p.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await p.click('.manager-request-action--validate')
    await p.waitForSelector('#signature-initials', { timeout: 10000 })
    await p.fill('#signature-initials', 'DR')
    await p.locator('.nr-modal__footer .nr-btn--primary').click()
    const vr = await vp
    await p.waitForTimeout(500)
    const statusAfter = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    out['VAL-041'] = { otherEmployee: 'COL-PRORATA', replacementCount: replCount, requestId: rid, http: vr.status(), statusAfter }
    console.log('VAL-041', JSON.stringify(out['VAL-041']))
    await p.close().catch(() => {})
  }

  await browser.close()
  console.log('RESULT', JSON.stringify(out, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
