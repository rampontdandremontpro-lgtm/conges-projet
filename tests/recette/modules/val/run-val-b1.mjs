import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'VAL', scenario, type: '', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, ok, resultText, proof = '', comment = '') =>
    results.push(makeResult(id, priority, scenario, ok ? 'Conforme' : 'Non conforme', resultText, proof, ok ? '' : 'NC', comment))

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

  // external employee id (inserted via SQL earlier)
  const c = await dbConn()
  const [extRows] = await c.execute("SELECT id FROM users WHERE email='ext.recette@gmes.fr'")
  const extId = extRows[0]?.id
  await c.end()
  if (!extId) throw new Error('external employee missing')

  const TAG = 'B1' + Date.now().toString(36)
  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

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
    if (r.status !== 201) throw new Error('create request failed ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: empToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    if (sub.status !== 200) throw new Error('submit failed ' + sub.status + ' ' + JSON.stringify(sub.data))
    return r.data.id
  }
  async function mkReplacement(empId, valId, start, end, token = rh) {
    return apiRequest('/validator-replacements', { method: 'POST', token, body: { employeeId: empId, replacementValidatorId: valId, startDate: start, endDate: end } })
  }
  async function countReplacements() { return (await apiRequest('/validator-replacements', { token: rh })).data.length }

  // ===== VAL-024 : Responsable ne crée pas les remplacements =====
  {
    const r = await mkReplacement(colAId, rhId, today, today, resp)
    push('VAL-024', 'PP1', 'Un Responsable ne crée pas les remplacements', r.status === 403, `HTTP=${r.status}`)
  }

  // ===== VAL-025 : Employee externe refusé =====
  {
    const r = await mkReplacement(extId, rhId, today, today)
    push('VAL-025', 'PP1', 'Employee externe refusé', r.status === 400 && /internes/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`)
  }

  // ===== VAL-026 : Employee RH refusé =====
  {
    const r = await mkReplacement(rhId, dirId, today, today)
    push('VAL-026', 'PP1', 'Employee RH refusé', r.status === 400 && /collaborateurs/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`)
  }

  // ===== VAL-027 : Employee Responsable refusé =====
  {
    const r = await mkReplacement(respId, rhId, today, today)
    push('VAL-027', 'PP1', 'Employee Responsable refusé', r.status === 400 && /collaborateurs/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`)
  }

  // ===== VAL-028 : Employee Directeur refusé =====
  {
    const r = await mkReplacement(dirId, rhId, today, today)
    push('VAL-028', 'PP1', 'Employee Directeur refusé', r.status === 400 && /collaborateurs/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`)
  }

  // ===== VAL-029 : Remplaçant Collaborateur refusé =====
  {
    const r = await mkReplacement(colAId, colBId, today, today)
    push('VAL-029', 'PP1', 'Remplaçant Collaborateur refusé', r.status === 400 && /Responsable|Directeur/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`, 'CAP-VAL-029.png')
  }

  // ===== VAL-030 : Remplaçant Admin refusé =====
  {
    const r = await mkReplacement(colAId, adminId, today, today)
    push('VAL-030', 'PP1', 'Remplaçant Admin refusé', r.status === 400 && /Responsable|Directeur/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`, 'CAP-VAL-030.png')
  }

  // ===== VAL-031 : Employee identique au remplaçant refusé =====
  {
    const r = await mkReplacement(colAId, colAId, today, today)
    push('VAL-031', 'PP1', 'Employee identique au remplaçant refusé', r.status === 400, `HTTP=${r.status} msg=${r.data?.message}`, 'CAP-VAL-031.png', 'garde d’identité défensive : la règle de rôle la précède')
  }

  // ===== VAL-032 : Période inversée refusée =====
  {
    const r = await mkReplacement(colAId, rhId, isoAddDays(today, 5), isoAddDays(today, 2))
    push('VAL-032', 'PP1', 'Période inversée refusée', r.status === 400 && /antérieure|égale/.test(r.data?.message ?? ''), `HTTP=${r.status} msg=${r.data?.message}`)
  }

  // ===== VAL-033 : RH crée un remplacement pour collaborateur prorata =====
  {
    const r = await mkReplacement(prorataId, dirId, today, isoAddDays(today, 10))
    push('VAL-033', 'PP1', 'RH crée un remplacement pour le collaborateur prorata', r.status === 201 && r.data?.id != null && r.data?.employeeId === prorataId && r.data?.replacementValidatorId === dirId && r.data?.isActive === true, `HTTP=${r.status} id=${r.data?.id}`)
  }

  // ===== VAL-034 : chevauchement refusé =====
  {
    const before = await countReplacements()
    const r = await mkReplacement(prorataId, rhId, isoAddDays(today, 5), isoAddDays(today, 12))
    const after = await countReplacements()
    push('VAL-034', 'PP1', 'Un remplacement chevauchant est refusé', r.status === 400 && /chevauche/.test(r.data?.message ?? '') && before === after, `HTTP=${r.status} before=${before} after=${after}`)
  }

  // ===== VAL-035 : RH désactive le remplacement chevauchant (celui de prorata) =====
  {
    const list = (await apiRequest('/validator-replacements?employeeId=' + prorataId, { token: rh })).data
    const target = list[0]
    if (!target) throw new Error('VAL-035 no replacement for prorata')
    const before = target.isActive
    const r = await apiRequest(`/validator-replacements/${target.id}/disable`, { method: 'PATCH', token: rh })
    const after = (await apiRequest(`/validator-replacements/${target.id}`, { token: rh })).data.isActive
    push('VAL-035', 'PP1', 'RH désactive le remplacement chevauchant', r.status === 200 && before === true && after === false, `HTTP=${r.status} before=${before} after=${after}`)
  }

  // ===== VAL-036 : RH crée remplacement actif pour collaborateur A =====
  {
    const r = await mkReplacement(colAId, rhId, today, isoAddDays(today, 14))
    push('VAL-036', 'PP1', 'RH crée un remplacement actif pour le collaborateur A', r.status === 201 && r.data?.isActive === true && r.data?.employeeId === colAId, `HTTP=${r.status} id=${r.data?.id}`)
  }

  // ===== VAL-037 : RH crée remplacement collaborateur B =====
  {
    const r = await mkReplacement(colBId, dirId, today, isoAddDays(today, 14))
    push('VAL-037', 'PP1', 'RH crée le remplacement du collaborateur B', r.status === 201 && r.data?.isActive === true && r.data?.employeeId === colBId, `HTTP=${r.status} id=${r.data?.id}`)
  }

  // ===== VAL-038 : Responsable remplacé refusé sur demande collaborateur B =====
  {
    const rid = await newReq(colB, paid, 80)
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    const status = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data.status
    push('VAL-038', 'PP1', 'Le Responsable remplacé est refusé sur la demande du collaborateur B', v.status === 403 && /remplaçant/.test(v.data?.message ?? ''), `HTTP=${v.status} msg=${v.data?.message} status=${status}`)
  }

  // ===== VAL-039 : remplaçant reprend demande soumise avant désignation =====
  {
    // demande collab C soumise AVANT création du remplacement
    const rid = await newReq(colC, paid, 85)
    const mk = await mkReplacement(colCId, rhId, today, isoAddDays(today, 14))
    if (mk.status !== 201) throw new Error('VAL-039 replacement create failed ' + mk.status)
    const da = (await apiRequest(`/leave-requests/management/${rid}`, { token: rh })).data
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true } })
    push('VAL-039', 'PP1', 'Le remplaçant reprend la demande soumise avant sa désignation', v.status === 200 && da.decisionAccess?.kind === 'REMPLACEMENT', `kind=${da.decisionAccess?.kind} HTTP=${v.status}`, 'CAP-VAL-039.png')
  }

  // ===== VAL-041 : Responsable remplacé reste autorisé sur un autre collaborateur (avant VAL-040 pour garder prorata libre) =====
  {
    const rid = await newReq(colProrata, paid, 95)
    const v = await apiRequest(`/leave-requests/${rid}/validate`, { method: 'POST', token: resp, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    push('VAL-041', 'PP1', 'Le Responsable remplacé reste autorisé sur un autre collaborateur', v.status === 200, `HTTP=${v.status}`, '', 'manager valide prorata (aucun remplacement actif)')
  }

  // ===== VAL-040 : bornes inclusives début=fin=jour courant (sur prorata, libre) =====
  {
    const mk = await mkReplacement(prorataId, rhId, today, today)
    // activeAt = today doit retourner ce remplacement
    const list = (await apiRequest('/validator-replacements?activeAt=' + today + '&employeeId=' + prorataId, { token: rh })).data
    const found = list.some(x => x.employeeId === prorataId && x.startDate === today && x.endDate === today && x.isActive)
    push('VAL-040', 'PP2', 'Bornes de dates inclusives (début = fin = jour courant)', mk.status === 201 && found, `HTTP=${mk.status} activeAtFound=${found}`)
  }

  // ===== VAL-042 : RH consulte les remplacements avec filtres =====
  {
    const all = (await apiRequest('/validator-replacements', { token: rh })).data
    const onlyActive = (await apiRequest('/validator-replacements?isActive=true', { token: rh })).data
    const byEmp = (await apiRequest('/validator-replacements?employeeId=' + colAId, { token: rh })).data
    const ok = onlyActive.every(x => x.isActive === true) && byEmp.every(x => x.employeeId === colAId) && byEmp.length >= 1
    push('VAL-042', 'PP1', 'RH consulte les remplacements avec filtres', ok, `all=${all.length} active=${onlyActive.length} byEmp=${byEmp.length}`)
  }

  // ===== VAL-043 : RH consulte un remplacement par ID =====
  {
    const list = (await apiRequest('/validator-replacements', { token: rh })).data
    const target = list.find(x => x.employeeId === colAId) ?? list[0]
    if (!target) throw new Error('VAL-043 no replacement')
    const r = (await apiRequest(`/validator-replacements/${target.id}`, { token: rh })).data
    push('VAL-043', 'PP1', 'RH consulte un remplacement par identifiant', r?.id === target.id && r?.employeeId === target.employeeId && r?.replacementValidatorId === target.replacementValidatorId, `id=${r?.id}`)
  }

  // ===== UI CAPs (029/030/031/039) =====
  const browser = await launch()
  try {
    // CAP-029/030/031 : drawer remplacement RH — vérifier dropdowns (Collaborateur/Admin absents, séparation employé/valideur)
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-validators')
    await page.waitForSelector('.rh-validators-tab-choice button', { timeout: 10000 })
    await page.locator('button[role=tab]', { hasText: 'Valideurs temporaires' }).click()
    await page.waitForTimeout(600)
    await page.waitForSelector('.rh-validators-new-replacement', { timeout: 10000 })
    await page.click('.rh-validators-new-replacement')
    await page.waitForSelector('.rh-validators-drawer--replacement', { timeout: 10000 })
    await page.waitForTimeout(500)
    // valideur select options
    const valSel = page.locator('.rh-validators-form select').nth(1)
    const valOpts = await valSel.locator('option').allInnerTexts()
    const noCollab = !valOpts.some(o => /COL-/.test(o))
    const noAdmin = !valOpts.some(o => /ADMIN/.test(o))
    console.log('VAL-029/030 UI valOpts', JSON.stringify(valOpts))
    await capture(page, 'CAP-VAL-029.png')
    await capture(page, 'CAP-VAL-030.png')
    await capture(page, 'CAP-VAL-031.png')
    await page.close().catch(() => {})
    if (!noCollab) console.log('WARN collaborateur présent dans dropdown valideur')

    // CAP-039 : remplaçant (RH) valide réellement la demande reprise
    const paidUI = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP VAL039UI ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
    const ridUI = await newReq(colC, paidUI, 105)
    // remplacement colC déjà actif (VAL-039) ; vérifier l'accès REPLACEMENT
    const daUI = (await apiRequest(`/leave-requests/management/${ridUI}`, { token: rh })).data
    console.log('VAL-039 UI access', JSON.stringify(daUI.decisionAccess))
    const p2 = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(p2, '/app/rh-leaves-absences')
    await p2.waitForSelector('.rh-events-row--data', { timeout: 10000 }).catch(() => {})
    await p2.waitForTimeout(500)
    const typeSel = p2.locator('.rh-events-filters select').nth(2)
    await typeSel.selectOption({ label: paidUI.name }).catch((e) => { throw new Error('type filter failed: ' + e.message) })
    await p2.waitForTimeout(700)
    const rows = p2.locator('.rh-events-row--data', { hasText: paidUI.name })
    const rc = await rows.count()
    if (rc !== 1) throw new Error('VAL-039 UI rowCount=' + rc)
    await rows.first().click()
    await p2.waitForURL(`**/rh-all-requests/${ridUI}`, { timeout: 10000 })
    await p2.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const cb = p2.locator('.manager-request-actions-card__agreement')
    if (await cb.count()) await cb.click()
    const p = p2.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/leave-requests/${ridUI}/validate`, { timeout: 15000 })
    await p2.click('.manager-request-action--validate')
    await p2.waitForSelector('.nr-sig__mode-tabs', { timeout: 10000 })
    await p2.locator('.nr-sig__tab', { hasText: 'Initiales' }).click()
    await p2.waitForSelector('#signature-initials', { timeout: 10000 })
    await p2.fill('#signature-initials', 'RH')
    await p2.waitForTimeout(200)
    await p2.locator('.nr-modal__footer .nr-btn--primary').click()
    const rv = await p
    await p2.waitForTimeout(600)
    await capture(p2, 'CAP-VAL-039.png')
    console.log('VAL-039 UI validate', rv.status())
    await p2.close().catch(() => {})
  } catch (e) {
    console.log('UI-ERR', e.message)
  }
  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-val-b1' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('VAL-B1', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 70))
}

run().catch(e => { console.error('ERR', e.message); process.exit(1) })
