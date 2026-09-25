import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

function assertStep(id, step, r, exp = [200, 201, 204]) {
  if (!exp.includes(r.status)) throw new Error(`${id} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`)
  return r
}
async function presence(id, tok) { return (await apiRequest(`/users/${id}`, { token: tok })).data?.presenceStatus }

async function run() {
  ensurePreuves()
  const [admin, rh, resp, colA, dir] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('responsable.recette@gmes.fr'), login('col-a.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map(u => [u.email, u]))
  const colAId = U['col-a.recette@gmes.fr'].id
  const respId = U['responsable.recette@gmes.fr'].id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  const TAG = 'M' + Date.now().toString(36)
  const paid16 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL016 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const paid19 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL019 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const absType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'ABS VAL01718 ' + TAG, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service VAL A2 MICRO ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  assertStep('VAL', 'backup rh', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } }), [201])
  assertStep('VAL', 'backup dir', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: rh, body: { validatorId: dirId } }), [201])
  console.log('fixture ok', { svc: svc.id, respId, rhId, dirId })

  const today = todayIso()
  // dates proches, ouvrées, sans férié (base reset = pas de fériés) et sans chevauchement (base reset = aucune demande)
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 20; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  async function newReq(type) {
    const s = openDate(65 + Math.floor(Math.random() * 10))
    const e = s
    const r = assertStep('VAL', 'create', await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: type.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }), [201])
    assertStep('VAL', 'submit', await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } }), [200])
    return r.data.id
  }

  const browser = await launch()
  const out = {}

  // ===== VAL-017 / VAL-018 : UI RH création + soumission absence Responsable =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-create', { timeout: 10000 })
    await page.click('.rh-events-create')
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    // collaborateur = Responsable
    const empSel = page.locator('.rh-declaration-form select').first()
    await empSel.selectOption({ label: 'RESP-TEST Recette — Service VAL A2 MICRO ' + TAG }).catch(async () => {
      const opts = await empSel.locator('option').allInnerTexts()
      console.log('EMP-OPTS', JSON.stringify(opts))
      throw new Error('employee option not found')
    })
    // type = ABS VAL01718
    const typeSel = page.locator('.rh-declaration-form select').nth(1)
    await typeSel.selectOption({ label: 'ABS VAL01718 ' + TAG })
    await page.waitForTimeout(400)
    // date : AUJOURD'HUI pour rendre le Responsable ABSENT
    const absDate = today
    const dayBtn = page.locator(`button[aria-label="${absDate}"]`).first()
    await dayBtn.click()
    await page.waitForTimeout(300)
    // intercepter create + submit + register
    const pCreate = page.waitForResponse((r) => r.request().method() === 'POST' && /\/absence-declarations$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    const pSubmit = page.waitForResponse((r) => r.request().method() === 'POST' && /\/absence-declarations\/\d+\/submit$/.test(new URL(r.url()).pathname), { timeout: 15000 }).catch(() => null)
    const pRegister = page.waitForResponse((r) => r.request().method() === 'POST' && /\/absence-declarations\/\d+\/register$/.test(new URL(r.url()).pathname), { timeout: 15000 }).catch(() => null)
    await page.locator('.rh-declaration-actions button[type=submit]').click()
    const rCreate = await pCreate
    const rSubmit = await pSubmit
    const rRegister = await pRegister
    const absenceId = rCreate.status() === 201 ? (await rCreate.json()).id : null
    await page.waitForTimeout(600)
    await capture(page, 'CAP-VAL-018.png')
    out['VAL-017'] = { absenceId, createHTTP: rCreate.status() }
    out['VAL-018'] = { absenceId, submitHTTP: rSubmit ? rSubmit.status() : null, registerHTTP: rRegister ? rRegister.status() : null, presenceAfter: await presence(respId, rh) }
    console.log('VAL-017/018', JSON.stringify(out))
    await page.close().catch(() => {})
  }

  // maintenance présence pour ABSENT
  await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
  console.log('presence resp après absence', await presence(respId, rh))

  // ===== helper validation RH secours (forced INITIALS) =====
  async function rhValidate(type, requestId) {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    const typeSel = page.locator('.rh-events-filters select').nth(2)
    await typeSel.selectOption({ label: type.name }).catch((e) => { throw new Error('type filter failed: ' + e.message) })
    await page.waitForTimeout(700)
    const rows = page.locator('.rh-events-row--data', { hasText: type.name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error(`rowCount=${rowCount} attendu 1`)
    await rows.first().click()
    await page.waitForURL(`**/rh-all-requests/${requestId}`, { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const cbLabel = page.locator('.manager-request-actions-card__agreement')
    if (await cbLabel.count()) await cbLabel.click()
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${requestId}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click()
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'RH')
    await page.waitForTimeout(200)
    const confirm = page.locator('.nr-modal__footer .nr-btn--primary')
    if (await confirm.isDisabled()) throw new Error('confirm disabled')
    await confirm.click()
    const r = await p
    await page.waitForTimeout(600)
    return { page, http: r.status(), rowCount }
  }

  // ===== VAL-016 =====
  {
    const rid = await newReq(paid16)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    if (da.decisionAccess?.kind !== 'SECOURS') throw new Error(`VAL-016 decisionAccess=${JSON.stringify(da.decisionAccess)}`)
    const { page, http, rowCount } = await rhValidate(paid16, rid)
    await capture(page, 'CAP-VAL-016.png')
    out['VAL-016'] = { requestId: rid, presence: await presence(respId, rh), kind: da.decisionAccess.kind, rowCount, http }
    console.log('VAL-016', JSON.stringify(out['VAL-016']))
    await page.close().catch(() => {})
  }

  // ===== VAL-019 =====
  {
    const rid = await newReq(paid19)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    if (da.decisionAccess?.kind !== 'SECOURS') throw new Error(`VAL-019 decisionAccess=${JSON.stringify(da.decisionAccess)}`)
    const { page, http, rowCount } = await rhValidate(paid19, rid)
    await capture(page, 'CAP-VAL-019.png')
    out['VAL-019'] = { requestId: rid, presence: await presence(respId, rh), kind: da.decisionAccess.kind, rowCount, http }
    console.log('VAL-019', JSON.stringify(out['VAL-019']))
    await page.close().catch(() => {})
  }

  await browser.close()
  console.log('RESULT', JSON.stringify(out, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
