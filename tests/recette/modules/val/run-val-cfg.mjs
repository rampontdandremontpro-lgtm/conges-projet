import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, dbConn, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function run() {
  ensurePreuves()
  const [admin, rh, resp, colA] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('responsable.recette@gmes.fr'), login('col-a.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const respId = users.find(u => u.email === 'responsable.recette@gmes.fr').id
  const rhId = (await apiRequest('/users/me', { token: rh })).data.id

  // fixture : remettre les deux backups actifs
  const c = await dbConn()
  await c.execute('UPDATE service_backup_validators SET is_active=1 WHERE service_id=18')
  await c.end()

  // VAL-003 — droits RH vs Responsable (service frais)
  const svc3 = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:'Service VAL 003', serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false }})).data
  await apiRequest(`/services/${svc3.id}`, { method:'PATCH', token:admin, body:{ primaryManagerId: respId, validationMode:'RESPONSABLE_PUIS_RELAIS' } })
  const rhAdd = await apiRequest(`/services/${svc3.id}/validators`, { method:'POST', token:rh, body:{ validatorId: rhId } })
  const respAdd = await apiRequest(`/services/${svc3.id}/validators`, { method:'POST', token:resp, body:{ validatorId: rhId } })
  console.log('VAL-003 RH', rhAdd.status, 'Responsable', respAdd.status)

  // VAL-004 — COL-A
  const colaEndpoint = await apiRequest(`/services/${svc3.id}/validators`, { method:'POST', token:colA, body:{ validatorId: rhId } })
  console.log('VAL-004 endpoint', colaEndpoint.status)

  const browser = await launch()
  // COL-A : navigation valideurs
  const pCol = await loginPage(browser, 'col-a.recette@gmes.fr')
  await pCol.waitForTimeout(500)
  const navVal = await pCol.locator('a[href*="validators"]').count()
  await capture(pCol, 'CAP-VAL-004.png')
  console.log('VAL-004 nav links', navVal)
  await pCol.close().catch(() => {})

  // ADMIN : drawer candidats sur Service VAL UI (RH+Dir actifs)
  const page = await loginPage(browser, 'admin.recette@gmes.fr')
  await navigateViaSidebar(page, '/app/admin-validators')
  await page.evaluate(() => { window.history.pushState({}, '', '/app/admin-validators?q=Service%20VAL%20UI'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForTimeout(1000)
  const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL UI' }).first()
  await card.locator('.rh-validator-service-card__summary').click()
  await page.waitForTimeout(400)
  // VAL-011 : liste
  const txt = await card.innerText()
  const rhV = txt.includes('RH-TEST'), dirV = txt.includes('DIR-TEST')
  const rhA = /RH-TEST[\s\S]{0,80}Actif/.test(txt), dirA = /DIR-TEST[\s\S]{0,80}Actif/.test(txt)
  await capture(page, 'CAP-VAL-011.png')
  console.log('VAL-011', { rhV, dirV, rhA, dirA })
  // drawer candidats
  await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
  await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
  const opts = await page.locator('.rh-validators-form select option').allInnerTexts()
  const primaryVisible = opts.some(o => o.includes('RESP-TEST'))
  const collabVisible = opts.some(o => o.includes('COL-A') || o.includes('COL-B'))
  const rhDupVisible = opts.some(o => o.includes('RH-TEST'))
  console.log('candidates', JSON.stringify(opts))
  await capture(page, 'CAP-VAL-005.png')
  await capture(page, 'CAP-VAL-006.png')
  await capture(page, 'CAP-VAL-008.png')
  console.log('VAL-005 primaryCandidate', primaryVisible, '| VAL-006 collaboratorCandidate', collabVisible, '| VAL-008 rhDuplicate', rhDupVisible)
  await page.locator('.rh-validators-btn--secondary').click().catch(() => {})
  await page.waitForTimeout(300)

  // VAL-007 : service A2 hors circuit
  await page.evaluate(() => { window.history.pushState({}, '', '/app/admin-validators?q=Service%20VAL%20A2'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForTimeout(800)
  const card2 = page.locator('.rh-validator-service-card', { hasText: 'Service VAL A2' }).first()
  await card2.locator('.rh-validator-service-card__summary').click()
  await page.waitForTimeout(400)
  const addBtn2 = await card2.locator('button', { hasText: 'Ajouter un valideur' }).count()
  const unsupported = await card2.locator('.rh-validator-service-card__unsupported').count()
  await capture(page, 'CAP-VAL-007.png')
  console.log('VAL-007 addBtn', addBtn2, 'unsupported', unsupported)

  await browser.close()
  console.log('done')
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
