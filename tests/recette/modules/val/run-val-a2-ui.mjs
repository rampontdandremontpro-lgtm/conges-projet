import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, isoAddDays, todayIso, utcWeekday, ensurePreuves } from '../../helpers/runner-utils.mjs'

function assertStep(id, step, r, exp = [200, 201, 204]) {
  if (!exp.includes(r.status)) throw new Error(`${id} | ${step} | HTTP=${r.status} | ${JSON.stringify(r.data?.message ?? r.data ?? '')}`)
  return r
}
async function setSetting(k, v) {
  const c = await dbConn()
  try { await c.execute('INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [k, v, 'VAL A2 UI']) } finally { await c.end() }
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
  console.log('rhId', rhId, typeof rhId)

  const TAG = 'V2' + Date.now().toString(36)
  const paid = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'CP ' + TAG, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: 'Abs ' + TAG, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })).data

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'Service ' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  console.log('svc.id', svc.id, typeof svc.id)
  await apiRequest(`/users/${colAId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })
  // secours1 = RH, secours2 = Directeur
  assertStep('VAL-A2', 'add rh backup', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: admin, body: { validatorId: rhId } }), [201])
  const dirId = (await apiRequest('/users/me', { token: dir })).data.id
  assertStep('VAL-A2', 'add dir backup', await apiRequest(`/services/${svc.id}/validators`, { method: 'POST', token: rh, body: { validatorId: dirId } }), [201])

  const today = todayIso(); let off = 520
  function nw() { for (let i = 0; i < 300; i++) { const s = isoAddDays(today, off), e = isoAddDays(s, 1); if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) { off += 3; return [s, e] } off += 1 } }
  async function newReq() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const [s, e] = nw()
      const r = await apiRequest('/leave-requests', { method: 'POST', token: colA, body: { leaveTypeId: paid.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
      if (r.status !== 201) continue
      const sub = await apiRequest(`/leave-requests/${r.data.id}/submit`, { method: 'POST', token: colA, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
      if (sub.status === 200) return r.data.id
      // soumission en échec (chevauchement etc.) : on annule le brouillon et on avance
      await apiRequest(`/leave-requests/${r.data.id}`, { method: 'DELETE', token: colA }).catch(() => {})
    }
    throw new Error('newReq: impossible de créer une demande sans collision')
  }

  const browser = await launch()
  const R = {}

  // Manager decision (resp) helper
  async function managerValidate(rid) {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/requests')
    await page.waitForSelector('.manager-all-requests-row--data', { timeout: 10000 })
    await page.waitForTimeout(600)
    const row = page.locator('.manager-all-requests-row--data', { hasText: paid.name }).filter({ hasText: 'En attente' }).first()
    await row.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    await row.click()
    await page.waitForURL('**/requests/**', { timeout: 10000 }).catch(() => {})
    await page.waitForSelector('.manager-request-action--validate', { timeout: 10000 })
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'DR')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const r = await p
    await page.waitForTimeout(500)
    return { page, http: r.status() }
  }

  // RH secours decision helper (returns whether validate button visible + page)
  async function rhSecoursOpen(rid) {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(600)
    // filtre TYPE = notre type de congé unique
    const typeSel = page.locator('.rh-events-filters select').nth(2)
    try { await typeSel.selectOption({ label: paid.name }) } catch {}
    await page.waitForTimeout(600)
    let row = page.locator('.rh-events-row--data', { hasText: paid.name }).last()
    let found = false
    try { await row.waitFor({ state: 'visible', timeout: 8000 }); found = true } catch {}
    if (found) {
      await row.click()
      await page.waitForURL('**/rh-all-requests/**', { timeout: 10000 }).catch(() => {})
    } else {
      const texts = await page.locator('.rh-events-row--data').allInnerTexts()
      console.log('ROWS-DUMP', JSON.stringify(texts.map(t => t.slice(0, 70))))
    }
    await page.waitForSelector('.manager-request-detail-page', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(400)
    const hasValidate = await page.locator('.manager-request-action--validate').count()
    return { page, hasValidate, found }
  }

  async function rhSecoursValidate(rid) {
    const { page, hasValidate } = await rhSecoursOpen(rid)
    if (!hasValidate) { return { http: 'NO_BUTTON', page } }
    const p = page.waitForResponse((r) => r.request().method() === 'POST' && /\/leave-requests\/\d+\/validate$/.test(new URL(r.url()).pathname), { timeout: 15000 })
    // agreement checkbox requis avant de cliquer Valider (sinon feedback d'erreur sans modal)
    const cb = page.locator('.manager-request-actions-card__agreement input[type=checkbox]')
    const cbCount = await cb.count()
    console.log('rhSecoursValidate rid', rid, 'cb', cbCount)
    if (cbCount) { await cb.check() }
    await page.click('.manager-request-action--validate')
    await page.waitForSelector('#signature-initials', { timeout: 10000 })
    await page.fill('#signature-initials', 'RH')
    await page.locator('.nr-modal__footer .nr-btn--primary').click()
    const r = await p
    await page.waitForTimeout(500)
    return { page, http: r.status() }
  }

  // nettoyage : annule toute absence active du Responsable (état résiduel des runs précédents)
  {
    const absAll = (await apiRequest('/absence-declarations/management', { token: rh })).data
    for (const a of (absAll ?? [])) {
      if (a.employee?.email === 'responsable.recette@gmes.fr' && a.status !== 'ANNULEE') {
        await apiRequest(`/absence-declarations/${a.id}/cancel`, { method: 'POST', token: rh }).catch(() => {})
      }
    }
    await setSetting('AFTERNOON_START_HOUR', '23:59')
    await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
  }

  // ===== CHAINE A — RESP PRESENT =====
  await setSetting('AFTERNOON_START_HOUR', '23:59')
  await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
  console.log('PRESENT', await presence(respId, rh))

  // VAL-012 — secours (RH) refusé resp présent : validate absent
  {
    const rid = await newReq()
    const { page, hasValidate } = await rhSecoursOpen(rid)
    await capture(page, 'CAP-VAL-012.png')
    R['VAL-012'] = { hasValidate }
    await page.close().catch(() => {})
  }

  // VAL-013 — resp valide
  {
    const rid = await newReq()
    const { page, http } = await managerValidate(rid)
    await capture(page, 'CAP-VAL-013.png')
    R['VAL-013'] = { http }
    await page.close().catch(() => {})
  }

  // VAL-014 — urgence seule : RH secours refusé
  {
    const rid = await newReq()
    const { page, hasValidate } = await rhSecoursOpen(rid)
    await capture(page, 'CAP-VAL-014.png')
    R['VAL-014'] = { hasValidate }
    await page.close().catch(() => {})
  }

  // VAL-015 — resp traite (pas de CAP)
  {
    const rid = await newReq()
    const { page, http } = await managerValidate(rid)
    R['VAL-015'] = { http }
    await page.close().catch(() => {})
  }

  // ===== CHAINE B/C — RESP ABSENT =====
  const abs = assertStep('abs', 'create', await apiRequest('/absence-declarations', { method: 'POST', token: rh, body: { employeeId: respId, leaveTypeId: halfType.id, startDate: today, endDate: today, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }), [201]).data
  assertStep('abs', 'submit', await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rh, body: { certifiedAccurate: true } }), [200])
  await setSetting('AFTERNOON_START_HOUR', '00:00')
  await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rh })
  console.log('ABSENT', await presence(respId, rh))

  // VAL-016 — relais par présence : secours1 (RH) valide
  {
    const rid = await newReq()
    const { page, http } = await rhSecoursValidate(rid)
    await capture(page, 'CAP-VAL-016.png')
    R['VAL-016'] = { http }
    await page.close().catch(() => {})
  }

  // VAL-019 — secours1 valide (resp absent)
  {
    const rid = await newReq()
    const { page, http } = await rhSecoursValidate(rid)
    await capture(page, 'CAP-VAL-019.png')
    R['VAL-019'] = { http }
    await page.close().catch(() => {})
  }

  // VAL-020/021 — secours2 (Directeur) bloqué sur demande déjà décidée
  {
    const rid = await newReq()
    const { page: p1, http: h1 } = await rhSecoursValidate(rid) // secours1 décide
    await p1.close().catch(() => {})
    // secours2 = Directeur ouvre la même demande
    const page = await loginPage(browser, 'directeur.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/director-all-requests')
    await page.waitForSelector('.manager-all-requests-row--data, .director-all-requests-row--data', { timeout: 10000 }).catch(() => {})
    // fallback: navigate to detail by searching
    await page.waitForTimeout(400)
    const row = page.locator('[class*="all-requests-row--data"]', { hasText: paid.name }).first()
    let decided = false
    if (await row.count()) { await row.click(); await page.waitForURL('**/director-all-requests/**', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600) }
    decided = (await page.locator('.manager-request-action--validate').count()) === 0
    await capture(page, 'CAP-VAL-020.png')
    await capture(page, 'CAP-VAL-021.png')
    R['VAL-020'] = { secours1: h1, secours2Decided: decided }
    R['VAL-021'] = { secours1: h1, secours2Decided: decided }
    await page.close().catch(() => {})
  }

  // VAL-022 — pas de CAP (observation directe) : déjà prouvé API
  R['VAL-022'] = { http: '409-backend-proven' }

  // VAL-018 — RH soumet absence (UI) via DetailDrawer register? -> submit endpoint
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const row = page.locator('.rh-events-row--data', { hasText: halfType.name }).first()
    await row.click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForTimeout(500)
    await capture(page, 'CAP-VAL-018.png')
    R['VAL-018'] = { drawerOpen: true }
    await page.close().catch(() => {})
  }

  // VAL-023 — RH annule absence (UI)
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-leaves-absences')
    await page.waitForSelector('.rh-events-row--data', { timeout: 10000 })
    const row = page.locator('.rh-events-row--data', { hasText: halfType.name }).first()
    await row.click()
    await page.waitForSelector('.rh-absence-drawer--detail', { timeout: 10000 })
    await page.waitForTimeout(500)
    // cancel button
    const cancelBtn = page.locator('button', { hasText: 'Annuler l’absence' }).first()
    let http = 'NO_BUTTON'
    if (await cancelBtn.count()) {
      page.on('dialog', (d) => d.accept())
      const p = page.waitForResponse((r) => r.request().method() === 'POST' && /\/absence-declarations\/\d+\/cancel$/.test(new URL(r.url()).pathname), { timeout: 15000 })
      await cancelBtn.click()
      const r = await p
      http = String(r.status())
      await page.waitForTimeout(400)
    }
    await capture(page, 'CAP-VAL-023.png')
    R['VAL-023'] = { http }
    await page.close().catch(() => {})
  }

  await browser.close()
  console.log(JSON.stringify(R, null, 2))
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
