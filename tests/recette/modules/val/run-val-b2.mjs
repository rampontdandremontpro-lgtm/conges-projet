import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'VAL', scenario, type: '', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

function assertOk(cond) { return Boolean(cond) }

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, scenario, ok, resultText, proof = '', comment = '') =>
    results.push(makeResult(id, 'P1', scenario, ok ? STATUS_OK : STATUS_KO, resultText, proof, ok ? '' : 'NC', comment))

  const TAG = 'B2' + Date.now().toString(36)

  // ===== Comptes =====
  const [admin, rh, dir, resp, colB] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
  ])
  const rhMe = (await apiRequest('/users/me', { token: rh })).data
  const rhId = rhMe.id

  // ===== Service VAL B2 =====
  const svc = (await apiRequest('/services', {
    method: 'POST', token: admin,
    body: { name: 'Service VAL B2 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })).data

  // ===== Acteurs additionnels : remplaçant + secours =====
  const createUser = async (nom, prenom, email, role) => {
    const r = await apiRequest('/users', { method: 'POST', token: admin, body: { nom, prenom, email, role, employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc.id } })
    if (r.status !== 201) throw new Error(`create ${email} -> ${r.status} ${JSON.stringify(r.data)}`)
    return r.data
  }
  const repl = await createUser('REMPLACANT', 'B2', `repl-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')
  const secours = await createUser('SECOURS', 'B2', `secours-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')

  // ===== Affectation service =====
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  for (const uid of [respId, colBId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  // ===== Secours (backup validator) =====
  const secoursLogin = await login(`secours-${TAG}@gmes.test`)
  const replLogin = await login(`repl-${TAG}@gmes.test`)
  const secoursId = (await apiRequest('/users/me', { token: secoursLogin })).data.id
  const replId = (await apiRequest('/users/me', { token: replLogin })).data.id
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: secoursId } })

  // ===== Remplacement actif pour Collaborateur B =====
  const today = todayIso()
  const replEnd = isoAddDays(today, 60)
  const mkRepl = await apiRequest('/validator-replacements', {
    method: 'POST', token: rh,
    body: { employeeId: colBId, replacementValidatorId: replId, startDate: today, endDate: replEnd, reason: 'Remplacement B2 collaborateur B.' },
  })
  if (mkRepl.status !== 201) throw new Error('replacement create ' + mkRepl.status + ' ' + JSON.stringify(mkRepl.data))
  const replacementId = mkRepl.data.id

  // ===== Helpers =====
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  const leaveTypes = {}
  async function newType(label) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })
    if (r.status !== 201) throw new Error('leave-type ' + label + ' -> ' + r.status + ' ' + JSON.stringify(r.data))
    leaveTypes[label] = r.data
    return r.data
  }

  async function newRequest(label, off, backdateDays = null) {
    const type = leaveTypes[label] ?? await newType(label)
    const s = openDate(off)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colB, body: { leaveTypeId: type.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    if (r.status !== 201) throw new Error('request ' + label + ' -> ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colB, body: { signatureType: 'INITIALS', signatureData: 'CB' } })
    if (sub.status !== 200) throw new Error('submit ' + label + ' -> ' + sub.status + ' ' + JSON.stringify(sub.data))
    if (backdateDays) {
      const c = await dbConn()
      await c.execute(`UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL ${backdateDays} DAY) WHERE id = ?`, [r.data.id])
      await c.end()
    }
    return r.data.id
  }

  async function getManagement(id, token) {
    return (await apiRequest(`/leave-requests/management/${id}`, { token })).data
  }

  async function getDecisionAccess(id, token) {
    const m = await getManagement(id, token)
    return m?.decisionAccess ?? null
  }

  const browser = await launch()

  // ===== UI : ouvrir une demande manager et valider =====
  async function openManagerRow(page, typeLabel) {
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: typeLabel })
    const rc = await rows.count()
    if (rc !== 1) throw new Error(`${typeLabel} rowCount=${rc}`)
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    return rc
  }

  async function uiValidateManager(page, requestId, initials, capFile = null) {
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${requestId}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', initials)
    if (capFile) await capture(page, capFile)
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const resp = await p
    return resp
  }

  // =====================================================================
  // CHAÎNE 1 — VAL-044 / 045 / 046
  // =====================================================================
  const r1 = await newRequest('B2-044-046', 40)

  // VAL-044
  {
    const access = await getDecisionAccess(r1, replLogin)
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: leaveTypes['B2-044-046'].name })
    const rowCount = await rows.count()
    const rowText = rowCount >= 1 ? await rows.first().innerText() : ''
    const ok = assertOk(rowCount === 1 && rowText.includes('COL-B') && access?.kind === 'REMPLACEMENT')
    await capture(page, 'CAP-VAL-044.png')
    push('VAL-044', 'Le remplaçant voit la demande dans sa liste d’attente', ok, `UI remplaçant : rowCount=${rowCount}, collaborateur COL-B visible, requestId=${r1}, decisionAccess=${access?.kind}`, 'CAP-VAL-044.png', `replacementId=${replacementId}`)
    console.log('VAL-044', JSON.stringify({ r1, rowCount, decisionAccess: access?.kind, ok }))
    await page.close().catch(() => {})
  }

  // VAL-045 — Responsable remplacé : visible mais non actionnable
  {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: leaveTypes['B2-044-046'].name })
    const rowCount = await rows.count()
    // ouvrir le détail
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    await page.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    const validateCount = await page.locator('.manager-request-action--validate').count()
    const readonlyText = await page.locator('.manager-request-actions-card__readonly').innerText().catch(() => '')
    // corroboration API
    const apiValidate = await apiRequest(`/leave-requests/${r1}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'RE' } })
    const ok = assertOk(validateCount === 0 && readonlyText.includes('attribuée à un autre valideur') && apiValidate.status === 403)
    push('VAL-045', 'Le Responsable remplacé ne voit plus la demande du collaborateur B', ok, `UI Responsable remplacé : visible (rowCount=${rowCount}) mais action absente (validate=${validateCount}), readonly="attribuée à un autre valideur" ; API validate=${apiValidate.status}`, '', `requestId=${r1}`)
    console.log('VAL-045', JSON.stringify({ r1, rowCount, validateCount, apiHTTP: apiValidate.status, ok }))
    await page.close().catch(() => {})
  }

  // VAL-046 — remplaçant valide la demande en attente
  {
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, leaveTypes['B2-044-046'].name)
    const respVal = await uiValidateManager(page, r1, 'RP', 'CAP-VAL-046.png')
    const body = await respVal.json()
    const second = await apiRequest(`/leave-requests/${r1}/validate`, { method: 'POST', token: replLogin, body: { signatureType: 'INITIALS', signatureData: 'RP' } })
    const ok = assertOk(respVal.status() === 200 && body.finalDeciderId === replId && (second.status === 403 || second.status === 409))
    push('VAL-046', 'Le remplaçant valide la demande en attente', ok, `UI remplaçant valide → POST /leave-requests/${r1}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, workflowStatus=${body.workflowStatus}, validationStage=${body.validationStage}, 2e tentative=${second.status}`, 'CAP-VAL-046.png', `requestId=${r1}`)
    console.log('VAL-046', JSON.stringify({ r1, http: respVal.status(), finalDeciderId: body.finalDeciderId, workflowStatus: body.workflowStatus, second: second.status, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // CHAÎNE 2 — VAL-047 / 048
  // =====================================================================
  const r2 = await newRequest('B2-047-048', 45)

  // VAL-047
  {
    const c = await dbConn()
    const [rows] = await c.execute(`SELECT user_id AS userId FROM notifications WHERE leave_request_id = ? AND type = 'LEAVE_REQUEST_SUBMITTED'`, [r2])
    const userIds = rows.map((r) => Number(r.userId))
    const replNotif = userIds.filter((id) => id === replId).length
    const respNotif = userIds.filter((id) => id === respId).length
    // deuxième passage : maintenance
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
    const [rows2] = await c.execute(`SELECT user_id AS userId FROM notifications WHERE leave_request_id = ? AND type = 'LEAVE_REQUEST_SUBMITTED'`, [r2])
    const userIds2 = rows2.map((r) => Number(r.userId))
    await c.end()
    const noDup = userIds2.filter((id) => id === replId).length === 1
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/notifications')
    await page.waitForSelector('.notifications-page-card', { timeout: 10000 }).catch(() => {})
    const notifVisible = await page.locator('.notifications-page-card', { hasText: 'Nouvelle demande de congé' }).count()
    await capture(page, 'CAP-VAL-047.png')
    const ok = assertOk(replNotif === 1 && respNotif === 0 && noDup && notifVisible >= 1)
    push('VAL-047', 'La notification de soumission désigne le remplaçant, pas le Responsable remplacé', ok, `notification remplaçant=${replNotif}, notification Responsable=${respNotif}, doublon=${!noDup}, UI notif remplaçant visible=${notifVisible}`, 'CAP-VAL-047.png', `requestId=${r2}`)
    console.log('VAL-047', JSON.stringify({ r2, userIds, userIds2, replNotif, respNotif, noDup, notifVisible, ok }))
    await page.close().catch(() => {})
  }

  // VAL-048
  {
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, leaveTypes['B2-047-048'].name)
    const respVal = await uiValidateManager(page, r2, 'RP', 'CAP-VAL-048.png')
    const body = await respVal.json()
    const ok = assertOk(respVal.status() === 200 && body.finalDeciderId === replId)
    push('VAL-048', 'Le remplaçant valide la demande notifiée', ok, `UI remplaçant valide la demande notifiée → HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, workflowStatus=${body.workflowStatus}`, 'CAP-VAL-048.png', `requestId=${r2}`)
    console.log('VAL-048', JSON.stringify({ r2, http: respVal.status(), finalDeciderId: body.finalDeciderId, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // CHAÎNE 3 — VAL-049 / 050 / 051 (délai expiré)
  // =====================================================================
  const r3 = await newRequest('B2-049', 50, 8)
  const r4 = await newRequest('B2-050', 55, 8)
  const r5 = await newRequest('B2-051', 60, 8)

  async function delayProof(id) {
    const c = await dbConn()
    const [rows] = await c.execute(`SELECT submitted_at AS submittedAt FROM leave_requests WHERE id = ?`, [id])
    await c.end()
    const submittedAt = rows[0]?.submittedAt ? new Date(rows[0].submittedAt) : null
    const takeoverAt = submittedAt ? new Date(submittedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null
    const now = new Date()
    return { submittedAt: submittedAt ? submittedAt.toISOString() : null, takeoverAt: takeoverAt ? takeoverAt.toISOString() : null, delayExpired: takeoverAt ? now.getTime() >= takeoverAt.getTime() : false }
  }

  // VAL-049
  {
    const dp = await delayProof(r3)
    const access = await getDecisionAccess(r3, replLogin)
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, leaveTypes['B2-049'].name)
    const respVal = await uiValidateManager(page, r3, 'RP', 'CAP-VAL-049.png')
    const body = await respVal.json()
    const ok = assertOk(dp.delayExpired === true && access?.kind === 'REMPLACEMENT' && respVal.status() === 200 && body.finalDeciderId === replId)
    push('VAL-049', 'Délai expiré : le remplaçant conserve son droit de décision', ok, `requestId=${r3}, submittedAt=${dp.submittedAt}, takeoverAt=${dp.takeoverAt}, delayExpired=${dp.delayExpired}, decisionAccess=${access?.kind}, HTTP=${respVal.status()}`, 'CAP-VAL-049.png', '')
    console.log('VAL-049', JSON.stringify({ r3, ...dp, decisionAccess: access?.kind, http: respVal.status(), ok }))
    await page.close().catch(() => {})
  }

  // VAL-050
  {
    const dp = await delayProof(r4)
    const access = await getDecisionAccess(r4, secoursLogin)
    const page = await loginPage(browser, `secours-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, leaveTypes['B2-050'].name)
    const respVal = await uiValidateManager(page, r4, 'SS', 'CAP-VAL-050.png')
    const body = await respVal.json()
    const ok = assertOk(dp.delayExpired === true && access?.kind === 'SECOURS' && respVal.status() === 200 && body.finalDeciderId === secoursId)
    push('VAL-050', 'Délai expiré : le secours valide', ok, `requestId=${r4}, delayExpired=${dp.delayExpired}, decisionAccess=${access?.kind}, HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}`, 'CAP-VAL-050.png', '')
    console.log('VAL-050', JSON.stringify({ r4, ...dp, decisionAccess: access?.kind, http: respVal.status(), ok }))
    await page.close().catch(() => {})
  }

  // VAL-051
  {
    const dp = await delayProof(r5)
    const access = await getDecisionAccess(r5, dir)
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/director-all-requests')
    await page.waitForSelector('.director-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.director-all-requests-row--data', { hasText: leaveTypes['B2-051'].name })
    const rowCount = await rows.count()
    if (rowCount !== 1) throw new Error('VAL-051 director rowCount=' + rowCount)
    await rows.first().click()
    await page.waitForURL('**/director-all-requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${r5}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'DR')
    await capture(page, 'CAP-VAL-051.png')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const respVal = await p
    const body = await respVal.json()
    const ok = assertOk(dp.delayExpired === true && access?.kind === 'RELAIS' && respVal.status() === 200 && body.finalDeciderId === (await apiRequest('/users/me', { token: dir })).data.id)
    push('VAL-051', 'Délai expiré : le Directeur valide en relais', ok, `requestId=${r5}, delayExpired=${dp.delayExpired}, decisionAccess=${access?.kind}, HTTP=${respVal.status()}`, 'CAP-VAL-051.png', '')
    console.log('VAL-051', JSON.stringify({ r5, ...dp, decisionAccess: access?.kind, http: respVal.status(), ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // CHAÎNE 4 — VAL-052 / 053 / 054 / 055
  // =====================================================================
  const r6 = await newRequest('B2-052-053', 65)

  // VAL-052
  {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: leaveTypes['B2-052-053'].name })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    const validateCount = await page.locator('.manager-request-action--validate').count()
    const apiValidate = await apiRequest(`/leave-requests/${r6}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'RE' } })
    const ok = assertOk(validateCount === 0 && apiValidate.status === 403)
    push('VAL-052', 'Le Responsable remplacé reste exclu pendant le remplacement', ok, `UI Responsable remplacé : validate=${validateCount} (action absente), API validate=${apiValidate.status}`, '', `requestId=${r6}`)
    console.log('VAL-052', JSON.stringify({ r6, rowCount, validateCount, apiHTTP: apiValidate.status, ok }))
    await page.close().catch(() => {})
  }

  // VAL-053
  {
    const page = await loginPage(browser, `repl-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, leaveTypes['B2-052-053'].name)
    const respVal = await uiValidateManager(page, r6, 'RP', 'CAP-VAL-053.png')
    const body = await respVal.json()
    const ok = assertOk(respVal.status() === 200 && body.finalDeciderId === replId)
    push('VAL-053', 'Le remplaçant traite la demande laissée par le Responsable', ok, `UI remplaçant traite la demande laissée → HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, workflowStatus=${body.workflowStatus}`, 'CAP-VAL-053.png', `requestId=${r6}`)
    console.log('VAL-053', JSON.stringify({ r6, http: respVal.status(), finalDeciderId: body.finalDeciderId, ok }))
    await page.close().catch(() => {})
  }

  // VAL-054
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(500)
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const rows = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-B' })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/api/validator-replacements/${replacementId}/disable$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const respDis = await p
    await page.waitForTimeout(500)
    const getRepl = await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })
    const ok = assertOk(respDis.status() === 200 && getRepl.data?.isActive === false && getRepl.status === 200)
    push('VAL-054', 'RH désactive le remplacement du collaborateur B', ok, `UI RH désactive → PATCH /api/validator-replacements/${replacementId}/disable HTTP=${respDis.status()}, isActive ${getRepl.data?.isActive === false ? 'true→false' : 'INATTENDU'}, ressource conservée=${getRepl.status === 200}`, '', `replacementId=${replacementId}`)
    console.log('VAL-054', JSON.stringify({ replacementId, rowCount, http: respDis.status(), isActiveAfter: getRepl.data?.isActive, ok }))
    await page.close().catch(() => {})
  }

  // VAL-055
  {
    const activeCount = (await apiRequest(`/validator-replacements?employeeId=${colBId}&isActive=true`, { token: rh })).data.length
    const r7 = await newRequest('B2-055', 70)
    const access = await getDecisionAccess(r7, resp)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: leaveTypes['B2-055'].name })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    const respVal = await uiValidateManager(page, r7, 'RE', 'CAP-VAL-055.png')
    const body = await respVal.json()
    const ok = assertOk(activeCount === 0 && access?.kind === 'RESPONSABLE_PRINCIPAL' && respVal.status() === 200 && body.finalDeciderId === respId)
    push('VAL-055', 'Fin du remplacement : le Responsable valide de nouveau', ok, `replacement actif B=${activeCount}, decisionAccess=${access?.kind}, UI Responsable valide → HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}`, 'CAP-VAL-055.png', `requestId=${r7}`)
    console.log('VAL-055', JSON.stringify({ r7, activeCount, decisionAccess: access?.kind, http: respVal.status(), ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-val-b2' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('VAL-B2', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
