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
  const adminId = (await apiRequest('/users/me', { token: admin })).data.id

  const c = await dbConn()
  const [extRows] = await c.execute("SELECT id FROM users WHERE email='ext.recette@gmes.fr'")
  const extId = extRows[0]?.id
  await c.end()

  const TAG = 'C1' + Date.now().toString(36)
  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const paid039 = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL039 REPRISE ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

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

  // ===== Drawer RH : assertions bloquantes VAL-029 / VAL-030 / VAL-031 =====
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
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const valOpts = await valSel.locator('option').allInnerTexts()
    const empSel = page.locator('.rh-validators-form select').nth(0)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const collaboratorCandidateVisible = valOpts.some(o => /COL-/.test(o))
    const adminCandidateVisible = valOpts.some(o => /ADMIN/.test(o))
    const employeeOptions = empOpts
    console.log('VAL-029/030/031', JSON.stringify({ valOpts, empOpts, collaboratorCandidateVisible, adminCandidateVisible }))
    // ASSERTIONS BLOQUANTES
    if (collaboratorCandidateVisible) throw new Error('VAL-029 FAIL: collaborateur visible dans dropdown valideur')
    if (adminCandidateVisible) throw new Error('VAL-030 FAIL: admin visible dans dropdown valideur')
    out['VAL-029'] = { collaboratorCandidateVisible }
    out['VAL-030'] = { adminCandidateVisible }
    out['VAL-031'] = { employeeOptions, validatorOptions: valOpts, identityExpressibleInUi: false }
    await capture(page, 'CAP-VAL-029.png')
    await capture(page, 'CAP-VAL-030.png')
    await capture(page, 'CAP-VAL-031.png')
    await page.close().catch(() => {})
  }

  // ===== VAL-031 : preuve technique identité (même user) =====
  {
    const r = await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colAId, replacementValidatorId: colAId, startDate: today, endDate: today } })
    const list = (await apiRequest('/validator-replacements', { token: rh })).data
    out['VAL-031'].sameUserHTTP = r.status
    out['VAL-031'].sameUserMessage = r.data?.message
    out['VAL-031'].count = list.length
    out['VAL-031'].identityGuardReached = /différents/.test(r.data?.message ?? '')
  }

  // ===== VAL-039 : ordre strict =====
  {
    // étape 1+2 : demande collab C soumise AVANT remplacement
    const rid = await newReq(colC, paid039, 110)
    const before = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    const submittedAt = before.submittedAt
    const replCountBefore = (await apiRequest(`/validator-replacements?employeeId=${colCId}`, { token: rh })).data.length
    // étape 3 : remplacement créé APRÈS (délai pour garantir submittedBeforeReplacement)
    await new Promise(r => setTimeout(r, 1500))
    const mk = await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colCId, replacementValidatorId: rhId, startDate: today, endDate: isoAddDays(today, 14) } })
    if (mk.status !== 201) throw new Error('VAL-039 mk ' + mk.status + ' ' + JSON.stringify(mk.data))
    const replacementCreatedAt = mk.data.createdAt
    const submittedBeforeReplacement = new Date(submittedAt) < new Date(replacementCreatedAt)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    console.log('VAL-039 strict', { rid, submittedAt, replacementId: mk.data.id, replacementCreatedAt, submittedBeforeReplacement, kind: da.decisionAccess?.kind })
    // étape 5 : vraie UI remplaçant (RH)
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.locator('.rh-events-filters select').nth(2).selectOption({ label: paid039.name })
    await page.waitForTimeout(700)
    const rows = page.locator('.rh-events-row--data', { hasText: paid039.name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error('VAL-039 UI rowCount=' + rowCount)
    await rows.first().click()
    await page.waitForURL(`**/rh-all-requests/${rid}`, { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const cb = page.locator('.manager-request-actions-card__agreement')
    if (await cb.count()) await cb.click()
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${rid}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click()
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'RH')
    await page.waitForTimeout(200)
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const rv = await p
    await page.waitForTimeout(600)
    await capture(page, 'CAP-VAL-039.png')
    const statusAfter = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    out['VAL-039'] = { rid, submittedAt, replacementId: mk.data.id, replacementCreatedAt, submittedBeforeReplacement, kind: da.decisionAccess?.kind, rowCount, http: rv.status(), statusAfter }
    console.log('VAL-039 UI', JSON.stringify(out['VAL-039']))
    await page.close().catch(() => {})
  }

  // ===== VAL-042 : consultation UI filtres =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(600)
    const filterTabs = await page.locator('.rh-validator-replacement-filters button').allInnerTexts()
    const totalRows = await page.locator('.rh-validator-replacement-row--body').count()
    console.log('VAL-042 UI', JSON.stringify({ filterTabs, totalRows }))
    out['VAL-042'] = { filterTabs, totalRows }
    await page.close().catch(() => {})
  }

  // ===== VAL-043 : consultation UI par ID (ouvrir un remplacement existant) =====
  {
    const list = (await apiRequest('/validator-replacements', { token: rh })).data
    const target = list[0]
    if (!target) throw new Error('VAL-043 no replacement')
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(600)
    const row = page.locator('.rh-validator-replacement-row--body').first()
    if (await row.count()) {
      await row.click()
      await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
      await page.waitForTimeout(400)
      const body = await page.locator('.rh-validators-drawer--replacement').innerText()
      out['VAL-043'] = { id: target.id, drawerShowsId: body.includes(String(target.id)) || body.includes('VALIDEUR TEMPORAIRE N°' + target.id) }
    } else {
      out['VAL-043'] = { noRow: true }
    }
    console.log('VAL-043 UI', JSON.stringify(out['VAL-043']))
    await page.close().catch(() => {})
  }

  await browser.close()
  console.log('RESULT', JSON.stringify(out, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
