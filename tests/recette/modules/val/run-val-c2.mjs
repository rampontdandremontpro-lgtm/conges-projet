import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
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

  const TAG = 'C2' + Date.now().toString(36)

  // ===== Comptes =====
  const [admin, rh, dir, resp, colA] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'),
  ])
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  // ===== Service VAL C2 =====
  const svc = (await apiRequest('/services', {
    method: 'POST', token: admin,
    body: { name: 'Service VAL C2 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })).data
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id

  const createUser = async (nom, prenom, email, role) => {
    const r = await apiRequest('/users', { method: 'POST', token: admin, body: { nom, prenom, email, role, employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc.id } })
    if (r.status !== 201) throw new Error(`create ${email} -> ${r.status} ${JSON.stringify(r.data)}`)
    return r.data
  }
  const remplacant = await createUser('REMPLACANT', 'C2', `repl-c2-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')
  const secours = await createUser('SECOURS', 'C2', `secours-c2-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')

  for (const uid of [respId, colAId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const remplacantId = remplacant.id
  const secoursId = secours.id
  const secoursLogin = await login(`secours-c2-${TAG}@gmes.test`)
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: secoursId } })

  // ===== Remplacement actif pour Collaborateur A (remplaçant) =====
  const today = todayIso()
  const repStart = today
  const repEnd = isoAddDays(today, 30)
  const mkRepl = await apiRequest('/validator-replacements', {
    method: 'POST', token: rh,
    body: { employeeId: colAId, replacementValidatorId: remplacantId, startDate: repStart, endDate: repEnd, reason: 'Remplacement C2 collaborateur A.' },
  })
  if (mkRepl.status !== 201) throw new Error('replacement create ' + mkRepl.status + ' ' + JSON.stringify(mkRepl.data))
  const replacementId = mkRepl.data.id

  // ===== Type absence autorisée (source : full-functional-test rhOnlyAbsenceType) =====
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: {
    name: 'Absence autorisée', category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false,
  } })).data

  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  async function newType(label) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${label} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })
    if (r.status !== 201) throw new Error('leave-type ' + label + ' -> ' + r.status)
    return r.data
  }

  async function newRequest(type, off) {
    const s = openDate(off)
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: type.id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    if (r.status !== 201) throw new Error('request -> ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    if (sub.status !== 200) throw new Error('submit -> ' + sub.status)
    return r.data.id
  }

  async function getManagement(id, token) { return (await apiRequest(`/leave-requests/management/${id}`, { token })).data }
  async function presenceOf(id) { const c = await dbConn(); const [rows] = await c.execute('SELECT presence_status AS p FROM users WHERE id = ?', [id]); await c.end(); return rows[0]?.p }
  async function userInfo(id) { const c = await dbConn(); const [rows] = await c.execute('SELECT role, is_active AS isActive FROM users WHERE id = ?', [id]); await c.end(); return rows[0] }

  const browser = await launch()

  // =====================================================================
  // VAL-063 + VAL-064 — RH crée puis soumet l'absence du remplaçant (UI)
  // =====================================================================
  let absenceId = null
  let submitHTTP = null
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-create', { timeout: 10000 })
    await page.click('.rh-events-create')
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    await page.waitForTimeout(300)

    // employé = remplaçant
    const empSel = page.locator('.rh-declaration-top-grid select').nth(0)
    const empOpts = await empSel.locator('option').allInnerTexts()
    const empMatch = empOpts.find((o) => o.includes('REMPLACANT'))
    if (!empMatch) throw new Error('remplaçant introuvable dans le drawer')
    await empSel.selectOption({ label: empMatch })

    // type = Absence autorisée
    const typeSel = page.locator('.rh-declaration-top-grid select').nth(1)
    await typeSel.selectOption({ label: 'Absence autorisée' })

    // mode heures
    await page.waitForSelector('.rh-declaration-units button', { timeout: 10000 })
    await page.locator('.rh-declaration-units button', { hasText: 'Heures' }).click()
    await page.waitForTimeout(300)

    // date du jour (cellule today)
    await page.waitForSelector('.nr-cal__cell--today', { timeout: 10000 })
    await page.click('.nr-cal__cell--today')
    await page.waitForTimeout(300)

    // durée 7h
    await page.waitForSelector('.rh-declaration-field input[type=number]', { timeout: 10000 })
    await page.fill('.rh-declaration-field input[type=number]', '7')

    await capture(page, 'CAP-VAL-063.png')

    const pCreate = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/absence-declarations', { timeout: 15000 })
    const pSubmit = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/absence-declarations\/\d+\/submit$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-declaration-actions button.is-primary').click()
    const createResp = await pCreate
    const submitResp = await pSubmit
    const createData = await createResp.json()
    absenceId = createData.id
    submitHTTP = submitResp.status()

    const okCreate = createResp.status() === 201 && createData.id != null && createData.employeeId === remplacantId && createData.leaveTypeId === absenceType.id && createData.startDate === today && createData.endDate === today
    push('VAL-063', 'RH crée une absence pour le remplaçant', okCreate, `POST /api/absence-declarations HTTP=${createResp.status()}, absenceId=${createData.id}, employeeId=${createData.employeeId}, type=${createData.leaveTypeId}, dates=${createData.startDate}, status initial=${createData.status}`, 'CAP-VAL-063.png', `replacementId=${replacementId}`)
    console.log('VAL-063', JSON.stringify({ actor: 'RH', replacementValidatorId: remplacantId, absenceType: absenceType.name, absenceId, POST: '/api/absence-declarations', HTTP: createResp.status(), initialStatus: createData.status, replacementIsActive: true, ok: okCreate }))

    // VAL-064 : la soumission est portée par la même action UI réelle (le drawer enchaîne create+submit)
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const absenceRows = page.locator('.rh-events-row--data', { hasText: 'REMPLACANT' })
    const rowCount = await absenceRows.count()
    const statusAfter = (await apiRequest(`/absence-declarations/management/${absenceId}`, { token: rh })).data?.status
    const presenceAfter = await presenceOf(remplacantId)
    const replStillActive = (await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })).data?.isActive === true
    await absenceRows.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await capture(page, 'CAP-VAL-064.png')
    const okSubmit = submitHTTP === 200 && rowCount === 1 && statusAfter === 'ENREGISTREE' && presenceAfter === 'ABSENT' && replStillActive === true
    push('VAL-064', 'La RH soumet l’absence du remplaçant', okSubmit, `POST /api/absence-declarations/${absenceId}/submit HTTP=${submitHTTP}, statusAfter=${statusAfter}, presence remplaçant=${presenceAfter}, replacement.isActive=${replStillActive}`, 'CAP-VAL-064.png', `absenceId=${absenceId}`)
    console.log('VAL-064', JSON.stringify({ absenceId, UI: 'soumission réelle drawer', HTTP: submitHTTP, statusAfter, replacementPresenceAfter: presenceAfter, replacementIsActive: replStillActive, ok: okSubmit }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-062 — remplaçant absent (éligible)
  // =====================================================================
  {
    const replInfo = await userInfo(remplacantId)
    const replStillActive = (await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })).data?.isActive === true
    const presence = await presenceOf(remplacantId)
    const eligible = replInfo?.role === 'RESPONSABLE_SERVICE' && replInfo?.isActive === 1
    const ok = replStillActive === true && eligible === true && presence === 'ABSENT'
    push('VAL-062', 'Remplaçant absent (éligible)', ok, `replacementId=${replacementId}, replacementValidatorId=${remplacantId}, role=${replInfo?.role}, eligible=${eligible}, isActive=${replStillActive}, presence=${presence}, firstLevelId=${remplacantId}, firstLevelEligible=${eligible}, firstLevelPresent=${presence === 'PRESENT'}`, 'CAP-VAL-062.png', '')
    console.log('VAL-062', JSON.stringify({ replacementId, replacementValidatorId: remplacantId, role: replInfo?.role, eligible, isActive: replStillActive, presence, firstLevelId: remplacantId, firstLevelEligible: eligible, firstLevelPresent: presence === 'PRESENT', ok }))
  }

  // ===== CAP-062 : liste RH montrant l'absence du remplaçant =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await capture(page, 'CAP-VAL-062.png')
    await page.close().catch(() => {})
  }

  // =====================================================================
  // Demandes R65 / R66 / R67
  // =====================================================================
  const t65 = await newType('VAL-C2-065')
  const t66 = await newType('VAL-C2-066')
  const t67 = await newType('VAL-C2-067')
  const r65 = await newRequest(t65, 40)
  const r66 = await newRequest(t66, 45)
  const r67 = await newRequest(t67, 50)

  console.log('PRECONDITIONS', JSON.stringify({
    replacementId, replacementIsActive: true, replacementValidatorId: remplacantId,
    replacementValidatorRole: 'RESPONSABLE_SERVICE', replacementValidatorEligible: true,
    replacementPresence: await presenceOf(remplacantId), primaryManagerPresence: await presenceOf(respId),
    secoursId, secoursActive: true, directorId: dirId, takeoverDelayDays: 7, delayExpired: false, emergencyTakeover: false,
  }))

  // =====================================================================
  // VAL-065 — Responsable principal reste exclu
  // =====================================================================
  {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: t65.name })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    await page.waitForTimeout(200)
    const validateCount = await page.locator('.manager-request-action--validate').count()
    const access = await getManagement(r65, resp)
    const apiVal = await apiRequest(`/leave-requests/${r65}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'RE' } })
    await capture(page, 'CAP-VAL-065.png')
    const ok = rowCount === 1 && validateCount === 0 && !access?.decisionAccess && apiVal.status === 403
    push('VAL-065', 'Le Responsable principal reste exclu quand le remplaçant est absent', ok, `requestId=${r65}, rowCount=${rowCount}, validateButtonCount=${validateCount}, decisionAccess=${access?.decisionAccess ?? 'absent'}, API validate=${apiVal.status}, aucune mutation`, 'CAP-VAL-065.png', '')
    console.log('VAL-065', JSON.stringify({ requestId: r65, manager: respId, replacementPresence: await presenceOf(remplacantId), replacementIsActive: true, validateButtonCount: validateCount, decisionAccess: access?.decisionAccess ?? null, apiHTTP: apiVal.status, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-066 — secours valide quand le remplaçant est absent
  // =====================================================================
  {
    const access = await getManagement(r66, secoursLogin)
    const page = await loginPage(browser, `secours-c2-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.manager-all-requests-row--data', { hasText: t66.name })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForURL('**/requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${r66}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'SS')
    await capture(page, 'CAP-VAL-066.png')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const respVal = await p
    const body = await respVal.json()
    const ok = rowCount === 1 && access?.decisionAccess?.kind === 'SECOURS' && respVal.status() === 200 && body.finalDeciderId === secoursId
    push('VAL-066', 'Le secours valide quand le remplaçant est absent', ok, `requestId=${r66}, decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r66}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}, workflowStatus=${body.workflowStatus}`, 'CAP-VAL-066.png', '')
    console.log('VAL-066', JSON.stringify({ requestId: r66, secoursId, replacementPresence: await presenceOf(remplacantId), delayExpired: false, decisionAccess: access?.decisionAccess?.kind, POST: `/api/leave-requests/${r66}/validate`, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, workflowStatus: body.workflowStatus, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-067 — Directeur valide en relais quand le remplaçant est absent
  // =====================================================================
  {
    const access = await getManagement(r67, dir)
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/director-all-requests')
    await page.waitForSelector('.director-all-requests-row--data', { timeout: 10000 })
    const rows = page.locator('.director-all-requests-row--data', { hasText: t67.name })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForURL('**/director-all-requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${r67}/validate`, { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'DR')
    await capture(page, 'CAP-VAL-067.png')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const respVal = await p
    const body = await respVal.json()
    const ok = rowCount === 1 && access?.decisionAccess?.kind === 'RELAIS' && respVal.status() === 200 && body.finalDeciderId === dirId
    push('VAL-067', 'Le Directeur valide en relais quand le remplaçant est absent', ok, `requestId=${r67}, decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r67}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}, workflowStatus=${body.workflowStatus}`, 'CAP-VAL-067.png', '')
    console.log('VAL-067', JSON.stringify({ requestId: r67, directorId: dirId, replacementPresence: await presenceOf(remplacantId), delayExpired: false, emergency: false, decisionAccess: access?.decisionAccess?.kind, POST: `/api/leave-requests/${r67}/validate`, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, workflowStatus: body.workflowStatus, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // VAL-068 — RH annule l'absence du remplaçant
  // =====================================================================
  {
    const statusBefore = (await apiRequest(`/absence-declarations/management/${absenceId}`, { token: rh })).data?.status
    const presenceBefore = await presenceOf(remplacantId)
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const rows = page.locator('.rh-events-row--data', { hasText: 'REMPLACANT' })
    await rows.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button--danger', { timeout: 10000 })
    await capture(page, 'CAP-VAL-068.png')
    page.once('dialog', (dialog) => dialog.accept().catch(() => {}))
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/absence-declarations/${absenceId}/cancel$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.locator('.rh-absence-button--danger', { hasText: 'Annuler l’absence' }).click()
    const respCancel = await p
    await page.waitForTimeout(500)
    const statusAfter = (await apiRequest(`/absence-declarations/management/${absenceId}`, { token: rh })).data?.status
    const presenceAfter = await presenceOf(remplacantId)
    const replStillActive = (await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })).data?.isActive === true
    const histo = (await apiRequest(`/absence-declarations/management/${absenceId}`, { token: rh })).status === 200
    const ok = statusBefore === 'ENREGISTREE' && presenceBefore === 'ABSENT' && respCancel.status() === 200 && statusAfter === 'ANNULEE' && presenceAfter === 'PRESENT' && replStillActive === true && histo
    push('VAL-068', 'La RH annule l’absence du remplaçant', ok, `absenceId=${absenceId}, statusBefore=${statusBefore}, presenceBefore=${presenceBefore}, POST /absence-declarations/${absenceId}/cancel HTTP=${respCancel.status()}, statusAfter=${statusAfter}, presenceAfter=${presenceAfter}, replacement.isActive=${replStillActive}, historisée=${histo}`, 'CAP-VAL-068.png', '')
    console.log('VAL-068', JSON.stringify({ absenceId, statusBefore, presenceBefore, UI: 'annulation réelle', HTTP: respCancel.status(), statusAfter, presenceAfter, replacementIsActive: replStillActive, historique: histo, ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-val-c2' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('VAL-C2', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
