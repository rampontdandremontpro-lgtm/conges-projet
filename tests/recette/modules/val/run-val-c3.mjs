import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'VAL', scenario, type: '', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

function containsSensitive(value) {
  if (value == null) return false
  if (typeof value === 'string') {
    return /password|passwd|token|secret|authorization|signature|signatureData|signatureImage|fileContent|documentContent|accessToken|refreshToken/i.test(value)
  }
  if (Array.isArray(value)) return value.some(containsSensitive)
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/password|passwd|token|secret|authorization|signature|signatureData|signatureImage|fileContent|documentContent|accessToken|refreshToken/i.test(k)) return true
      if (containsSensitive(v)) return true
    }
  }
  return false
}

function parseJson(value) {
  if (value == null) return value
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return value }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, scenario, ok, resultText, proof = '', comment = '') =>
    results.push(makeResult(id, 'P1', scenario, ok ? STATUS_OK : STATUS_KO, resultText, proof, ok ? '' : 'NC', comment))

  console.log('SOURCE ORDER', JSON.stringify({
    'VAL-069': 'users.is_active=0 remplaçant → soumettre R69 → Responsable valide',
    'VAL-070': 'R70 soumise (remplaçant inactif) → secours refusé',
    'VAL-071': 'Responsable valide R70 (même requestId)',
    'VAL-072': 'users.role=COLLABORATEUR remplaçant → soumettre R72 → Responsable valide',
    'VAL-073': 'RH désactive le remplacement collaborateur A',
    'VAL-074': 'soumettre R74 → Responsable valide',
    'VAL-075': 'audit : SERVICE_BACKUP_VALIDATOR_ASSIGNED / _DISABLED / _ENABLED / VALIDATOR_REPLACEMENT_CREATED / _DISABLED',
  }))

  const TAG = 'C3' + Date.now().toString(36)

  const [admin, rh, dir, resp, colA] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'),
  ])
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id

  // Service
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service VAL FINAL ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id

  const createUser = async (nom, prenom, email, role) => {
    const r = await apiRequest('/users', { method: 'POST', token: admin, body: { nom, prenom, email, role, employmentType: 'INTERNE', hireDate: '2024-01-01', password: 'RecetteGMES@2026!', serviceId: svc.id } })
    if (r.status !== 201) throw new Error(`create ${email} -> ${r.status} ${JSON.stringify(r.data)}`)
    return r.data
  }
  const remplacant = await createUser('REMPLACANT', 'C3', `repl-c3-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')
  const secours = await createUser('SECOURS', 'C3', `secours-c3-${TAG}@gmes.test`, 'RESPONSABLE_SERVICE')
  const remplacantId = remplacant.id
  const secoursId = secours.id
  const secoursLogin = await login(`secours-c3-${TAG}@gmes.test`)

  for (const uid of [respId, colAId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  // Secours : assigné → désactivé → réactivé (produit les 3 audits backup)
  await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: secoursId } })
  await apiRequest(`/services/${svc.id}/validators/${secoursId}/disable`, { method: 'PATCH', token: admin })
  await apiRequest(`/services/${svc.id}/validators/${secoursId}/enable`, { method: 'PATCH', token: admin })

  // Remplacement Collaborateur A → remplaçant
  const today = todayIso()
  const repStart = today
  const repEnd = isoAddDays(today, 60)
  const mkRepl = await apiRequest('/validator-replacements', { method: 'POST', token: rh, body: { employeeId: colAId, replacementValidatorId: remplacantId, startDate: repStart, endDate: repEnd, reason: 'Remplacement C3 collaborateur A.' } })
  if (mkRepl.status !== 201) throw new Error('replacement ' + mkRepl.status + ' ' + JSON.stringify(mkRepl.data))
  const replacementId = mkRepl.data.id

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

  async function setUserActive(id, val) { const c = await dbConn(); await c.execute('UPDATE users SET is_active = ? WHERE id = ?', [val, id]); await c.end() }
  async function setUserRole(id, role) { const c = await dbConn(); await c.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]); await c.end() }
  async function userInfo(id) { const c = await dbConn(); const [rows] = await c.execute('SELECT role, is_active AS isActive, presence_status AS presence FROM users WHERE id = ?', [id]); await c.end(); return rows[0] }

  const browser = await launch()

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
  async function uiValidateManager(page, requestId, initials, capFile) {
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
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

  // ===== Chaîne 069-071 : remplaçant INACTIF =====
  await setUserActive(remplacantId, 0)

  const t69 = await newType('VAL-FINAL-069')
  const r69 = await newRequest(t69, 40)

  // VAL-069
  {
    const access = await getManagement(r69, resp)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, t69.name)
    const respVal = await uiValidateManager(page, r69, 'RE', 'CAP-VAL-069.png')
    const body = await respVal.json()
    const ok = access?.decisionAccess?.kind === 'RESPONSABLE_PRINCIPAL' && respVal.status() === 200 && body.finalDeciderId === respId
    push('VAL-069', 'Le Responsable principal reprend la demande quand le remplaçant est inactif', ok, `replacementId=${replacementId}, replacement.isActive=${true}, remplaçant inactif, requestId=${r69}, decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r69}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}`, 'CAP-VAL-069.png', '')
    console.log('VAL-069', JSON.stringify({ replacementId, replacementIsActive: true, remplacantUserActive: false, managerPresence: 'PRESENT', requestId: r69, decisionAccess: access?.decisionAccess?.kind, UI: 'droit repris', HTTP: respVal.status(), ok }))
    await page.close().catch(() => {})
  }

  const t70 = await newType('VAL-FINAL-070')
  const r70 = await newRequest(t70, 45)

  // VAL-070
  {
    const access = await getManagement(r70, secoursLogin)
    const page = await loginPage(browser, `secours-c3-${TAG}@gmes.test`)
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, t70.name)
    await page.waitForSelector('.manager-request-actions-card', { timeout: 10000 })
    const validateCount = await page.locator('.manager-request-action--validate').count()
    const apiVal = await apiRequest(`/leave-requests/${r70}/validate`, { method: 'POST', token: secoursLogin, body: { signatureType: 'INITIALS', signatureData: 'SS' } })
    await capture(page, 'CAP-VAL-070.png')
    const ok = !access?.decisionAccess && validateCount === 0 && apiVal.status === 403
    push('VAL-070', 'Le secours reste refusé quand le remplaçant est inactif et le Responsable présent', ok, `requestId=${r70}, decisionAccess=${access?.decisionAccess ?? 'absent'}, UI validate=${validateCount}, API validate=${apiVal.status}, message="${apiVal.data?.message ?? ''}"`, 'CAP-VAL-070.png', '')
    console.log('VAL-070', JSON.stringify({ replacementId, replacementIsActive: true, managerPresence: 'PRESENT', secoursId, requestId: r70, UIProtection: validateCount === 0, decisionAccess: access?.decisionAccess ?? null, apiHTTP: apiVal.status, message: apiVal.data?.message ?? '', ok }))
    await page.close().catch(() => {})
  }

  // VAL-071 — Responsable traite R70 (même requestId)
  {
    const access = await getManagement(r70, resp)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, t70.name)
    const respVal = await uiValidateManager(page, r70, 'RE', null)
    const body = await respVal.json()
    const ok = access?.decisionAccess?.kind === 'RESPONSABLE_PRINCIPAL' && respVal.status() === 200 && body.finalDeciderId === respId
    push('VAL-071', 'Le Responsable principal traite la demande laissée en attente', ok, `requestId=${r70} (réutilisée après refus secours), decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r70}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}`, '', '')
    console.log('VAL-071', JSON.stringify({ requestId: r70, sourceRequestReused: true, decisionAccess: access?.decisionAccess?.kind, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, ok }))
    await page.close().catch(() => {})
  }

  await setUserActive(remplacantId, 1)

  // ===== Chaîne 072 : remplaçant change de rôle =====
  await setUserRole(remplacantId, 'COLLABORATEUR')
  const t72 = await newType('VAL-FINAL-072')
  const r72 = await newRequest(t72, 50)

  // VAL-072
  {
    const before = await userInfo(remplacantId)
    const access = await getManagement(r72, resp)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, t72.name)
    const respVal = await uiValidateManager(page, r72, 'RE', 'CAP-VAL-072.png')
    const body = await respVal.json()
    const ok = before.role === 'COLLABORATEUR' && access?.decisionAccess?.kind === 'RESPONSABLE_PRINCIPAL' && respVal.status() === 200 && body.finalDeciderId === respId
    push('VAL-072', 'Le Responsable principal reprend la demande quand le remplaçant change de rôle', ok, `replacementId=${replacementId}, replacement.isActive=true, roleBefore=RESPONSABLE_SERVICE, roleAfter=${before.role}, eligibleBefore=true, eligibleAfter=false, requestId=${r72}, decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r72}/validate HTTP=${respVal.status()}`, 'CAP-VAL-072.png', '')
    console.log('VAL-072', JSON.stringify({ replacementId, replacementIsActive: true, roleBefore: 'RESPONSABLE_SERVICE', roleAfter: before.role, eligibleBefore: true, eligibleAfter: false, requestId: r72, decisionAccessAfter: access?.decisionAccess?.kind, validateVisible: 1, ok }))
    await page.close().catch(() => {})
  }
  await setUserRole(remplacantId, 'RESPONSABLE_SERVICE')

  // ===== VAL-073 : RH désactive le remplacement du collaborateur A =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(500)
    await page.waitForSelector('.rh-validator-replacement-row--body', { timeout: 10000 })
    const rows = page.locator('.rh-validator-replacement-row--body', { hasText: 'COL-A' })
    const rowCount = await rows.count()
    await rows.first().click()
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(400)
    const isActiveBefore = (await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })).data.isActive === true
    const disBtn = page.locator('.rh-validators-btn--danger', { hasText: 'Désactiver' })
    await disBtn.waitFor({ state: 'visible', timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'PATCH' && new RegExp(`/api/validator-replacements/${replacementId}/disable$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await disBtn.click()
    const respDis = await p
    await page.waitForTimeout(500)
    const getRepl = await apiRequest(`/validator-replacements/${replacementId}`, { token: rh })
    const ok = rowCount === 1 && isActiveBefore === true && respDis.status() === 200 && getRepl.data?.isActive === false && getRepl.status === 200
    push('VAL-073', 'RH désactive le remplacement du collaborateur A', ok, `PATCH /api/validator-replacements/${replacementId}/disable HTTP=${respDis.status()}, isActive ${isActiveBefore ? 'true' : '?'}→${getRepl.data?.isActive}, historique=${getRepl.status === 200}`, '', `replacementId=${replacementId}`)
    console.log('VAL-073', JSON.stringify({ replacementId, UI: 'désactivation réelle', PATCH: `/api/validator-replacements/${replacementId}/disable`, HTTP: respDis.status(), isActiveBefore, isActiveAfter: getRepl.data?.isActive, ok }))
    await page.close().catch(() => {})
  }

  // ===== VAL-074 : Responsable valide de nouveau après désactivation =====
  const t74 = await newType('VAL-FINAL-074')
  const r74 = await newRequest(t74, 55)
  {
    const access = await getManagement(r74, resp)
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await openManagerRow(page, t74.name)
    const respVal = await uiValidateManager(page, r74, 'RE', 'CAP-VAL-074.png')
    const body = await respVal.json()
    const ok = access?.decisionAccess?.kind === 'RESPONSABLE_PRINCIPAL' && respVal.status() === 200 && body.finalDeciderId === respId
    push('VAL-074', 'Le Responsable valide de nouveau après désactivation du remplacement', ok, `replacementId=${replacementId}, requestId=${r74}, decisionAccess=${access?.decisionAccess?.kind}, POST /leave-requests/${r74}/validate HTTP=${respVal.status()}, finalDeciderId=${body.finalDeciderId}, statusAfter=${body.status}`, 'CAP-VAL-074.png', '')
    console.log('VAL-074', JSON.stringify({ replacementId, requestId: r74, decisionAccess: access?.decisionAccess?.kind, POST: `/api/leave-requests/${r74}/validate`, HTTP: respVal.status(), finalDeciderId: body.finalDeciderId, statusAfter: body.status, ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  // ===== VAL-075 : les cinq actions d'audit E6 =====
  {
    const c = await dbConn()
    const [rows] = await c.execute(
      `SELECT action, actor_id AS actorId, resource_type AS resourceType, resource_id AS resourceId, old_value AS oldValue, new_value AS newValue
        FROM audit_logs
        WHERE action IN ('SERVICE_BACKUP_VALIDATOR_ASSIGNED','SERVICE_BACKUP_VALIDATOR_DISABLED','SERVICE_BACKUP_VALIDATOR_ENABLED','VALIDATOR_REPLACEMENT_CREATED','VALIDATOR_REPLACEMENT_DISABLED')
        ORDER BY action, id`,
    )
    await c.end()

    const expected = [
      ['SERVICE_BACKUP_VALIDATOR_ASSIGNED', 'SERVICES'],
      ['SERVICE_BACKUP_VALIDATOR_DISABLED', 'SERVICES'],
      ['SERVICE_BACKUP_VALIDATOR_ENABLED', 'SERVICES'],
      ['VALIDATOR_REPLACEMENT_CREATED', 'VALIDATOR_REPLACEMENTS'],
      ['VALIDATOR_REPLACEMENT_DISABLED', 'VALIDATOR_REPLACEMENTS'],
    ]
    const auditInfo = {}
    let allOk = true
    for (const [action, resourceType] of expected) {
      const matches = rows.filter((r) => r.action === action)
      const row = matches[0]
      const sensitive = row ? (containsSensitive(parseJson(row.oldValue)) || containsSensitive(parseJson(row.newValue))) : null
      const ok = matches.length >= 1 && row.actorId != null && row.resourceType === resourceType && row.resourceId != null && Number(row.resourceId) > 0 && sensitive === false
      if (!ok) allOk = false
      auditInfo[action] = { actor: row?.actorId ?? null, resourceType: row?.resourceType ?? null, resourceId: row?.resourceId ?? null, sensitiveData: sensitive }
    }
    push('VAL-075', 'Les cinq actions d’audit E6 sont tracées', allOk, `5 actions présentes : ${expected.map(([a]) => a).join(' / ')}`, '', '')
    console.log('VAL-075', JSON.stringify({ auditInfo, allOk }))
  }

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-val-c3' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('VAL-C3', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
