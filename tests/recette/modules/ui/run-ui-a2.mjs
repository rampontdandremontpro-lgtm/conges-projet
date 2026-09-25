import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, isoAddDays, todayIso, utcWeekday, ensurePreuves, config } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

  const TAG = 'UI2' + Date.now().toString(36)
  const PDF_PATH = path.resolve(__dirname, '../../fixtures/justificatif-abs-recette.pdf')
  const PDF_NAME = 'justificatif-abs-recette.pdf'

  const [admin, rh] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id
  const colCId = U['col-c.recette@gmes.fr'].id
  const colProrataId = U['col-prorata.recette@gmes.fr'].id

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service UI A2 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId, colCId, colProrataId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const today = todayIso()
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }
  function distinctOpenDates(count, startOff) {
    const out = []; const seen = new Set(); let off = startOff
    while (out.length < count) { const s = openDate(off); if (!seen.has(s)) { seen.add(s); out.push(s) } off += 1 }
    return out
  }
  const D = distinctOpenDates(9, 18)

  async function newAbsenceType(label, documentRequired) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `${label} ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired, documentCanBeAddedLater: documentRequired, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })
    if (r.status !== 201) throw new Error('absence type ' + label + ' -> ' + r.status + ' ' + JSON.stringify(r.data))
    return r.data
  }
  const absCalType = await newAbsenceType('ABS-CAL', false)
  const absWaitType = await newAbsenceType('ABS-WAIT', true)
  const absAcceptType = await newAbsenceType('ABS-ACCEPT', true)
  const absRefuseType = await newAbsenceType('ABS-REFUSE', true)

  async function createAbsence(type, employeeId, start, end, comment) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId, leaveTypeId: type.id, startDate: start, endDate: end, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
    if (r.status !== 201) throw new Error('absence -> ' + r.status + ' ' + JSON.stringify(r.data))
    return r.data
  }
  async function submitAbsence(id) {
    const r = await apiRequest(`/absence-declarations/${id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    if (r.status !== 200) throw new Error('absence submit -> ' + r.status + ' ' + JSON.stringify(r.data))
    return r.data
  }
  async function uploadDoc(absenceId) {
    const buf = readFileSync(PDF_PATH)
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), PDF_NAME)
    const resp = await fetch(`${config.API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${rh}` }, body: fd })
    const data = await resp.json()
    return { status: resp.status, data }
  }
  async function getAbsence(id) { return (await apiRequest(`/absence-declarations/management/${id}`, { token: rh })).data }
  async function getDocs(id) { return (await apiRequest(`/documents/absence/${id}`, { token: rh })).data }

  const absCal = await createAbsence(absCalType, colAId, D[0], D[2], `ABS-CAL ${TAG}`)
  await submitAbsence(absCal.id)
  const absWait = await createAbsence(absWaitType, colBId, D[4], D[4], `ABS-WAIT ${TAG}`)
  await submitAbsence(absWait.id)
  const absAccept = await createAbsence(absAcceptType, colCId, D[5], D[5], `ABS-PENDING-ACCEPT ${TAG}`)
  const upAccept = await uploadDoc(absAccept.id)
  if (upAccept.status !== 201) throw new Error('upload accept -> ' + upAccept.status + ' ' + JSON.stringify(upAccept.data))
  await submitAbsence(absAccept.id)
  const absRefuse = await createAbsence(absRefuseType, colProrataId, D[6], D[6], `ABS-PENDING-REFUSE ${TAG}`)
  const upRefuse = await uploadDoc(absRefuse.id)
  if (upRefuse.status !== 201) throw new Error('upload refuse -> ' + upRefuse.status + ' ' + JSON.stringify(upRefuse.data))
  await submitAbsence(absRefuse.id)

  const docAcceptId = (await getDocs(absAccept.id))[0]?.id
  const docRefuseId = (await getDocs(absRefuse.id))[0]?.id

  const browser = await launch()

  async function openAbsenceDetail(page, typeName) {
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const row = page.locator('.rh-events-row--data', { hasText: typeName })
    await row.first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
  }
  async function clickDay(page, iso) { await page.locator(`button.nr-cal__cell[aria-label="${iso}"]`).click(); await page.waitForTimeout(250) }
  async function hoverDay(page, iso) { await page.locator(`button.nr-cal__cell[aria-label="${iso}"]`).hover(); await page.waitForTimeout(250) }
  async function readRange(page) {
    const start = (await page.locator('button.nr-cal__cell--start').first().getAttribute('aria-label')) ?? ''
    const end = (await page.locator('button.nr-cal__cell--end').first().getAttribute('aria-label')) ?? ''
    return { start, end }
  }

  // ===== UI-006 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absCalType.name)
    await page.locator('.rh-absence-button', { hasText: 'Modifier' }).click()
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    await page.waitForSelector('button.nr-cal__cell--start', { timeout: 10000 })
    const oldRange = await readRange(page)
    const newStart = D[4], hover1 = D[5], hover2 = D[6]
    await clickDay(page, newStart)
    await hoverDay(page, hover1)
    const previewH1 = await readRange(page)
    await hoverDay(page, hover2)
    const previewH2 = await readRange(page)
    await clickDay(page, hover2)
    const finalRange = await readRange(page)
    const previewFollowsMouse = previewH1.start === newStart && previewH1.end === hover1 && previewH2.start === newStart && previewH2.end === hover2 && finalRange.start === newStart && finalRange.end === hover2
    push('UI-006', 'P1', 'Aperçu de plage du calendrier suit la souris en modification', previewFollowsMouse, `oldRange=${oldRange.start}→${oldRange.end}, newStart=${newStart}, hover1=${hover1} preview=${previewH1.start}→${previewH1.end}, hover2=${hover2} preview=${previewH2.start}→${previewH2.end}, final=${finalRange.start}→${finalRange.end}, previewFollowsMouse=${previewFollowsMouse}`, '', '')
    console.log('UI-006', JSON.stringify({ oldRange, newStart, hover1, previewH1, hover2, previewH2, finalRange, previewFollowsMouse }))
    await page.locator('.rh-declaration-actions button', { hasText: 'Annuler' }).click()
    await page.waitForSelector('.rh-declaration-drawer', { state: 'detached', timeout: 10000 })
    await page.close().catch(() => {})
  }

  // ===== UI-007 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absCalType.name)
    await page.locator('.rh-absence-button', { hasText: 'Modifier' }).click()
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })
    await page.waitForSelector('button.nr-cal__cell--start', { timeout: 10000 })
    const oldRange = await readRange(page)
    const clicked = D[1], hoverDate = D[5]
    await clickDay(page, clicked)
    const selectionAfterClick = await readRange(page)
    await hoverDay(page, hoverDate)
    const previewDates = await readRange(page)
    await clickDay(page, hoverDate)
    const finalRange = await readRange(page)
    const newSelectionStarted = selectionAfterClick.start === clicked && selectionAfterClick.end === clicked && previewDates.start === clicked && previewDates.end === hoverDate && finalRange.start === clicked && finalRange.end === hoverDate
    push('UI-007', 'P1', 'Resélection depuis une date appartenant à l’ancienne plage', newSelectionStarted, `oldRange=${oldRange.start}→${oldRange.end}, clickedInsideOldRange=${clicked}, selectionStartAfterClick=${selectionAfterClick.start}, hover=${hoverDate} preview=${previewDates.start}→${previewDates.end}, final=${finalRange.start}→${finalRange.end}, newSelectionStarted=${newSelectionStarted}`, '', '')
    console.log('UI-007', JSON.stringify({ oldRange, clickedInsideOldRange: clicked, selectionStartAfterClick: selectionAfterClick.start, hoverDate, previewDates, finalRange, newSelectionStarted }))
    await page.locator('.rh-declaration-actions button', { hasText: 'Annuler' }).click()
    await page.waitForSelector('.rh-declaration-drawer', { state: 'detached', timeout: 10000 })
    await page.close().catch(() => {})
  }

  // ===== UI-008 =====
  {
    const absWaitFinal = await getAbsence(absWait.id)
    const docs = await getDocs(absWait.id)
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absWaitType.name)
    await page.waitForTimeout(200)
    const addButtonCount = await page.locator('.rh-absence-button--add').count()
    const voirCount = await page.locator('.rh-absence-button', { hasText: 'Voir le justificatif' }).count()
    const replaceCount = await page.locator('.rh-absence-button', { hasText: 'Remplacer' }).count()
    const sendCount = await page.locator('.rh-absence-add-document .rh-absence-button--primary').count()
    const otherActionCount = await page.locator('.rh-absence-documents .rh-absence-button--secondary, .rh-absence-documents .rh-absence-button--primary, .rh-absence-documents .rh-absence-button--document-accept, .rh-absence-documents .rh-absence-button--document-reject').count()
    const addBox = await page.locator('.rh-absence-button--add').boundingBox()
    const emptyBox = await page.locator('.rh-absence-documents__empty').boundingBox()
    const buttonCenterX = addBox.x + addBox.width / 2
    const cardCenterX = emptyBox.x + emptyBox.width / 2
    const deltaX = Math.abs(buttonCenterX - cardCenterX)
    const centered = deltaX <= 10
    await capture(page, 'CAP-UI-008.png')
    const ok = absWaitFinal.status === 'JUSTIFICATIF_EN_ATTENTE' && docs.length === 0 && addButtonCount === 1 && voirCount === 0 && replaceCount === 0 && sendCount === 0 && otherActionCount === 0 && centered
    push('UI-008', 'P1', 'Bouton Ajouter un justificatif centré lorsque le justificatif est attendu', ok, `absenceId=${absWait.id}, status=${absWaitFinal.status}, activeDocumentCount=${docs.length}, addButtonCount=${addButtonCount}, otherActionCount=${otherActionCount}, deltaX=${deltaX.toFixed(1)}, centered=${centered}`, 'CAP-UI-008.png', '')
    console.log('UI-008', JSON.stringify({ absenceId: absWait.id, status: absWaitFinal.status, activeDocumentCount: docs.length, addButtonCount, otherActionCount, buttonCenterX, cardCenterX, deltaX, centered }))
    await page.close().catch(() => {})
  }

  // ===== UI-009 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absWaitType.name)
    await page.waitForTimeout(200)
    await page.locator('.rh-absence-add-document input[type=file]').setInputFiles(PDF_PATH)
    await page.waitForSelector('.rh-absence-add-document__name', { timeout: 10000 })
    const filename = (await page.locator('.rh-absence-add-document__name').innerText()).trim()
    const sendVisible = await page.locator('.rh-absence-add-document .rh-absence-button--primary').count()
    const cancelVisible = await page.locator('.rh-absence-add-document .rh-absence-button--secondary').count()
    await capture(page, 'CAP-UI-009.png')
    const ok = filename === PDF_NAME && sendVisible === 1 && cancelVisible === 1
    push('UI-009', 'P1', 'Sélection d’un fichier justificatif : nom, Envoyer et Annuler', ok, `absenceId=${absWait.id}, filename=${filename}, filenameVisible=${filename.length > 0}, Envoyer=${sendVisible}, Annuler=${cancelVisible}, uploadTriggered=false`, 'CAP-UI-009.png', '')
    console.log('UI-009', JSON.stringify({ absenceId: absWait.id, filename, filenameVisible: filename.length > 0, sendVisible, cancelVisible }))
    await page.locator('.rh-absence-add-document .rh-absence-button--secondary', { hasText: 'Annuler' }).click()
    await page.waitForTimeout(200)
    await page.close().catch(() => {})
  }

  // ===== UI-010 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absAcceptType.name)
    await page.waitForTimeout(300)
    const modifyVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Modifier' }).count()
    const authorizeVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Autoriser' }).count()
    const closeVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Fermer' }).count()
    const buttons = (await page.locator('.rh-absence-detail-actions .rh-absence-button').allInnerTexts()).map((t) => t.trim())
    const ok = modifyVisible === 1 && closeVisible === 1 && authorizeVisible === 0
    push('UI-010', 'P1', 'Footer À vérifier : Modifier l’absence et Fermer regroupés à droite', ok, `absenceId=${absAccept.id}, documentStatus=EN_ATTENTE, buttons=${JSON.stringify(buttons)}, modify=${modifyVisible}, authorize=${authorizeVisible}, close=${closeVisible}, groupedRight=${modifyVisible === 1 && closeVisible === 1}`, '', '')
    console.log('UI-010', JSON.stringify({ absenceId: absAccept.id, documentStatus: 'EN_ATTENTE', buttons, modifyVisible, authorizeVisible, closeVisible }))
    await page.close().catch(() => {})
  }

  // ===== UI-013 — partie VALIDATION =====
  let validationFeedback = ''
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absAcceptType.name)
    await page.waitForSelector('.rh-absence-button--document-accept', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${docAcceptId}/accept$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--document-accept')
    const resp = await p
    await page.waitForTimeout(500)
    const docStatusAfter = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    validationFeedback = (await page.locator('.rh-events-feedback').innerText().catch(() => '')).trim()
    const ok = resp.status() === 200 && docStatusAfter === 'Validé' && validationFeedback.length > 0
    push('UI-013-valider', 'P1', 'Validation justificatif', ok, `HTTP=${resp.status()}, before=EN_ATTENTE, after=${docStatusAfter}, feedback="${validationFeedback}"`, '', '')
    console.log('UI-013-VALIDATION', JSON.stringify({ absenceId: absAccept.id, documentId: docAcceptId, HTTP: resp.status(), statusAfter: docStatusAfter, feedback: validationFeedback }))
    await page.close().catch(() => {})
  }

  // ===== UI-011 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absAcceptType.name)
    await page.waitForSelector('.rh-absence-detail-actions', { timeout: 10000 })
    await page.waitForSelector('.rh-absence-button', { hasText: 'Autoriser' }, { timeout: 10000 })
    const modifyVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Modifier' }).count()
    const authorizeVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Autoriser' }).count()
    const closeVisible = await page.locator('.rh-absence-detail-actions .rh-absence-button', { hasText: 'Fermer' }).count()
    const buttons = (await page.locator('.rh-absence-detail-actions .rh-absence-button').allInnerTexts()).map((t) => t.trim())
    const ok = modifyVisible === 1 && authorizeVisible === 1 && closeVisible === 1
    push('UI-011', 'P1', 'Footer autorisable : Modifier, Autoriser et Fermer regroupés à droite', ok, `absenceId=${absAccept.id}, documentStatus=ACCEPTE, buttons=${JSON.stringify(buttons)}, modify=${modifyVisible}, authorize=${authorizeVisible}, close=${closeVisible}, groupedRight=${ok}`, '', '')
    console.log('UI-011', JSON.stringify({ absenceId: absAccept.id, documentStatus: 'ACCEPTE', buttons, modifyVisible, authorizeVisible, closeVisible }))
    await page.close().catch(() => {})
  }

  // ===== UI-013 — partie REFUS =====
  let refusalFeedback = ''
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absRefuseType.name)
    await page.waitForSelector('.rh-absence-button--document-reject', { timeout: 10000 })
    await page.click('.rh-absence-button--document-reject')
    await page.waitForSelector('.rh-absence-document-reject-form', { timeout: 10000 })
    await page.fill('.rh-absence-document-reject-form textarea', `REFUS UI013 ${TAG}`)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${docRefuseId}/reject$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--danger', { hasText: 'Confirmer le refus' })
    const resp = await p
    await page.waitForTimeout(500)
    const docStatusAfter = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    refusalFeedback = (await page.locator('.rh-events-feedback').innerText().catch(() => '')).trim()
    const ok = resp.status() === 200 && docStatusAfter === 'Refusé' && refusalFeedback.length > 0
    push('UI-013-refuser', 'P1', 'Refus justificatif', ok, `HTTP=${resp.status()}, before=EN_ATTENTE, after=${docStatusAfter}, reason=REFUS UI013 ${TAG}, feedback="${refusalFeedback}"`, '', '')
    console.log('UI-013-REFUS', JSON.stringify({ absenceId: absRefuse.id, documentId: docRefuseId, HTTP: resp.status(), statusAfter: docStatusAfter, reason: `REFUS UI013 ${TAG}`, feedback: refusalFeedback }))
    await capture(page, 'CAP-UI-013.png')
    await page.close().catch(() => {})
  }

  // ===== UI-012 =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openAbsenceDetail(page, absRefuseType.name)
    await page.waitForSelector('.rh-absence-document-card', { timeout: 10000 })
    await page.waitForTimeout(200)
    const statusText = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const reasonText = (await page.locator('.rh-absence-document-card__reason').first().innerText()).trim()
    const viewVisible = await page.locator('.rh-absence-button', { hasText: 'Voir le justificatif' }).count()
    const replaceVisible = await page.locator('.rh-absence-button', { hasText: 'Remplacer le justificatif' }).count()
    await capture(page, 'CAP-UI-012.png')
    const ok = statusText === 'Refusé' && reasonText.includes(`REFUS UI013 ${TAG}`) && viewVisible === 1 && replaceVisible === 1
    push('UI-012', 'P1', 'Justificatif refusé : Voir et Remplacer le justificatif', ok, `absenceId=${absRefuse.id}, documentId=${docRefuseId}, status=${statusText}, reason="${reasonText}", view=${viewVisible}, replace=${replaceVisible}`, 'CAP-UI-012.png', '')
    console.log('UI-012', JSON.stringify({ absenceId: absRefuse.id, documentId: docRefuseId, rejectedVisible: statusText === 'Refusé', reason: reasonText, viewVisible, replaceVisible }))
    await page.close().catch(() => {})
  }

  await browser.close()

  const valOk = results.find((r) => r.id === 'UI-013-valider')?.status === STATUS_OK
  const refOk = results.find((r) => r.id === 'UI-013-refuser')?.status === STATUS_OK
  results.push(makeResult('UI-013', 'P1', 'Validation et refus d’un justificatif affichent un retour utilisateur', valOk && refOk ? STATUS_OK : STATUS_KO, `VALIDATION: HTTP=200 before=EN_ATTENTE after=Validé feedback="${validationFeedback}" | REFUS: HTTP=200 before=EN_ATTENTE after=Refusé reason=REFUS UI013 ${TAG} feedback="${refusalFeedback}"`, 'CAP-UI-013.png', valOk && refOk ? '' : 'NC', ''))

  const finalResults = results.filter((r) => r.id !== 'UI-013-valider' && r.id !== 'UI-013-refuser')
  finalResults.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(finalResults, { label: 'recette-results-ui-a2' })
  const st = {}
  for (const r of finalResults) st[r.status] = (st[r.status] || 0) + 1
  console.log('UI-A2', finalResults.length, JSON.stringify(st))
  for (const r of finalResults) console.log(r.id, r.status, '|', r.result.slice(0, 80))
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
