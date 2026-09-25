import { apiRequest, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves } from '../../helpers/runner-utils.mjs'

async function run() {
  ensurePreuves()
  const [admin, rh] = await Promise.all([login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr')])
  const users = (await apiRequest('/users', { token: rh })).data
  const resp = users.find(u => u.email === 'responsable.recette@gmes.fr')
  // service UI dédié zéro secours
  const svc = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:'Service VAL UI', serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false }})).data
  await apiRequest(`/services/${svc.id}`, { method:'PATCH', token:admin, body:{ primaryManagerId: resp.id, validationMode:'RESPONSABLE_PUIS_RELAIS' } })

  const browser = await launch()
  const page = await loginPage(browser, 'admin.recette@gmes.fr')
  await navigateViaSidebar(page, '/app/admin-validators')
  await page.waitForTimeout(800)
  const card = page.locator('.rh-validator-service-card', { hasText: 'Service VAL UI' }).first()
  await card.locator('.rh-validator-service-card__summary').click()
  await page.waitForTimeout(400)
  await capture(page, 'CAP-VAL-001.png')

  async function addValidator(optionText, capFile, expectOk = true) {
    await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
    await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
    const sel = page.locator('.rh-validators-form select')
    const opts = await sel.locator('option').allInnerTexts()
    const match = opts.find(o => o.includes(optionText))
    if (!match) { await capture(page, capFile); await page.locator('.rh-validators-btn--secondary').click().catch(()=>{}); return { ok:false, options:opts } }
    await sel.selectOption({ label: match })
    const respPromise = page.waitForResponse((r) => r.request().method()==='POST' && /\/services\/\d+\/validators$/.test(new URL(r.url()).pathname), { timeout: 8000 }).catch(()=>null)
    await page.locator('.rh-validators-btn--primary').click()
    const r = await respPromise
    await page.waitForTimeout(600)
    await capture(page, capFile)
    return { ok: r ? r.status()===201 : false, status: r ? r.status() : null }
  }

  // VAL-002 : ajouter RH
  const a2 = await addValidator('RH-TEST', 'CAP-VAL-002.png')
  console.log('VAL-002', JSON.stringify(a2))
  // VAL-003 : ajouter Directeur
  const a3 = await addValidator('DIR-TEST', 'CAP-VAL-003.png')
  console.log('VAL-003', JSON.stringify(a3))
  // VAL-008 : doublon — rouvrir drawer, RH ne doit plus être candidat
  await card.locator('button', { hasText: 'Ajouter un valideur' }).click()
  await page.waitForSelector('.rh-validators-form select', { timeout: 8000 })
  const sel8 = page.locator('.rh-validators-form select')
  const opts8 = await sel8.locator('option').allInnerTexts()
  const dupVisible = opts8.some(o => o.includes('RH-TEST'))
  console.log('VAL-008 duplicateCandidateVisible=' + dupVisible)
  await capture(page, 'CAP-VAL-008.png')
  await page.locator('.rh-validators-btn--secondary').click().catch(()=>{})
  await page.waitForTimeout(300)
  // VAL-009 : désactiver RH
  const rowRh = card.locator('.rh-validator-backup-row', { hasText: 'RH-TEST' }).first()
  const disPromise = page.waitForResponse((r) => r.request().method()==='PATCH' && /\/validators\/\d+\/disable$/.test(new URL(r.url()).pathname), { timeout: 8000 }).catch(()=>null)
  await rowRh.locator('.rh-validator-toggle-action--disable').click()
  const dis = await disPromise
  await page.waitForTimeout(500)
  await capture(page, 'CAP-VAL-009.png')
  console.log('VAL-009', dis ? dis.status() : 'no-patch')
  // VAL-010 : réactiver RH
  const enPromise = page.waitForResponse((r) => r.request().method()==='PATCH' && /\/validators\/\d+\/enable$/.test(new URL(r.url()).pathname), { timeout: 8000 }).catch(()=>null)
  await rowRh.locator('.rh-validator-toggle-action--enable').click()
  const en = await enPromise
  await page.waitForTimeout(500)
  await capture(page, 'CAP-VAL-010.png')
  console.log('VAL-010', en ? en.status() : 'no-patch')
  // VAL-011 : deux secours actifs visibles
  const body11 = await card.innerText()
  const rhVisible = body11.includes('RH-TEST')
  const dirVisible = body11.includes('DIR-TEST')
  const rhActif = /RH-TEST[\s\S]*?Actif/.test(body11)
  const dirActif = /DIR-TEST[\s\S]*?Actif/.test(body11)
  console.log('VAL-011', { rhVisible, dirVisible, rhActif, dirActif })
  await capture(page, 'CAP-VAL-011.png')

  await browser.close()
  console.log('done')
}
run().catch(e => { console.error('ERR', e.message); process.exit(1) })
