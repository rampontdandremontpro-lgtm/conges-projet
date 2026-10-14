// Parcours UI réel (Playwright) du vrai flux de dérogation GMES.
// - Collaborateur : sélection type + dates + motif -> « Signer et soumettre » direct.
// - AUCUNE étape autonome « Envoyer la demande » de dérogation.
// - RH accepte/signe via la demande de congé, responsable signe la validation finale.
// - RH refuse : la demande entière devient REFUSEE.
// Base : gestion_conges_gmes_test. Frontend de test : 5174 -> backend 3001.

import { apiRequest, config, login, loginPage, capture, navigateViaSidebar, launch, ensurePreuves, dbConn } from '../helpers/runner-utils.mjs'

const TAG = 'UI' + Date.now().toString(36)
const out = {}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let s = iso
  for (let i = 0; i < 40; i++) { if (weekday(s) >= 1 && weekday(s) <= 5) return s; s = isoAddDays(s, 1) }
  return s
}
let nearCursor = isoAddDays(todayIso(), 3)
function nextNearDate() { nearCursor = advanceToWeekday(nearCursor); const d = nearCursor; nearCursor = isoAddDays(nearCursor, 1); return d }

async function selectType(page, name) {
  await page.locator('.nr-types__pill', { hasText: name }).first().click()
}

async function selectSingleDay(page, iso) {
  const cell = page.locator(`button.nr-cal__cell[aria-label="${iso}"]:not([disabled])`).first()
  await cell.click()
  await page.waitForTimeout(200)
  await cell.click()
  await page.waitForTimeout(200)
}

async function collaboratorSignSubmit(page, initials) {
  await page.waitForSelector('.nr-review', { timeout: 15000 })
  await page.locator('.nr-review__actions .nr-btn--primary', { hasText: 'Oui, continuer' }).click()
  await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 15000 })
  await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
  await page.waitForSelector('#signature-initials', { timeout: 10000 })
  await page.fill('#signature-initials', initials)
  await page.locator('.nr-modal__footer .nr-btn--primary').click()
}

async function validatorSign(page, initials) {
  await page.waitForSelector('.nr-sig__mode-tabs', { timeout: 15000 })
  await page.locator('.nr-sig__tab', { hasText: 'Initiales' }).click().catch(() => {})
  await page.waitForSelector('#signature-initials', { timeout: 10000 })
  await page.fill('#signature-initials', initials)
  await page.locator('.nr-modal__footer .nr-btn--primary').click()
}

async function rhOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/rh-leaves-absences')
  await page.waitForSelector('.rh-events-filters', { timeout: 15000 })
  await page.locator('.rh-events-filters label', { hasText: 'STATUT' }).locator('select').selectOption({ label: 'En attente' })
  await page.locator('.rh-events-filters label', { hasText: 'TYPE' }).locator('select').selectOption({ label: typeName })
  await page.waitForSelector('.rh-events-row--data', { timeout: 15000 })
  await page.locator('.rh-events-row--data').first().click()
  await page.waitForURL('**/rh-all-requests/**', { timeout: 15000 })
}

async function respOpenRequest(page, typeName) {
  await navigateViaSidebar(page, '/app/requests')
  await page.waitForSelector('.manager-all-requests-table', { timeout: 15000 })
  const open = await page.locator('.manager-all-requests-filter-panel').count()
  if (open === 0) await page.click('.manager-all-requests-filter-button')
  await page.waitForSelector('.manager-all-requests-filter-panel', { timeout: 15000 })
  await page.locator('.manager-all-requests-filter-panel label', { hasText: 'Type de congé' }).locator('select').selectOption({ label: typeName })
  await page.waitForSelector('.manager-all-requests-row--data', { timeout: 15000 })
  await page.locator('.manager-all-requests-row--data').first().click()
  await page.waitForURL('**/requests/**', { timeout: 15000 })
}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const resp = await login('responsable.recette@gmes.fr')
  const respId = (await apiRequest('/users/me', { token: resp })).data.id

  const svcAvec = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `UI-AVEC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svcAvec.id } })
  await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const colAvec = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'UICOL', prenom: 'AVEC', email: `uicol.avec.${TAG}@recette.fr`, password: 'RecetteGMES@2026!', role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcAvec.id, hireDate: '2026-01-06' } })).data
  const { signAccessToken } = await import('../helpers/tokens.mjs')
  const colToken = signAccessToken({ id: colAvec.id, email: colAvec.email, role: 'COLLABORATEUR' })

  const typeDerog = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP UI DEROG ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  const browser = await launch()

  // ===== 1. Collaborateur : sélection -> motif -> signature -> soumission directe =====
  let reqId = null
  {
    const d = nextNearDate()
    const page = await loginPage(browser, colAvec.email, 'RecetteGMES@2026!')
    await navigateViaSidebar(page, '/app/new-request')
    await page.waitForSelector('.nr-types', { timeout: 15000 })

    await selectType(page, typeDerog.name)
    await selectSingleDay(page, d)

    await page.waitForSelector('.nr-notice--warn', { timeout: 15000 })
    await capture(page, 'CAP-DIRECTE-1-COLLAB-DEROG-NECESSAIRE.png')

    // Aucune étape autonome « Envoyer la demande » ne doit exister.
    const sendButton = await page.locator('button', { hasText: 'Envoyer la demande' }).count()
    out['no-send-step'] = sendButton === 0

    // Le champ motif est directement visible.
    await page.waitForSelector('.nr-derogation-form__textarea', { timeout: 10000 })
    await page.fill('.nr-derogation-form__textarea', 'Déplacement professionnel rapproché')

    await capture(page, 'CAP-DIRECTE-1-COLLAB-MOTIF.png')

    await page.locator('.nr-recap__actions .nr-btn--primary', { hasText: 'Signer et soumettre' }).click()
    await collaboratorSignSubmit(page, 'UI')
    await page.waitForURL('**/my-requests**', { timeout: 15000 })
    await capture(page, 'CAP-DIRECTE-1-COLLAB-SOUMIS.png')

    const req = (await apiRequest('/derogations/my', { token: colToken })).data
    const der = req.find((x) => x.reason === 'Déplacement professionnel rapproché')
    reqId = der?.leaveRequestId
    out['collab-submitted'] = Boolean(der) && der.status === 'EN_ATTENTE_RH'
    await page.close().catch(() => {})
  }

  // Vérification en base : une seule dérogation, demande soumise.
  {
    const c = await dbConn()
    const [rows] = await c.query(`SELECT lr.status AS lr_status, (SELECT COUNT(*) FROM derogations d WHERE d.leave_request_id = lr.id) AS derog_count FROM leave_requests lr WHERE lr.id = ?`, [reqId])
    await c.end()
    out['db-after-collab'] = rows[0] ?? null
  }

  // ===== 1b. RH : la page Dérogations offre « Traiter la demande » =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await navigateViaSidebar(page, '/app/rh-derogations')
    await page.waitForSelector('.rh-derogations-tabs', { timeout: 15000 })
    await page.locator('.rh-derogations-tab', { hasText: 'En attente' }).click()
    await page.waitForTimeout(600)
    // La dérogation la plus récente est en dernière page (tri demandé ASC).
    for (let i = 0; i < 12; i++) {
      const next = page.locator('.gmes-pagination button[aria-label="Page suivante"]')
      if (!(await next.isEnabled().catch(() => false))) break
      await next.click()
      await page.waitForTimeout(400)
    }
    await page.locator('.rh-derogations-row--body').last().click()
    await page.waitForSelector('.rh-derogation-decision-card', { timeout: 15000 })
    const treatButton = await page.locator('button', { hasText: 'Traiter la demande' }).count()
    out['rh-derogations-treat-button'] = treatButton >= 1
    await capture(page, 'CAP-DIRECTE-1B-RH-DEROGATIONS-TRAITER.png')
    await page.close().catch(() => {})
  }

  // ===== 2. RH : une seule demande soumise, acceptation + signature =====
  {
    const page = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(page, typeDerog.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-DIRECTE-2-RH-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RH')
    await capture(page, 'CAP-DIRECTE-2-RH-VALIDE.png')
    await page.waitForTimeout(600)
    await page.close().catch(() => {})
  }
  {
    const c = await dbConn()
    const [rows] = await c.query(`SELECT status, decided_by_rh_id FROM derogations WHERE leave_request_id = ?`, [reqId])
    await c.end()
    out['derog-after-rh'] = rows[0] ?? null
  }

  // ===== 3. Responsable : validation finale + signature =====
  {
    const page = await loginPage(browser, 'responsable.recette@gmes.fr')
    await respOpenRequest(page, typeDerog.name)
    await page.waitForSelector('.manager-request-action--validate', { timeout: 15000 })
    await capture(page, 'CAP-DIRECTE-3-RESP-ACTION.png')
    await page.click('.manager-request-action--validate')
    await validatorSign(page, 'RS')
    await capture(page, 'CAP-DIRECTE-3-RESP-VALIDE.png')
    await page.waitForTimeout(600)
    await page.close().catch(() => {})
  }
  {
    const c = await dbConn()
    const [rows] = await c.query(`SELECT status, final_decider_role FROM leave_requests WHERE id = ?`, [reqId])
    await c.end()
    out['lr-after-resp'] = rows[0] ?? null
  }

  // ===== 4. Refus RH via l'interface : la demande entière devient REFUSEE =====
  let refuseReqId = null
  {
    const d = nextNearDate()
    const draft = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: typeDerog.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    refuseReqId = draft.id

    // Soumission réelle par le collaborateur (signature à l'écran).
    const page = await loginPage(browser, colAvec.email, 'RecetteGMES@2026!')
    await navigateViaSidebar(page, '/app/my-requests')
    await page.waitForSelector('.my-request-card', { timeout: 15000 })
    await page.locator('.my-request-card', { hasText: typeDerog.name }).first().click()
    await page.waitForURL('**/new-request/**', { timeout: 15000 })
    await page.waitForSelector('.nr-recap__actions', { timeout: 15000 })
    await page.locator('.nr-recap__actions .nr-btn--primary', { hasText: 'Signer et soumettre' }).click()
    await collaboratorSignSubmit(page, 'UI')
    await page.waitForURL('**/my-requests**', { timeout: 15000 })
    await page.close().catch(() => {})

    // Refus RH via l'interface.
    const pageRh = await loginPage(browser, 'rh.recette@gmes.fr')
    await rhOpenRequest(pageRh, typeDerog.name)
    await pageRh.waitForSelector('.manager-request-action--refuse', { timeout: 15000 })
    await capture(pageRh, 'CAP-DIRECTE-4-RH-REFUS-ACTION.png')
    await pageRh.click('.manager-request-action--refuse')
    await pageRh.waitForSelector('.manager-decision-modal', { timeout: 15000 })
    await pageRh.fill('#manager-refusal-comment', 'Période impossible pour le service')
    await pageRh.locator('.manager-decision-btn--danger', { hasText: 'Confirmer le refus' }).click()
    await pageRh.waitForTimeout(800)
    await capture(pageRh, 'CAP-DIRECTE-4-RH-REFUS-CONFIRME.png')
    await pageRh.close().catch(() => {})
  }
  {
    const c = await dbConn()
    const [rows] = await c.query(`SELECT lr.status AS lr_status, d.status AS der_status FROM leave_requests lr LEFT JOIN derogations d ON d.leave_request_id = lr.id WHERE lr.id = ?`, [refuseReqId])
    await c.end()
    out['db-after-refus'] = rows[0] ?? null
  }

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
