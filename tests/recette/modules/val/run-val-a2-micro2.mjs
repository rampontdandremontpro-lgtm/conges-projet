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

  // absence #6 existante (VAL-017/018)
  const absAll = (await apiRequest('/absence-declarations/management', { token: rh })).data
  const absence6 = absAll.find(a => a.id === 6)
  if (!absence6 || absence6.status === 'ANNULEE') throw new Error('absence #6 absente ou déjà annulée')
  if (await presence(respId, rh) !== 'ABSENT') throw new Error('Responsable doit être ABSENT')
  console.log('state ok', { absence6: absence6.status, presence: await presence(respId, rh) })

  const TAG = 'F' + Date.now().toString(36)
  const paid20 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL020 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const paid21 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL021 ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  const today = todayIso()
  let offCounter = 75
  function openDate() { offCounter += 1; let s = isoAddDays(today, offCounter); for (let i = 0; i < 30; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1); offCounter += 1 } return s }
  async function newReq(type) {
    const s = openDate()
    const r = assertStep('VAL', 'create', await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: type.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }), [201])
    assertStep('VAL', 'submit', await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } }), [200])
    return r.data.id
  }

  const browser = await launch()
  const out = {}

  // helper validation RH secours (forced INITIALS)
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

  // helper second secours (Directeur) : protection UI
  async function directorBlocked(type, requestId) {
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/director-all-requests')
    await page.waitForSelector('.director-all-requests-row--data, .director-all-requests-empty', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(400)
    // ouvrir filtres
    await page.locator('.director-all-requests-filter-button').click()
    await page.waitForSelector('.director-all-requests-filter-panel select', { timeout: 10000 })
    const typeSel = page.locator('.director-all-requests-filter-panel select').nth(1)
    await typeSel.selectOption({ label: type.name }).catch((e) => { throw new Error('director type filter failed: ' + e.message) })
    await page.waitForTimeout(700)
    const rows = page.locator('.director-all-requests-row--data', { hasText: type.name })
    const rowCount = await rows.count()
    let validateCount = -1
    let url = ''
    if (rowCount >= 1) {
      await rows.first().click()
      await page.waitForURL(`**/director-all-requests/${requestId}`, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(600)
      url = page.url()
      validateCount = await page.locator('.manager-request-action--validate').count()
    }
    return { page, rowCount, validateCount, url }
  }

  // ===== VAL-020 =====
  {
    const rid = await newReq(paid20)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    if (da.decisionAccess?.kind !== 'SECOURS') throw new Error(`VAL-020 decisionAccess=${JSON.stringify(da.decisionAccess)}`)
    const { page: p1, http: h1 } = await rhValidate(paid20, rid)
    await p1.close().catch(() => {})
    const statusBefore = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    const { page: p2, rowCount, validateCount, url } = await directorBlocked(paid20, rid)
    await capture(p2, 'CAP-VAL-020.png')
    const api2 = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DD' } })
    const statusAfter = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    out['VAL-020'] = { requestId: rid, presence: 'ABSENT', secours1: 'RH', h1, secours2: 'Directeur', rowCount, validateCount, url, api2: api2.status, statusBefore, statusAfter }
    console.log('VAL-020', JSON.stringify(out['VAL-020']))
    await p2.close().catch(() => {})
  }

  // ===== VAL-021 =====
  {
    const rid = await newReq(paid21)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    if (da.decisionAccess?.kind !== 'SECOURS') throw new Error(`VAL-021 decisionAccess=${JSON.stringify(da.decisionAccess)}`)
    const { page: p1, http: h1 } = await rhValidate(paid21, rid)
    await p1.close().catch(() => {})
    const { page: p2, rowCount, validateCount, url } = await directorBlocked(paid21, rid)
    await capture(p2, 'CAP-VAL-021.png')
    const api2 = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DD' } })
    const statusAfter = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    out['VAL-021'] = { requestId: rid, h1, rowCount, validateCount, api2: api2.status, statusAfter }
    console.log('VAL-021', JSON.stringify(out['VAL-021']))
    await p2.close().catch(() => {})
  }

  // ===== VAL-022 ===== (preuve API seconde décision refusée, réutilisée depuis corroboration)
  out['VAL-022'] = { source: 'corroboration API VAL-021', http: out['VAL-021'].api2 }

  // ===== VAL-023 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.waitForTimeout(500)
    // filtrer par le type d'absence exact de l'absence #6
    const absTypeName = absence6.leaveType?.name
    const typeSel = page.locator('.rh-events-filters select').nth(2)
    await typeSel.selectOption({ label: absTypeName }).catch((e) => { throw new Error('absence type filter failed: ' + e.message) })
    await page.waitForTimeout(700)
    const rows = page.locator('.rh-events-row--data', { hasText: absTypeName })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error(`absence rowCount=${rowCount} attendu 1`)
    await rows.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForTimeout(400)
    const cancelBtn = page.locator('.rh-absence-button--danger', { hasText: 'Annuler l’absence' })
    await cancelBtn.waitFor({ state: 'visible', timeout: 10000 })
    page.on('dialog', (d) => d.accept())
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/absence-declarations/6/cancel`, { timeout: 15000 })
    await cancelBtn.click()
    const r = await p
    await page.waitForTimeout(600)
    await capture(page, 'CAP-VAL-023.png')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const statusAfter = (await apiRequest(`/absence-declarations/management/6`, { token: rh })).data?.status
    out['VAL-023'] = { absenceId: 6, statusBefore: 'ENREGISTREE', presenceBefore: 'ABSENT', http: r.status(), statusAfter, presenceAfter: await presence(respId, rh) }
    console.log('VAL-023', JSON.stringify(out['VAL-023']))
    await page.close().catch(() => {})
  }

  await browser.close()
  console.log('RESULT', JSON.stringify(out, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
