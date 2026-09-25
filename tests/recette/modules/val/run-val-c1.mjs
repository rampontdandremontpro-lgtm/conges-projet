import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'VAL', scenario, type: '', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, scenario, ok, resultText, proof = '', comment = '') =>
    results.push(makeResult(id, 'P1', scenario, ok ? STATUS_OK : STATUS_KO, resultText, proof, ok ? '' : 'NC', comment))

  const TAG = 'C1' + Date.now().toString(36)

  // ===== Comptes =====
  const [admin, rh, dir, resp, colB] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
  ])
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  // ===== Service VAL C1 =====
  const svc = (await apiRequest('/services', {
    method: 'POST', token: admin,
    body: { name: 'Service VAL C1 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })).data
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  for (const uid of [respId, colBId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const today = todayIso()
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  async function newType(label) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })
    if (r.status !== 201) throw new Error('leave-type ' + label + ' -> ' + r.status + ' ' + JSON.stringify(r.data))
    return r.data
  }

  async function newRequest(type, off) {
    const s = openDate(off)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: type.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    if (r.status !== 201) throw new Error('request -> ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    if (sub.status !== 200) throw new Error('submit -> ' + sub.status + ' ' + JSON.stringify(sub.data))
    return r.data.id
  }

  async function getManagement(id, token) { return (await apiRequest(`/leave-requests/management/${id}`, { token })).data }

  const browser = await launch()

  // ===== Helper UI : ouvrir l'onglet Valideurs temporaires =====
  async function openValidatorsTab(page) {
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(500)
  }

  // ===== Helper UI : créer un remplacement =====
  async function uiCreateReplacement(page, empName, valName, start, end) {
    await page.waitForSelector('.rh-validators-new-replacement', { timeout: 10000 })
    await page.click('.rh-validators-new-replacement')
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const empSel = page.locator('.rh-validators-form select').nth(0)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const empMatch = empOpts.find((o) => o.includes(empName))
    if (!empMatch) throw new Error('Collaborateur introuvable : ' + empName)
    await empSel.selectOption({ label: empMatch })
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const valOpts = await valSel.locator('option').allInnerTexts()
    const valMatch = valOpts.find((o) => o.includes(valName))
    if (!valMatch) throw new Error('Valideur introuvable : ' + valName)
    await valSel.selectOption({ label: valMatch })
    await page.locator('.rh-validators-form input[type=date]').nth(0).fill(start)
    await page.locator('.rh-validators-form input[type=date]').nth(1).fill(end)
    await page.waitForTimeout(300)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/validator-replacements', { timeout: 15000 })
    await page.locator('.rh-validators-form .rh-validators-btn--primary').click()
    const resp = await p
    return resp
  }

  // ===== Helper UI : valider côté RH (avec accord Directeur) =====
  async function uiValidateRh(page, requestId, initials, capFile) {
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const agreeLabel = page.locator('.manager-request-actions-card__agreement')
    if (await agreeLabel.count()) {
      const agreeInput = agreeLabel.locator('input[type=checkbox]')
      if (!(await agreeInput.isChecked())) {
        await agreeLabel.click()
        await page.waitForTimeout(200)
      }
    }
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${requestId}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', initials)
    if (capFile) await capture(page, capFile)
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    return await p
  }

  // =====================================================================
  // VAL-056 — RH désigne la RH comme remplaçante
  // =====================================================================
  const startRep = today
  const endRep = isoAddDays(today, 30)
  let repRhId
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openValidatorsTab(page)
    const resp = await uiCreateReplacement(page, 'COL-B', 'RH-TEST', startRep, endRep)
    const data = await resp.json()
    // demande témoin : vérifier decisionAccess.kind = REMPLACEMENT pour RH
    const witnessType = await newType('C1-056-TEMOIN')
    const witnessId = await newRequest(witnessType, 40)
    const witnessMgmt = await getManagement(witnessId, rh)
    repRhId = data.id
    const ok = resp.status() === 201 && data.employeeId === colBId && data.replacementValidatorId === rhId && data.isActive === true && data.startDate === startRep && data.endDate === endRep && witnessMgmt?.decisionAccess?.kind === 'REMPLACEMENT'
    await capture(page, 'CAP-VAL-056.png')
    push('VAL-056', 'RH désigne la RH comme remplaçante', ok, `POST /api/validator-replacements HTTP=${resp.status()}, replacementId=${data.id}, employeeId=${data.employeeId}, replacementValidatorId=${data.replacementValidatorId}, isActive=${data.isActive}, decisionAccess=${witnessMgmt?.decisionAccess?.kind}`, 'CAP-VAL-056.png', `replacementId=${data.id}`)
    console.log('VAL-056', JSON.stringify({ actor: 'RH', employee: data.employeeId, replacementValidator: data.replacementValidatorId, replacementId: data.id, POST: '/api/validator-replacements', HTTP: resp.status(), isActive: data.isActive, decisionAccess: witnessMgmt?.decisionAccess?.kind, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-057 — RH désignée remplaçante valide en premier niveau
  // =====================================================================
  {
    const type057 = await newType('VAL-C1-057')
    const reqId = await newRequest(type057, 45)
    const before = await getManagement(reqId, rh)
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const rows = page.locator('.rh-events-row--data', { hasText: type057.name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error('VAL-057 rowCount=' + rowCount)
    await rows.first().click()
    await page.waitForURL('**/rh-all-requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const validateVisible = await page.locator('.manager-request-action--validate').count()
    const respVal = await uiValidateRh(page, reqId, 'RH', 'CAP-VAL-057.png')
    const body = await respVal.json()
    const ok = before?.decisionAccess?.kind === 'REMPLACEMENT' && validateVisible === 1 && respVal.status() === 200 && body.finalDeciderId === rhId && body.status === 'VALIDEE'
    push('VAL-057', 'La RH désignée remplaçante valide en premier niveau', ok, `requestId=${reqId}, decisionAccess avant=${before?.decisionAccess?.kind}, validate visible=${validateVisible}, POST /leave-requests/${reqId}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}`, 'CAP-VAL-057.png', `replacementId=${repRhId}`)
    console.log('VAL-057', JSON.stringify({ requestId: reqId, actor: 'RH', decisionAccessBefore: before?.decisionAccess?.kind, validateVisible, POST: `/api/leave-requests/${reqId}/validate`, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, workflowStatus: body.workflowStatus, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-058 — RH désactive son remplacement
  // =====================================================================
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openValidatorsTab(page)
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const rows = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-B' })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const isActiveBefore = (await apiRequest(`/validator-replacements/${repRhId}`, { token: rh })).data.isActive === true
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/api/validator-replacements/${repRhId}/disable$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const respDis = await p
    await page.waitForTimeout(500)
    const getRepl = await apiRequest(`/validator-replacements/${repRhId}`, { token: rh })
    const ok = respDis.status() === 200 && isActiveBefore === true && getRepl.data?.isActive === false && getRepl.status === 200
    push('VAL-058', 'RH désactive son remplacement', ok, `PATCH /api/validator-replacements/${repRhId}/disable HTTP=${respDis.status()}, isActive ${isActiveBefore ? 'true' : '?'}→${getRepl.data?.isActive}, ressource conservée=${getRepl.status === 200}`, '', `replacementId=${repRhId}`)
    console.log('VAL-058', JSON.stringify({ replacementId: repRhId, actor: 'RH', rowCount, PATCH: `/api/validator-replacements/${repRhId}/disable`, HTTP: respDis.status(), isActiveBefore, isActiveAfter: getRepl.data?.isActive, resourceStillExists: getRepl.status === 200, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-059 — RH désigne le Directeur comme remplaçant
  // =====================================================================
  let repDirId
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openValidatorsTab(page)
    const resp = await uiCreateReplacement(page, 'COL-B', 'DIR-TEST', startRep, endRep)
    const data = await resp.json()
    repDirId = data.id
    const ok = resp.status() === 201 && data.employeeId === colBId && data.replacementValidatorId === dirId && data.isActive === true && data.id !== repRhId
    await capture(page, 'CAP-VAL-059.png')
    push('VAL-059', 'RH désigne le Directeur comme remplaçant', ok, `POST /api/validator-replacements HTTP=${resp.status()}, replacementId=${data.id}, employeeId=${data.employeeId}, replacementValidatorId=${data.replacementValidatorId}, isActive=${data.isActive}`, 'CAP-VAL-059.png', 'erratum rôle cahier (Rôle=Directeur, acteur réel=RH confirmé full-functional-test.mjs)')
    console.log('VAL-059', JSON.stringify({ actor: 'RH', employee: data.employeeId, replacementValidator: data.replacementValidatorId, replacementId: data.id, POST: '/api/validator-replacements', HTTP: resp.status(), ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-060 — Directeur désigné remplaçant valide en premier niveau
  // =====================================================================
  {
    const type060 = await newType('VAL-C1-060')
    const reqId = await newRequest(type060, 50)
    const before = await getManagement(reqId, dir)
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/director-all-requests')
    await page.waitForSelector('.director-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.director-all-requests-row--data', { hasText: type060.name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error('VAL-060 director rowCount=' + rowCount)
    await rows.first().click()
    await page.waitForURL('**/director-all-requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${reqId}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'DR')
    await capture(page, 'CAP-VAL-060.png')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const respVal = await p
    const body = await respVal.json()
    const ok = before?.decisionAccess?.kind === 'REMPLACEMENT' && respVal.status() === 200 && body.finalDeciderId === dirId
    push('VAL-060', 'Le Directeur désigné remplaçant valide en premier niveau', ok, `requestId=${reqId}, decisionAccess avant=${before?.decisionAccess?.kind}, POST /leave-requests/${reqId}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}, workflowStatus=${body.workflowStatus}`, 'CAP-VAL-060.png', `replacementId=${repDirId}`)
    console.log('VAL-060', JSON.stringify({ requestId: reqId, actor: 'Directeur', decisionAccessBefore: before?.decisionAccess?.kind, POST: `/api/leave-requests/${reqId}/validate`, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, workflowStatus: body.workflowStatus, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-061 — RH désactive le remplacement du Directeur
  // =====================================================================
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openValidatorsTab(page)
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const rows = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-B' })
    const rowCount = await rows.count()
    // cible la ligne du remplacement Directeur (dernière créée, encore active)
    const target = (await apiRequest(`/validator-replacements?employeeId=${colBId}&isActive=true`, { token: rh })).data.find((x) => x.replacementValidatorId === dirId)
    if (!target) throw new Error('VAL-061 cible Directeur introuvable')
    await rows.first().click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const isActiveBefore = (await apiRequest(`/validator-replacements/${target.id}`, { token: rh })).data.isActive === true
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/api/validator-replacements/${target.id}/disable$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const respDis = await p
    await page.waitForTimeout(500)
    const getRepl = await apiRequest(`/validator-replacements/${target.id}`, { token: rh })
    const ok = respDis.status() === 200 && isActiveBefore === true && getRepl.data?.isActive === false && getRepl.status === 200
    push('VAL-061', 'RH désactive le remplacement du Directeur', ok, `PATCH /api/validator-replacements/${target.id}/disable HTTP=${respDis.status()}, isActive ${isActiveBefore ? 'true' : '?'}→${getRepl.data?.isActive}, ressource conservée=${getRepl.status === 200}`, '', `replacementId=${target.id}`)
    console.log('VAL-061', JSON.stringify({ actor: 'RH', replacementId: target.id, PATCH: `/api/validator-replacements/${target.id}/disable`, HTTP: respDis.status(), isActiveBefore, isActiveAfter: getRepl.data?.isActive, resourceStillExists: getRepl.status === 200, ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-val-c1' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('VAL-C1', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
