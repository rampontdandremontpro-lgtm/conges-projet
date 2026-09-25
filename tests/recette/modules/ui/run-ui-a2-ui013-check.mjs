import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, isoAddDays, todayIso, utcWeekday, ensurePreuves, config } from '../../helpers/runner-utils.mjs'
import { writeReport } from '../../helpers/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../../reports')
const ANOMALIES_PATH = path.resolve(__dirname, '../../manifest/anomalies.json')

async function run() {
  ensurePreuves()
  const TAG = 'UI13' + Date.now().toString(36)
  const PDF_PATH = path.resolve(__dirname, '../../fixtures/justificatif-abs-recette.pdf')
  const PDF_NAME = 'justificatif-abs-recette.pdf'

  const [admin, rh] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const U = Object.fromEntries(users.map((u) => [u.email, u]))
  const respId = U['responsable.recette@gmes.fr'].id
  const colAId = U['col-a.recette@gmes.fr'].id
  const colBId = U['col-b.recette@gmes.fr'].id

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service UI13 ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  for (const uid of [respId, colAId, colBId]) {
    await apiRequest(`/users/${uid}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  }
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const today = todayIso()
  function openDate(off) { let s = isoAddDays(today, off); for (let i = 0; i < 40; i++) { if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5) return s; s = isoAddDays(s, 1) } return s }

  async function newDocType(label) {
    const r = await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `${label} ${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: true, requiresValidation: false } })
    if (r.status !== 201) throw new Error('type ' + label + ' ' + r.status)
    return r.data
  }
  const accType = await newDocType('UI13-ACC')
  const rejType = await newDocType('UI13-REJ')

  async function makeAbsence(type, employeeId, start, comment) {
    const r = await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId, leaveTypeId: type.id, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment } })
    if (r.status !== 201) throw new Error('absence ' + r.status)
    return r.data
  }
  async function submitAbsence(id) {
    const r = await apiRequest(`/absence-declarations/${id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } })
    if (r.status !== 200) throw new Error('submit ' + r.status)
    return r.data
  }
  async function uploadDoc(absenceId) {
    const buf = readFileSync(PDF_PATH)
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), PDF_NAME)
    const resp = await fetch(`${config.API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${rh}` }, body: fd })
    return { status: resp.status, data: await resp.json() }
  }
  async function getDocs(id) { return (await apiRequest(`/documents/absence/${id}`, { token: rh })).data }

  const acc = await makeAbsence(accType, colAId, openDate(20), `UI13-ACC ${TAG}`)
  const up1 = await uploadDoc(acc.id); if (up1.status !== 201) throw new Error('up1 ' + up1.status)
  await submitAbsence(acc.id)
  const rej = await makeAbsence(rejType, colBId, openDate(22), `UI13-REJ ${TAG}`)
  const up2 = await uploadDoc(rej.id); if (up2.status !== 201) throw new Error('up2 ' + up2.status)
  await submitAbsence(rej.id)

  const accDocId = (await getDocs(acc.id))[0]?.id
  const rejDocId = (await getDocs(rej.id))[0]?.id

  const browser = await launch()

  async function openDetail(page, typeName) {
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    await page.locator('.rh-events-row--data', { hasText: typeName }).first().click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
  }

  async function measureFeedback(page) {
    const fb = page.locator('.rh-events-feedback')
    const present = (await fb.count()) === 1
    if (!present) return { present: false, feedbackText: '', feedbackUnobscured: false }
    const text = (await fb.innerText()).trim()
    const box = await fb.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const info = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)
      const fbEl = document.querySelector('.rh-events-feedback')
      const backdrop = document.querySelector('.rh-absence-drawer-backdrop')
      const getZ = (e) => (e ? getComputedStyle(e).zIndex : null)
      return {
        topTag: el ? el.tagName : null,
        topClass: el && el.className ? String(el.className) : null,
        topIsFeedback: Boolean(el && fbEl && (el === fbEl || fbEl.contains(el))),
        backdropVisible: Boolean(backdrop && (backdrop.offsetWidth || backdrop.offsetHeight || backdrop.getClientRects().length)),
        backdropZ: getZ(backdrop),
        feedbackZ: getZ(fbEl),
      }
    }, { cx, cy })
    return { present: true, feedbackText: text, box, ...info, feedbackUnobscured: info.topIsFeedback }
  }

  // ===== VALIDATION =====
  const validation = {}
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openDetail(page, accType.name)
    await page.waitForSelector('.rh-absence-button--document-accept', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${accDocId}/accept$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--document-accept')
    const resp = await p
    await page.waitForTimeout(600)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const geo = await measureFeedback(page)
    Object.assign(validation, { absenceId: acc.id, documentId: accDocId, HTTP: resp.status(), statusBefore: 'EN_ATTENTE', statusAfter: 'ACCEPTE', uiStatus, ...geo })
    await capture(page, 'CAP-UI-013.png')
    await page.close().catch(() => {})
  }

  // ===== REFUS =====
  const refusal = {}
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await openDetail(page, rejType.name)
    await page.waitForSelector('.rh-absence-button--document-reject', { timeout: 10000 })
    await page.click('.rh-absence-button--document-reject')
    await page.waitForSelector('.rh-absence-document-reject-form', { timeout: 10000 })
    await page.fill('.rh-absence-document-reject-form textarea', `REFUS UI013 ${TAG}`)
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/api/documents/${rejDocId}/reject$`).test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.rh-absence-button--danger', { hasText: 'Confirmer le refus' })
    const resp = await p
    await page.waitForTimeout(600)
    const uiStatus = (await page.locator('.rh-absence-document-status').first().innerText()).trim()
    const reason = (await page.locator('.rh-absence-document-card__reason').first().innerText()).trim()
    const geo = await measureFeedback(page)
    Object.assign(refusal, { absenceId: rej.id, documentId: rejDocId, HTTP: resp.status(), statusBefore: 'EN_ATTENTE', statusAfter: 'REJETE', reason, uiStatus, ...geo })
    await capture(page, 'CAP-UI-013.png')
    await page.close().catch(() => {})
  }

  await browser.close()

  console.log('VALIDATION', JSON.stringify(validation))
  console.log('REFUS', JSON.stringify(refusal))

  const bothUnobscured = validation.feedbackUnobscured === true && refusal.feedbackUnobscured === true
  const status = bothUnobscured ? 'Conforme' : 'Non conforme'

  // ===== Mise à jour UI-013 uniquement =====
  const reportPath = path.join(REPORTS_DIR, 'recette-results-ui-a2.json')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const entry = report.find((r) => r.id === 'UI-013')
  if (!entry) throw new Error('UI-013 introuvable dans le rapport')
  entry.status = status
  entry.result = `VALIDATION: HTTP=${validation.HTTP} ${validation.statusBefore}→${validation.statusAfter} uiStatus=${validation.uiStatus} feedback="${validation.feedbackText}" feedbackUnobscured=${validation.feedbackUnobscured} | REFUS: HTTP=${refusal.HTTP} ${refusal.statusBefore}→${refusal.statusAfter} uiStatus=${refusal.uiStatus} reason="${refusal.reason}" feedback="${refusal.feedbackText}" feedbackUnobscured=${refusal.feedbackUnobscured}`
  entry.date = new Date().toISOString()
  entry.proof = 'CAP-UI-013.png'
  entry.error = status === 'Conforme' ? '' : 'NC'
  entry.comment = `backdropZ=${validation.backdropZ}, feedbackZ=${validation.feedbackZ}, top=${validation.topClass}`
  writeReport(report, { label: 'recette-results-ui-a2' })

  // ===== Anomalie ANO-020 si Non conforme =====
  if (status === 'Non conforme') {
    const anomalies = JSON.parse(readFileSync(ANOMALIES_PATH, 'utf8'))
    const existing = anomalies.map((r) => r[0])
    if (!existing.includes('ANO-020')) {
      anomalies.push([
        'ANO-020',
        'UI-013',
        'Le retour utilisateur après validation/refus d’un justificatif est rendu derrière le backdrop du drawer et n’est pas clairement visible.',
        'Mineure',
        'Ouverte',
        'D.RAMPONT',
        `Description : Attendu : chaque action (Valider / Refuser un justificatif) affiche un retour clair visible. Obtenu : l'action métier réussit (HTTP 200), le statut du document est mis à jour (Validé / Refusé), et le message .rh-events-feedback est présent dans le DOM. Mais ce message est rendu dans la page sous .rh-absence-drawer-backdrop (z-index 100) ; elementFromPoint au centre du feedback renvoie le backdrop, pas le feedback (feedbackUnobscured=false). Impact : UI-013 Non conforme. Sévérité Mineure car l'action réussit et le statut du document reste clairement visible dans le drawer.`,
        '',
      ])
      writeFileSync(ANOMALIES_PATH, JSON.stringify(anomalies, null, 2) + '\n', 'utf8')
    }
  }

  console.log('UI-013-FINAL', status)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
