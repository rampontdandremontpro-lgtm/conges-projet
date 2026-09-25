import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const STATUS_OK = 'Conforme'
const STATUS_KO = 'Non conforme'

function makeResult(id, priority, scenario, status, resultText, proof = '', error = '', comment = '') {
  return { id, priority, module: 'UI', scenario, type: 'C - UI + API', status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment }
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, ok, resultText, proof = '', comment = '') =>
    results.push(makeResult(id, priority, scenario, ok ? STATUS_OK : STATUS_KO, resultText, proof, ok ? '' : 'NC', comment))

  const TAG = 'UI' + Date.now().toString(36)

  const [admin, rh, colA, colB, colC, colProrata] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
    login('col-c.recette@gmes.fr'),
    login('col-prorata.recette@gmes.fr'),
  ])
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service UI A1 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const colCId = U['col-c.recette@gmes.fr'].id
  const colProrataId = U['col-prorata.recette@gmes.fr'].id

  for (const uid of [respId, colAId, colBId, colCId, colProrataId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const today = todayIso()
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  // Types de congé (5) + types d'absence (4)
  const leaveTypes = []
  for (let i = 1; i <= 5; i += 1) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP UI-A1 L${i} ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })
    if (r.status !== 201) throw new Error('leave-type ' + i + ' ' + r.status)
    leaveTypes.push(r.data)
  }
  const absenceTypes = []
  for (let i = 1; i <= 4; i += 1) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `ABS UI-A1 A${i} ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })
    if (r.status !== 201) throw new Error('absence-type ' + i + ' ' + r.status)
    absenceTypes.push(r.data)
  }

  // 5 congés (col-a), soumis
  const leaveIds = []
  const leaveOffsets = [40, 41, 42, 43, 46]
  for (let i = 0; i < 5; i += 1) {
    const s = openDate(leaveOffsets[i])
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: leaveTypes[i].id, startDate: s, endDate: s, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    if (r.status !== 201) throw new Error('leave ' + i + ' -> ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    if (sub.status !== 200) throw new Error('leave submit ' + i + ' -> ' + sub.status)
    leaveIds.push(r.data.id)
  }

  // 4 absences (RH), dont A1 modifiable (col-b, 2 jours, commentaire unique)
  const absenceDefs = [
    { type: absenceTypes[0], employeeId: colBId, start: openDate(18), end: openDate(19), comment: `COMMENT UI005 ${TAG}` },
    { type: absenceTypes[1], employeeId: colAId, start: openDate(20), end: openDate(20), comment: 'ABS A2' },
    { type: absenceTypes[2], employeeId: colCId, start: openDate(21), end: openDate(21), comment: 'ABS A3' },
    { type: absenceTypes[3], employeeId: colProrataId, start: openDate(22), end: openDate(22), comment: 'ABS A4' },
  ]
  const absenceIds = []
  for (const def of absenceDefs) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: def.employeeId, leaveTypeId: def.type.id, startDate: def.start, endDate: def.end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: def.comment } })
    if (r.status !== 201) throw new Error('absence -> ' + r.status + ' ' + JSON.stringify(r.data))
    const sub = await apiRequest(`/absence-declarations/${r.data.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    if (sub.status !== 200) throw new Error('absence submit -> ' + sub.status + ' ' + JSON.stringify(sub.data))
    absenceIds.push(r.data.id)
  }

  const browser = await launch()

  async function readRows(page) {
    const rowEls = await page.locator('.rh-events-row--data').all()
    const out = []
    for (const el of rowEls) {
      out.push({
        nature: (await el.locator('.rh-events-nature').innerText()).trim(),
        type: (await el.locator('.rh-events-type').innerText()).trim(),
        status: (await el.locator('.rh-events-status').innerText()).trim(),
      })
    }
    return out
  }

  async function readTotal(page) {
    const txt = (await page.locator('.rh-events-footer > span').innerText()).trim()
    const m = txt.match(/(\d+)/)
    return m ? Number(m[1]) : null
  }

  // =====================================================================
  // UI-001
  // =====================================================================
  {
    const leaveTypeName = leaveTypes[0].name
    const absenceTypeName = absenceTypes[0].name
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })

    // congé : ouvre une page détail (pas de drawer), sans overlay
    const leaveRow = page.locator('.rh-events-row--data', { hasText: leaveTypeName })
    await leaveRow.first().click()
    await page.waitForURL('**/rh-all-requests/**', { timeout: 10000 })
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 })
    const leaveOverlayCount = await page.locator('.rh-absence-drawer--detail, .rh-declaration-drawer, .rh-declaration-backdrop, .nr-modal-backdrop').count()
    await page.click('.manager-request-back')
    await page.waitForURL('**/rh-leaves-absences**', { timeout: 10000 })
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })

    // absence : drawer détail
    const absenceRow = page.locator('.rh-events-row--data', { hasText: absenceTypeName })
    await absenceRow.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    const absenceOpenDrawerCount = await page.locator('.rh-absence-drawer--detail').count()
    const absenceOpenOtherOverlay = await page.locator('.rh-declaration-drawer, .nr-modal-backdrop').count()
    await capture(page, 'CAP-UI-001.png')
    await page.click('.rh-absence-drawer__close')
    await page.waitForSelector('.rh-absence-drawer--detail', { state: 'detached', timeout: 10000 })
    const absenceClosedDrawerCount = await page.locator('.rh-absence-drawer--detail').count()

    const overlapDetected = leaveOverlayCount !== 0 || absenceOpenDrawerCount !== 1 || absenceOpenOtherOverlay !== 0
    const ok = !overlapDetected && absenceClosedDrawerCount === 0
    push('UI-001', 'P1', 'Ouverture du détail d’une demande ou absence sans chevauchement visuel', ok, `congé id=${leaveIds[0]} (page détail, overlays=${leaveOverlayCount}), absence id=${absenceIds[0]} (drawer ouvert=${absenceOpenDrawerCount}, fermé=${absenceClosedDrawerCount}), overlapDetected=${overlapDetected}`, 'CAP-UI-001.png', '')
    console.log('UI-001', JSON.stringify({ leaveRequestId: leaveIds[0], leaveDrawerOverlays: leaveOverlayCount, absenceId: absenceIds[0], absenceDrawerOpen: absenceOpenDrawerCount, absenceDrawerClosed: absenceClosedDrawerCount, overlapDetected, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // UI-002
  // =====================================================================
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })

    const totalVisible = await readTotal(page)

    async function selectFilter(idx, label) {
      await page.locator('.rh-events-filters select').nth(idx).selectOption({ label })
      await page.waitForTimeout(450)
    }

    // Catégorie = Congés
    await selectFilter(0, 'Congés')
    let rows = await readRows(page)
    const categoryVisible = rows.length
    const categoryWrong = rows.filter((r) => r.nature !== 'Congé').length

    // Statut = En attente (retour catégorie Tous pour test statut)
    await selectFilter(0, 'Tous')
    await selectFilter(1, 'En attente')
    rows = await readRows(page)
    const statusVisible = rows.length
    const statusWrong = rows.filter((r) => r.status !== 'En attente').length

    // Type = congé L1
    await selectFilter(1, 'Tous les statuts')
    await selectFilter(2, leaveTypes[0].name)
    rows = await readRows(page)
    const typeVisible = rows.length
    const typeWrong = rows.filter((r) => !r.type.includes(leaveTypes[0].name)).length

    // Combinaison : Absences + Autorisée + ABS A1
    await selectFilter(0, 'Absences')
    await selectFilter(1, 'Autorisée')
    await selectFilter(2, absenceTypes[0].name)
    rows = await readRows(page)
    const combinedVisible = rows.length
    const combinedWrong = rows.filter((r) => r.nature !== 'Absence' || r.status !== 'Autorisée' || !r.type.includes(absenceTypes[0].name)).length

    // Réinitialiser
    await selectFilter(0, 'Tous')
    const resetVisible = await readTotal(page)

    const ok = totalVisible === 9 && categoryVisible >= 1 && categoryWrong === 0 && statusVisible >= 1 && statusWrong === 0 && typeVisible >= 1 && typeWrong === 0 && combinedVisible === 1 && combinedWrong === 0 && resetVisible === totalVisible
    push('UI-002', 'P2', 'Filtres Catégorie, Statut et Type dans Congés et Absences', ok, `total=${totalVisible}, catégorie=${categoryVisible}(wrong=${categoryWrong}), statut=${statusVisible}(wrong=${statusWrong}), type=${typeVisible}(wrong=${typeWrong}), combinaison=${combinedVisible}(wrong=${combinedWrong}), reset=${resetVisible}`, '', '')
    console.log('UI-002', JSON.stringify({ totalVisible, categoryVisible, categoryWrong, statusVisible, statusWrong, typeVisible, typeWrong, combinedVisible, combinedWrong, resetVisible, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // UI-003 — Pagination
  // =====================================================================
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })

    // pageSize observé via la range de pagination
    await page.waitForSelector('.gmes-pagination', { timeout: 10000 })
    const rangeText = (await page.locator('.gmes-pagination__range').innerText()).trim()
    const m = rangeText.match(/(\d+)\s*[–-]\s*(\d+)\s+sur\s+(\d+)/)
    const pageSizeObserved = m ? (Number(m[2]) - Number(m[1]) + 1) : null
    const totalFixtureRows = m ? Number(m[3]) : (await readRows(page)).length

    const page1Rows = await readRows(page)
    const page1Ids = page1Rows.map((r) => r.type).sort()

    await page.locator('.gmes-pagination__actions button[aria-label="Page suivante"]').click()
    await page.waitForTimeout(500)
    const page2Rows = await readRows(page)
    const page2Ids = page2Rows.map((r) => r.type).sort()
    const newIdsOnPage2 = page2Ids.filter((t) => !page1Ids.includes(t))

    await page.locator('.gmes-pagination__actions button[aria-label="Page précédente"]').click()
    await page.waitForTimeout(500)
    const backPage1Ids = (await readRows(page)).map((r) => r.type).sort()
    const backToPage1 = JSON.stringify(backPage1Ids) === JSON.stringify(page1Ids)

    // filtre qui réduit le résultat, puis vérifier pagination recalculée
    await page.locator('.rh-events-filters select').nth(2).selectOption({ label: leaveTypes[4].name })
    await page.waitForTimeout(500)
    const filteredRows = await readRows(page)
    const filteredCount = filteredRows.length
    const paginationStillThere = await page.locator('.gmes-pagination').count()
    const filteredCurrentPageText = paginationStillThere ? (await page.locator('.gmes-pagination__page').innerText()).trim() : 'n/a'
    const paginationValidAfterFilter = filteredCount === 1 && (paginationStillThere === 0 || /Page 1 \/ 1/.test(filteredCurrentPageText))

    const ok = pageSizeObserved === 8 && totalFixtureRows === 9 && page1Ids.length === 8 && page2Ids.length === 1 && newIdsOnPage2.length === 1 && backToPage1 === true && paginationValidAfterFilter === true
    push('UI-003', 'P2', 'Pagination de la liste Congés et Absences', ok, `pageSize=${pageSizeObserved}, total=${totalFixtureRows}, page1=${page1Ids.length}, page2=${page2Ids.length}, newOnPage2=${newIdsOnPage2.length}, backToPage1=${backToPage1}, filtered=${filteredCount}, paginationValidAfterFilter=${paginationValidAfterFilter}`, '', '')
    console.log('UI-003', JSON.stringify({ pageSizeObserved, totalFixtureRows, page1Ids, page2Ids, newIdsOnPage2, backToPage1, filteredCount, filteredCurrentPage: filteredCurrentPageText, paginationValidAfterFilter, ok }))
    await page.close().catch(() => {})
  }

  // =====================================================================
  // UI-004 — Modifier une absence remplace le drawer détail
  // =====================================================================
  let editDrawerPage = null
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const row = page.locator('.rh-events-row--data', { hasText: absenceTypes[0].name })
    await row.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })

    const beforeDetailCount = await page.locator('.rh-absence-drawer--detail').count()
    const beforeEditCount = await page.locator('.rh-declaration-drawer').count()

    await page.locator('.rh-absence-button', { hasText: 'Modifier' }).click()
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })

    const afterDetailCount = await page.locator('.rh-absence-drawer--detail').count()
    const afterEditCount = await page.locator('.rh-declaration-drawer').count()
    const visibleDrawerCount = afterDetailCount + afterEditCount
    const overlapDetected = visibleDrawerCount !== 1

    const ok = beforeDetailCount === 1 && beforeEditCount === 0 && afterDetailCount === 0 && afterEditCount === 1 && visibleDrawerCount === 1 && !overlapDetected
    push('UI-004', 'P1', 'Modifier une absence remplace le drawer de détail sans superposition', ok, `absenceId=${absenceIds[0]}, before detail/edit=${beforeDetailCount}/${beforeEditCount}, after detail/edit=${afterDetailCount}/${afterEditCount}, visibleDrawerCount=${visibleDrawerCount}, overlapDetected=${overlapDetected}`, '', '')
    console.log('UI-004', JSON.stringify({ absenceId: absenceIds[0], beforeDetailCount, beforeEditCount, afterDetailCount, afterEditCount, visibleDrawerCount, overlapDetected, ok }))
    editDrawerPage = page
  }

  // =====================================================================
  // UI-005 — Préremplissage du formulaire de modification
  // =====================================================================
  {
    const page = editDrawerPage
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    await page.waitForTimeout(300)

    const empSel = page.locator('.rh-declaration-top-grid select').nth(0)
    const typeSel = page.locator('.rh-declaration-top-grid select').nth(1)
    const actualEmployeeId = await empSel.inputValue()
    const actualTypeToken = await typeSel.inputValue()

    const activeUnit = await page.locator('.rh-declaration-units button.is-active').innerText()
    const startCell = page.locator('button.nr-cal__cell--start').first()
    const endCell = page.locator('button.nr-cal__cell--end').first()
    const actualStartDate = (await startCell.getAttribute('aria-label')) ?? ''
    const actualEndDate = (await endCell.getAttribute('aria-label')) ?? ''
    const actualComment = (await page.locator('.rh-declaration-field textarea').inputValue()).trim()
    const saveBtnText = (await page.locator('.rh-declaration-actions button.is-primary').innerText()).trim()
    const saveButtonVisible = /Enregistrer les modifications/.test(saveBtnText)

    const def = absenceDefs[0]
    const prefillMismatch = []
    if (actualEmployeeId !== String(def.employeeId)) prefillMismatch.push('employee')
    if (actualTypeToken !== `ABSENCE:${def.type.id}`) prefillMismatch.push('type')
    if (activeUnit !== 'Jours') prefillMismatch.push('format')
    if (actualStartDate !== def.start) prefillMismatch.push('startDate')
    if (actualEndDate !== def.end) prefillMismatch.push('endDate')
    if (actualComment !== def.comment) prefillMismatch.push('comment')
    if (!saveButtonVisible) prefillMismatch.push('saveButton')

    const ok = prefillMismatch.length === 0
    push('UI-005', 'P1', 'Préremplissage complet du formulaire de modification d’absence', ok, `employee=${actualEmployeeId} (attendu ${def.employeeId}), type=${actualTypeToken} (attendu ABSENCE:${def.type.id}), format=${activeUnit}, start=${actualStartDate} (attendu ${def.start}), end=${actualEndDate} (attendu ${def.end}), comment="${actualComment}", saveButton=${saveButtonVisible}, prefillMismatch=${JSON.stringify(prefillMismatch)}`, '', '')
    console.log('UI-005', JSON.stringify({ employeeActual: actualEmployeeId, employeeExpected: String(def.employeeId), typeActual: actualTypeToken, typeExpected: `ABSENCE:${def.type.id}`, formatActual: activeUnit, startActual: actualStartDate, startExpected: def.start, endActual: actualEndDate, endExpected: def.end, commentActual: actualComment, commentExpected: def.comment, saveButtonVisible, prefillMismatch, ok }))
    await page.close().catch(() => {})
  }

  await browser.close()

  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-ui-a1' })
  const st = {}
  for (const r of results) st[r.status] = (st[r.status] || 0) + 1
  console.log('UI-A1', results.length, JSON.stringify(st))
  for (const r of results) console.log(r.id, r.status, '|', r.result.slice(0, 90))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
