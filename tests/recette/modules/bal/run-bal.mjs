import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../../helpers/api.mjs'
import { config } from '../../helpers/config.mjs'
import { writeReport, STATUS } from '../../helpers/report.mjs'
import { setupBalancesFixture, readEmployeeBalancesAsRh, loginRecette, BALANCE_FIXTURE } from '../../fixtures/balances.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES_DIR = path.resolve(__dirname, '../../preuves')

function result({ id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '', duration }) {
  const module = id.split('-')[0]
  return {
    id,
    priority,
    module,
    scenario,
    type,
    status,
    result: resultText,
    date: new Date().toISOString(),
    duration: `${duration ?? 0} ms`,
    proof,
    error,
    comment,
  }
}

async function loginPage(browser, email, password) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  return page
}

async function capture(page, fileName) {
  const filePath = path.join(PREUVES_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  return fileName
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []

  console.log('Préparation fixture BAL...')
  const fixture = await setupBalancesFixture()

  const rhLogin = await loginRecette(BALANCE_FIXTURE.rh.email, BALANCE_FIXTURE.rh.password)
  const rhToken = rhLogin.accessToken
  const colALogin = await loginRecette(BALANCE_FIXTURE.colA.email, BALANCE_FIXTURE.colA.password)
  const colAToken = colALogin.accessToken
  const colBLogin = await loginRecette(BALANCE_FIXTURE.colB.email, BALANCE_FIXTURE.colB.password)
  const colBToken = colBLogin.accessToken

  const browser = await chromium.launch({ headless: true })

  // ===== BAL-001 =====
  {
    const start = Date.now()
    try {
      const page = await loginPage(browser, BALANCE_FIXTURE.colA.email, BALANCE_FIXTURE.colA.password)
      await page.waitForSelector('.dash-card--leave-balance', { timeout: 10000 })
      const selectedPeriod = await page.locator('.balance-card-period-select select').inputValue().catch(() => '')
      const kpiStrongs = page.locator('.balance-period-kpi strong')
      const prisUI = (await kpiStrongs.nth(0).innerText().catch(() => '')).trim()
      const attenteUI = (await kpiStrongs.nth(1).innerText().catch(() => '')).trim()
      const valideesUI = (await kpiStrongs.nth(2).innerText().catch(() => '')).trim()
      const proof = await capture(page, 'CAP-BAL-001.png')
      await page.close()

      const summary = await apiRequest('/leave-balances/my/summary', { token: colAToken })
      const summaries = Array.isArray(summary.data) ? summary.data : []
      const match = summaries.find((s) => s.referencePeriod === selectedPeriod) ?? summaries[0]
      const prisAPI = `${match?.takenDays ?? ''} j`
      const attenteAPI = `${match?.pendingDays ?? ''} j`
      const valideesAPI = `${match?.validatedDays ?? ''} j`
      const ok = summary.status === 200 && summaries.length === 3 && prisUI === prisAPI && attenteUI === attenteAPI && valideesUI === valideesAPI
      results.push(result({
        id: 'BAL-001',
        priority: 'P1',
        scenario: 'Collaborateur consulte ses propres soldes',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `Période=${selectedPeriod || match?.referencePeriod} | Pris UI=${prisUI} API=${prisAPI} | En attente UI=${attenteUI} API=${attenteAPI} | Validées UI=${valideesUI} API=${valideesAPI}`,
        proof,
        error: ok ? '' : 'Les valeurs UI ne correspondent pas à l\'API.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      results.push(result({ id: 'BAL-001', priority: 'P1', scenario: 'Collaborateur consulte ses propres soldes', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== BAL-002 =====
  {
    const start = Date.now()
    try {
      const page = await loginPage(browser, BALANCE_FIXTURE.rh.email, BALANCE_FIXTURE.rh.password)
      await page.click('a[href="/app/rh-balances"]')
      await page.waitForSelector('.rh-balances-row--body', { timeout: 10000 })

      // Filtrer sur COL-A si un filtre employé existe.
      const employeeFilter = page.locator('.rh-balances-filters select').first()
      if ((await employeeFilter.count()) > 0) {
        await employeeFilter.selectOption({ label: 'COL-A Recette' }).catch(() => {})
      }

      const row = page.locator('.rh-balances-row--body', { hasText: 'COL-A Recette' })
      const rowVisible = (await row.count()) > 0
      const acquiredUI = (await row.locator(':scope > strong').nth(0).innerText().catch(() => '')).trim()
      const takenUI = (await row.locator(':scope > span').nth(1).innerText().catch(() => '')).trim()
      const balanceUI = (await row.locator(':scope > strong').nth(1).innerText().catch(() => '')).trim()
      const validatedUI = (await row.locator(':scope > span').nth(2).innerText().catch(() => '')).trim()
      const pendingUI = (await row.locator(':scope > span').nth(3).innerText().catch(() => '')).trim()
      const periodUI = await page.locator('.rh-balances-filters select').nth(2).inputValue().catch(() => '')
      const proof = await capture(page, 'CAP-BAL-002.png')
      await page.close()

      const mgmt = await apiRequest(`/leave-balances/management?referencePeriod=${encodeURIComponent(periodUI)}`, { token: rhToken })
      const apiRow = (Array.isArray(mgmt.data) ? mgmt.data : []).find((r) => r?.employee?.id === fixture.colA.id)
      const periodAPI = apiRow?.referencePeriod ?? periodUI
      const acquiredAPI = `${apiRow?.acquiredDays ?? ''} j`
      const takenAPI = `${apiRow?.takenDays ?? ''} j`
      const balanceAPI = `${apiRow?.balanceDays ?? ''} j`
      const validatedAPI = `${apiRow?.validatedDays ?? ''} j`
      const pendingAPI = `${apiRow?.pendingDays ?? ''} j`

      const ok = rowVisible && mgmt.status === 200 && acquiredUI === acquiredAPI && takenUI === takenAPI && balanceUI === balanceAPI && validatedUI === validatedAPI && pendingUI === pendingAPI
      results.push(result({
        id: 'BAL-002',
        priority: 'P1',
        scenario: 'RH consulte le solde d’un collaborateur',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `Période=${periodAPI} | Acquis UI=${acquiredUI} API=${acquiredAPI} | Pris UI=${takenUI} API=${takenAPI} | Solde UI=${balanceUI} API=${balanceAPI} | Validées UI=${validatedUI} API=${validatedAPI} | En attente UI=${pendingUI} API=${pendingAPI}`,
        proof,
        error: ok ? '' : 'Les valeurs UI ne correspondent pas à l\'API management.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      results.push(result({ id: 'BAL-002', priority: 'P1', scenario: 'RH consulte le solde d’un collaborateur', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ===== BAL-003 =====
  {
    const start = Date.now()
    // API
    const apiAccess = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: colBToken })
    const apiDenied = apiAccess.status === 403 || apiAccess.status === 401
    const apiNoLeak = !Array.isArray(apiAccess.data)

    // UI
    let uiHasRhBalancesLink = false
    try {
      const page = await loginPage(browser, BALANCE_FIXTURE.colB.email, BALANCE_FIXTURE.colB.password)
      uiHasRhBalancesLink = (await page.locator('a[href="/app/rh-balances"]').count()) > 0
      await page.close()
    } catch {
      uiHasRhBalancesLink = false
    }

    const ok = apiDenied && apiNoLeak && !uiHasRhBalancesLink
    results.push(result({
      id: 'BAL-003',
      priority: 'P1',
      scenario: 'Autre collaborateur ne consulte pas le solde nominatif',
      type: 'C - UI + API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: ok
        ? `API refusée (HTTP ${apiAccess.status}), aucun accès UI à "Soldes collaborateurs".`
        : `api=${apiAccess.status}/${JSON.stringify(apiAccess.data)}, uiLink=${uiHasRhBalancesLink}`,
      error: ok ? '' : 'Protection incomplète.',
      comment: `Demandeur=${fixture.colB.email}, cible=${fixture.colA.email}`,
      duration: Date.now() - start,
    }))
  }

  // ===== BAL-004 à BAL-006 =====
  const employeeBalances = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: rhToken })
  const nBalance = (Array.isArray(employeeBalances.data) ? employeeBalances.data : []).find((b) => b.counterType === 'N')
  const balanceId = nBalance?.id

  const historyBeforeAll = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
  const historyBefore = Array.isArray(historyBeforeAll.data) ? historyBeforeAll.data : []

  // BAL-004 — acquisition manuelle
  if (balanceId) {
    const start = Date.now()
    const before = nBalance
    const add = await apiRequest(`/leave-balances/${balanceId}/accrual`, {
      method: 'POST',
      token: rhToken,
      body: { accrualMonth: '2026-08', days: 3, reason: 'Acquisition manuelle recette BAL-004.' },
    })
    const after = add.data
    const historyAfterAll = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
    const historyAfter = Array.isArray(historyAfterAll.data) ? historyAfterAll.data : []
    const beforeIds = new Set(historyBefore.map((m) => m.id))
    const newMoves = historyAfter.filter((m) => !beforeIds.has(m.id))
    const movement = newMoves.find((m) => m.movementType === 'ACQUISITION' && m.leaveBalanceId === balanceId && Number(m.days) === 3)

    const statusOk = add.status === 200 || add.status === 201
    const acquiredOk = Number(after?.acquiredDays) === Number(before.acquiredDays) + 3
    const availableOk = Number(after?.availableDays) === Number(before.availableDays) + 3
    const reservedOk = Number(after?.reservedDays) === Number(before.reservedDays)
    const consumedOk = Number(after?.consumedDays) === Number(before.consumedDays)
    const movementOk = Boolean(movement)
    const ok = statusOk && acquiredOk && availableOk && reservedOk && consumedOk && movementOk

    results.push(result({
      id: 'BAL-004',
      priority: 'P2',
      scenario: 'RH ajoute une acquisition manuelle',
      type: 'B - API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: `balanceId=${balanceId} | avant acquis=${before.acquiredDays}, dispo=${before.availableDays}, réservé=${before.reservedDays}, consommé=${before.consumedDays} | après acquis=${after?.acquiredDays}, dispo=${after?.availableDays}, réservé=${after?.reservedDays}, consommé=${after?.consumedDays} | movement=${movement ? 'ACQUISITION 3j' : 'introuvable'}`,
      error: ok ? '' : 'Acquisition manuelle non conforme.',
      comment: `Mouvement exact : ${movement ? `id=${movement.id}, type=${movement.movementType}, days=${movement.days}, reason=${movement.reason}` : 'aucun'}`,
      duration: Date.now() - start,
    }))
    console.log(`BAL-004 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
  } else {
    results.push(result({ id: 'BAL-004', priority: 'P2', scenario: 'RH ajoute une acquisition manuelle', type: 'B - API', status: STATUS.BLOQUE, resultText: 'Solde N de COL-A introuvable.', error: 'Fixture incomplète.', duration: 0 }))
  }

  const historyBeforeIds = new Set(historyBefore.map((m) => m.id))

  // BAL-005 — correction positive UI
  if (balanceId) {
    const start = Date.now()
    let page
    try {
      const beforeAllFresh = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: rhToken })
      const before = (Array.isArray(beforeAllFresh.data) ? beforeAllFresh.data : []).find((b) => b.id === balanceId)
      const histBeforeFresh = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
      const historyBeforeIdsFresh = new Set((Array.isArray(histBeforeFresh.data) ? histBeforeFresh.data : []).map((m) => m.id))

      page = await loginPage(browser, BALANCE_FIXTURE.rh.email, BALANCE_FIXTURE.rh.password)
      await page.click('a[href="/app/rh-balances"]')
      await page.waitForSelector('.rh-balances-row--body', { timeout: 10000 })
      const row = page.locator('.rh-balances-row--body', { hasText: 'COL-A Recette' })
      await row.click()
      await page.waitForSelector('.rh-balances-drawer', { timeout: 10000 })
      await page.click('.rh-balances-correction-btn')
      await page.waitForSelector('.rh-balances-correction', { timeout: 10000 })

      const form = page.locator('.rh-balances-correction')
      const periodSelect = form.locator('select').first()
      await periodSelect.selectOption('2026-2027').catch(() => {})
      const daysInput = form.locator('input[type="number"]')
      await daysInput.fill('5')
      await form.locator('textarea').fill('Correction positive recette BAL-005.')

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/leave-balances\/\d+\/correction$/.test(new URL(response.url()).pathname.replace(/^\/api/, '')),
        { timeout: 10000 },
      )
      await form.locator('button[type="submit"]').click()
      const response = await responsePromise
      const request = response.request()
      const payload = request.postDataJSON()
      const http = response.status()

      const proof = await capture(page, 'CAP-BAL-005.png')
      await page.close()

      const afterAll = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: rhToken })
      const after = (Array.isArray(afterAll.data) ? afterAll.data : []).find((b) => b.id === balanceId)

      const histAfter = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
      const newMoves = (Array.isArray(histAfter.data) ? histAfter.data : []).filter((m) => !historyBeforeIdsFresh.has(m.id))
      const movement = newMoves.find((m) => m.movementType === 'CORRECTION_POSITIVE' && m.leaveBalanceId === balanceId && Number(m.days) === 5 && m.reason === 'Correction positive recette BAL-005.')

      const httpOk = http === 200 || http === 201
      const payloadOk = Number(payload?.days) === 5 && payload?.reason === 'Correction positive recette BAL-005.'
      const acquiredOk = Number(after?.acquiredDays) === Number(before.acquiredDays) + 5
      const availableOk = Number(after?.availableDays) === Number(before.availableDays) + 5
      const reservedOk = Number(after?.reservedDays) === Number(before.reservedDays)
      const consumedOk = Number(after?.consumedDays) === Number(before.consumedDays)
      const movementOk = Boolean(movement)
      const ok = httpOk && payloadOk && acquiredOk && availableOk && reservedOk && consumedOk && movementOk

      results.push(result({
        id: 'BAL-005',
        priority: 'P2',
        scenario: 'RH applique une correction positive',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI POST ${http}, balanceId=${balanceId}, days=${payload?.days} | avant acquis=${before.acquiredDays}, dispo=${before.availableDays} | après acquis=${after?.acquiredDays}, dispo=${after?.availableDays} | movement=${movement ? 'CORRECTION_POSITIVE 5j' : 'introuvable'}`,
        proof,
        error: ok ? '' : 'Correction positive UI/API non conforme.',
        comment: `Mouvement exact : ${movement ? `id=${movement.id}, type=${movement.movementType}, days=${movement.days}, reason=${movement.reason}` : 'aucun'}`,
        duration: Date.now() - start,
      }))
      console.log(`BAL-005 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      if (page) await page.close().catch(() => {})
      results.push(result({ id: 'BAL-005', priority: 'P2', scenario: 'RH applique une correction positive', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    results.push(result({ id: 'BAL-005', priority: 'P2', scenario: 'RH applique une correction positive', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: 'Solde N de COL-A introuvable.', error: 'Fixture incomplète.', duration: 0 }))
  }

  // BAL-006 — correction nulle refusée UI + backend
  if (balanceId) {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, BALANCE_FIXTURE.rh.email, BALANCE_FIXTURE.rh.password)
      await page.click('a[href="/app/rh-balances"]')
      await page.waitForSelector('.rh-balances-row--body', { timeout: 10000 })
      await page.locator('.rh-balances-row--body', { hasText: 'COL-A Recette' }).click()
      await page.waitForSelector('.rh-balances-drawer', { timeout: 10000 })
      await page.click('.rh-balances-correction-btn')
      await page.waitForSelector('.rh-balances-correction', { timeout: 10000 })

      const form = page.locator('.rh-balances-correction')
      const periodSelect = form.locator('select').first()
      await periodSelect.selectOption('2026-2027').catch(() => {})
      const daysInput = form.locator('input[type="number"]')
      await daysInput.fill('0')
      await form.locator('textarea').fill('Correction nulle recette BAL-006.')

      const validation = await daysInput.evaluate((el) => ({
        value: el.value,
        valid: el.validity.valid,
        rangeUnderflow: el.validity.rangeUnderflow,
        validationMessage: el.validationMessage,
        min: el.min,
      }))

      let correctionPostCount = 0
      const requestListener = (request) => {
        if (
          request.method() === 'POST' &&
          /\/leave-balances\/\d+\/correction$/.test(new URL(request.url()).pathname.replace(/^\/api/, ''))
        ) {
          correctionPostCount += 1
        }
      }
      page.on('request', requestListener)
      await form.locator('button[type="submit"]').click()
      await page.waitForTimeout(500)
      page.off('request', requestListener)

      const proof = await capture(page, 'CAP-BAL-006.png')
      await page.close()

      // Contrôle backend direct
      const beforeAll = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: rhToken })
      const before = (Array.isArray(beforeAll.data) ? beforeAll.data : []).find((b) => b.id === balanceId)
      const histBefore = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
      const beforeIds = new Set((Array.isArray(histBefore.data) ? histBefore.data : []).map((m) => m.id))

      const corr = await apiRequest(`/leave-balances/${balanceId}/correction`, {
        method: 'POST',
        token: rhToken,
        body: { days: 0, reason: 'Correction nulle recette BAL-006.', notifyEmployee: false },
      })
      const afterAll = await apiRequest(`/leave-balances/employee/${fixture.colA.id}`, { token: rhToken })
      const after = (Array.isArray(afterAll.data) ? afterAll.data : []).find((b) => b.id === balanceId)
      const histAfter = await apiRequest(`/leave-balances/employee/${fixture.colA.id}/history`, { token: rhToken })
      const afterIds = new Set((Array.isArray(histAfter.data) ? histAfter.data : []).map((m) => m.id))

      const backendStatusOk = corr.status === 400
      const actualMessage = String(corr.data?.message ?? '').normalize('NFC').trim()
      const expectedMessage = 'La correction ne peut pas être égale à zéro.'.normalize('NFC')
      const backendMessageOk = actualMessage === expectedMessage
      const acquiredSame = Number(before?.acquiredDays) === Number(after?.acquiredDays)
      const availableSame = Number(before?.availableDays) === Number(after?.availableDays)
      const reservedSame = Number(before?.reservedDays) === Number(after?.reservedDays)
      const consumedSame = Number(before?.consumedDays) === Number(after?.consumedDays)
      const idsSame = beforeIds.size === afterIds.size && [...beforeIds].every((id) => afterIds.has(id))

      const uiInvalid = validation.valid === false && validation.rangeUnderflow === true
      const uiPostCountOk = correctionPostCount === 0
      const ok = uiInvalid && uiPostCountOk && backendStatusOk && backendMessageOk && acquiredSame && availableSame && reservedSame && consumedSame && idsSame

      results.push(result({
        id: 'BAL-006',
        priority: 'P1',
        scenario: 'Correction nulle refusée',
        type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `UI valid=${validation.valid}, rangeUnderflow=${validation.rangeUnderflow}, message=${validation.validationMessage}, POST UI=${correctionPostCount} | backend HTTP ${corr.status}, message=${corr.data?.message} | avant acquis=${before?.acquiredDays}, dispo=${before?.availableDays} | après acquis=${after?.acquiredDays}, dispo=${after?.availableDays} | mouvements ${beforeIds.size}→${afterIds.size}`,
        proof,
        error: ok ? '' : 'Correction nulle non refusée proprement.',
        duration: Date.now() - start,
      }))
      console.log(`BAL-006 ${ok ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      if (page) await page.close().catch(() => {})
      results.push(result({ id: 'BAL-006', priority: 'P1', scenario: 'Correction nulle refusée', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    results.push(result({ id: 'BAL-006', priority: 'P1', scenario: 'Correction nulle refusée', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: 'Solde N de COL-A introuvable.', error: 'Fixture incomplète.', duration: 0 }))
  }

  // ===== BAL-007 & BAL-008 — acquisition mensuelle (API) =====
  const targetMonth = '2026-08'
  const accrualReferencePeriod = '2026-2027'
  const expectedMonthlyReason = 'Acquisition mensuelle d’août 2026 : +2,5 jours'
  const monthlyRate = 2.5

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colC = users.find((u) => u.email === 'col-c.recette@gmes.fr')
  const colCId = colC?.id

  if (!colCId) {
    results.push(result({ id: 'BAL-007', priority: 'P2', scenario: 'RH lance l’acquisition du mois terminé', type: 'B - API', status: STATUS.BLOQUE, resultText: 'COL-C introuvable.', error: 'Fixture incomplète.', duration: 0 }))
    results.push(result({ id: 'BAL-008', priority: 'P2', scenario: 'L’acquisition mensuelle est idempotente', type: 'B - API', status: STATUS.BLOQUE, resultText: 'COL-C introuvable.', error: 'Fixture incomplète.', duration: 0 }))
  } else {
    // Initialiser le compteur N 2026-2027 de COL-C à 0 (aucun mouvement créé par l'initialisation).
    await apiRequest('/leave-balances/initialize', {
      method: 'POST',
      token: rhToken,
      body: {
        employeeId: colCId,
        referencePeriod: accrualReferencePeriod,
        counterType: 'N',
        acquiredDays: 0,
        reason: 'Fixture recette BAL-007 — compteur témoin.',
      },
    }).catch(() => ({ status: 0, data: null }))

    const colCBalances = await apiRequest(`/leave-balances/employee/${colCId}`, { token: rhToken })
    const colCList = Array.isArray(colCBalances.data) ? colCBalances.data : []
    const witnessBalance = colCList.find((b) => b.counterType === 'N' && b.referencePeriod === accrualReferencePeriod)
    const balanceId = witnessBalance?.id

    if (!balanceId) {
      results.push(result({ id: 'BAL-007', priority: 'P2', scenario: 'RH lance l’acquisition du mois terminé', type: 'B - API', status: STATUS.BLOQUE, resultText: 'Compteur N 2026-2027 de COL-C introuvable.', error: 'Fixture incomplète.', duration: 0 }))
      results.push(result({ id: 'BAL-008', priority: 'P2', scenario: 'L’acquisition mensuelle est idempotente', type: 'B - API', status: STATUS.BLOQUE, resultText: 'Compteur N 2026-2027 de COL-C introuvable.', error: 'Fixture incomplète.', duration: 0 }))
    } else {
      const eligible = users.filter((u) =>
        u.role !== 'ADMIN' &&
        u.isActive !== false &&
        u.hireDate &&
        u.hireDate <= '2026-08-01',
      )

      // Snapshot global minimal avant BAL-007 (détection de crédits parasites / doubles).
      const globalBefore = {}
      for (const u of eligible) {
        const balResp = await apiRequest(`/leave-balances/employee/${u.id}`, { token: rhToken })
        const histResp = await apiRequest(`/leave-balances/employee/${u.id}/history`, { token: rhToken })
        const balances = Array.isArray(balResp.data) ? balResp.data : []
        const nBal = balances.find((b) => b.counterType === 'N' && b.referencePeriod === accrualReferencePeriod)
        const hist = Array.isArray(histResp.data) ? histResp.data : []
        globalBefore[u.id] = {
          email: u.email,
          balanceId: nBal?.id ?? null,
          acquiredDays: Number(nBal?.acquiredDays ?? 0),
          availableDays: Number(nBal?.availableDays ?? 0),
          reservedDays: Number(nBal?.reservedDays ?? 0),
          consumedDays: Number(nBal?.consumedDays ?? 0),
          movementIds: new Set(hist.map((m) => m.id)),
          monthAcqCount: hist.filter((m) => m.movementType === 'ACQUISITION' && String(m.reason ?? '').includes('août 2026')).length,
        }
      }

      const witnessBefore = globalBefore[colCId]
      const balanceBeforeAcquired = witnessBefore.acquiredDays
      const balanceBeforeAvailable = witnessBefore.availableDays
      const reservedBefore = witnessBefore.reservedDays
      const consumedBefore = witnessBefore.consumedDays

      // BAL-007 — premier lancement.
      const start7 = Date.now()
      const run1 = await apiRequest('/leave-balances/accrual/run', {
        method: 'POST',
        token: rhToken,
        body: { accrualMonth: targetMonth },
      })
      const run1Status = run1.status
      const run1Data = run1.data

      const after1BalResp = await apiRequest(`/leave-balances/employee/${colCId}`, { token: rhToken })
      const after1Bal = (Array.isArray(after1BalResp.data) ? after1BalResp.data : []).find((b) => b.id === balanceId)
      const after1HistResp = await apiRequest(`/leave-balances/employee/${colCId}/history`, { token: rhToken })
      const after1Hist = Array.isArray(after1HistResp.data) ? after1HistResp.data : []
      const newMoves1 = after1Hist.filter((m) => !witnessBefore.movementIds.has(m.id))
      const movement = newMoves1.find((m) =>
        m.movementType === 'ACQUISITION' &&
        m.leaveBalanceId === balanceId &&
        Number(m.days) === monthlyRate &&
        m.reason === expectedMonthlyReason &&
        Number(m.employeeId) === Number(colCId),
      )

      const expectedAcquired = balanceBeforeAcquired + monthlyRate
      const expectedAvailable = balanceBeforeAvailable + monthlyRate
      const run1StatusOk = run1Status === 200 || run1Status === 201
      const acquiredOk = Number(after1Bal?.acquiredDays) === expectedAcquired
      const availableOk = Number(after1Bal?.availableDays) === expectedAvailable
      const reservedOk = Number(after1Bal?.reservedDays) === reservedBefore
      const consumedOk = Number(after1Bal?.consumedDays) === consumedBefore
      const movementExact = movement
        ? Number(movement.balanceBefore) === balanceBeforeAvailable &&
          Number(movement.balanceAfter) === balanceBeforeAvailable + monthlyRate &&
          Number(movement.days) === monthlyRate &&
          movement.movementType === 'ACQUISITION' &&
          movement.leaveBalanceId === balanceId &&
          movement.reason === expectedMonthlyReason &&
          Number(movement.employeeId) === Number(colCId)
        : false
      const creditedEntry = (Array.isArray(run1Data?.creditedEmployees) ? run1Data.creditedEmployees : []).find((e) => Number(e.employeeId) === Number(colCId))
      const creditedOk = Boolean(creditedEntry) && creditedEntry.movementId === movement?.id

      // Contrôle global : chaque collaborateur éligible reçoit exactement +2,5 j une seule fois.
      let globalParasite = false
      for (const u of eligible) {
        const before = globalBefore[u.id]
        const balResp = await apiRequest(`/leave-balances/employee/${u.id}`, { token: rhToken })
        const histResp = await apiRequest(`/leave-balances/employee/${u.id}/history`, { token: rhToken })
        const balances = Array.isArray(balResp.data) ? balResp.data : []
        const nBal = balances.find((b) => b.counterType === 'N' && b.referencePeriod === accrualReferencePeriod)
        const hist = Array.isArray(histResp.data) ? histResp.data : []
        const newMonthAcq = hist.filter((m) => m.movementType === 'ACQUISITION' && String(m.reason ?? '').includes('août 2026')).length
        if (
          newMonthAcq !== before.monthAcqCount + 1 ||
          Number(nBal?.acquiredDays ?? 0) !== before.acquiredDays + monthlyRate ||
          Number(nBal?.availableDays ?? 0) !== before.availableDays + monthlyRate ||
          Number(nBal?.reservedDays ?? 0) !== before.reservedDays ||
          Number(nBal?.consumedDays ?? 0) !== before.consumedDays
        ) {
          globalParasite = true
        }
      }

      const ok7 = run1StatusOk && acquiredOk && availableOk && reservedOk && consumedOk && movementExact && creditedOk && !globalParasite

      results.push(result({
        id: 'BAL-007',
        priority: 'P2',
        scenario: 'RH lance l’acquisition du mois terminé',
        type: 'B - API',
        status: ok7 ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `targetMonth=${targetMonth}, HTTP=${run1Status}, balanceId=${balanceId} | avant acquis=${balanceBeforeAcquired}, dispo=${balanceBeforeAvailable} | après acquis=${after1Bal?.acquiredDays}, dispo=${after1Bal?.availableDays} | movement=${movement ? `ACQUISITION ${movement.days}j` : 'introuvable'}`,
        error: ok7 ? '' : 'Acquisition mensuelle non conforme.',
        comment: `Mouvement exact : ${movement ? `id=${movement.id}, type=${movement.movementType}, days=${movement.days}, reason=${movement.reason}, balanceBefore=${movement.balanceBefore}, balanceAfter=${movement.balanceAfter}, employeeId=${movement.employeeId}, createdAt=${movement.createdAt}` : 'aucun'}`,
        duration: Date.now() - start7,
      }))
      console.log(`BAL-007 ${ok7 ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)

      // BAL-008 — idempotence globale du second lancement (snapshot après BAL-007).
      const start8 = Date.now()
      const snapshotEligible = async () => {
        const map = {}
        for (const u of eligible) {
          const balResp = await apiRequest(`/leave-balances/employee/${u.id}`, { token: rhToken })
          const histResp = await apiRequest(`/leave-balances/employee/${u.id}/history`, { token: rhToken })
          const balances = Array.isArray(balResp.data) ? balResp.data : []
          const nBal = balances.find((b) => b.counterType === 'N' && b.referencePeriod === accrualReferencePeriod)
          const hist = Array.isArray(histResp.data) ? histResp.data : []
          map[u.id] = {
            employeeId: u.id,
            balanceId: nBal?.id ?? null,
            acquiredDays: Number(nBal?.acquiredDays ?? 0),
            availableDays: Number(nBal?.availableDays ?? 0),
            reservedDays: Number(nBal?.reservedDays ?? 0),
            consumedDays: Number(nBal?.consumedDays ?? 0),
            movementIds: hist.map((m) => m.id).sort((a, b) => Number(a) - Number(b)),
            monthAcqCount: hist.filter((m) => m.movementType === 'ACQUISITION' && String(m.reason ?? '').includes('août 2026')).length,
          }
        }
        return map
      }

      const before2 = await snapshotEligible()
      const before2ColC = before2[colCId]

      const run2 = await apiRequest('/leave-balances/accrual/run', {
        method: 'POST',
        token: rhToken,
        body: { accrualMonth: targetMonth },
      })
      const run2Status = run2.status
      const run2Data = run2.data

      const after2 = await snapshotEligible()
      const after2ColC = after2[colCId]

      const run2StatusOk = run2Status === 200 || run2Status === 201
      const creditedEmployees = Array.isArray(run2Data?.creditedEmployees) ? run2Data.creditedEmployees : []
      const alreadyCreditedEmployees = Array.isArray(run2Data?.alreadyCreditedEmployees) ? run2Data.alreadyCreditedEmployees : []
      const creditedEmpty2 = creditedEmployees.length === 0

      const eligibleIds = eligible.map((u) => Number(u.id)).sort((a, b) => a - b)
      const alreadyCreditedIds = alreadyCreditedEmployees.map((e) => Number(e.employeeId)).sort((a, b) => a - b)
      const allEligibleAlreadyCredited = eligibleIds.every((id) => alreadyCreditedIds.includes(id))
      const alreadyCountMatches = alreadyCreditedEmployees.length === eligible.length

      // Vérification globale : solde et mouvements identiques avant/après pour chaque éligible.
      let balancesGloballyUnchanged = true
      let movementIdsGloballyUnchanged = true
      let monthAcqGloballyUnchanged = true
      for (const u of eligible) {
        const b = before2[u.id]
        const a = after2[u.id]
        if (!a || a.balanceId !== b.balanceId ||
            a.acquiredDays !== b.acquiredDays ||
            a.availableDays !== b.availableDays ||
            a.reservedDays !== b.reservedDays ||
            a.consumedDays !== b.consumedDays) {
          balancesGloballyUnchanged = false
        }
        const aIds = new Set(a.movementIds)
        if (a.movementIds.length !== b.movementIds.length || b.movementIds.some((id) => !aIds.has(id))) {
          movementIdsGloballyUnchanged = false
        }
        if (a.monthAcqCount !== b.monthAcqCount) {
          monthAcqGloballyUnchanged = false
        }
      }

      const noDoubleCredit = balancesGloballyUnchanged && movementIdsGloballyUnchanged && monthAcqGloballyUnchanged
      const ok8 = run2StatusOk && creditedEmpty2 && allEligibleAlreadyCredited && alreadyCountMatches && noDoubleCredit

      results.push(result({
        id: 'BAL-008',
        priority: 'P2',
        scenario: 'L’acquisition mensuelle est idempotente',
        type: 'B - API',
        status: ok8 ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `2e run HTTP=${run2Status} | eligible=${eligible.length}, alreadyCredited=${alreadyCreditedEmployees.length}, credited=${creditedEmployees.length} | COL-C acquis ${before2ColC.acquiredDays}→${after2ColC.acquiredDays}, dispo ${before2ColC.availableDays}→${after2ColC.availableDays} | mouvements ${before2ColC.movementIds.length}→${after2ColC.movementIds.length} | acquisitions mois ${before2ColC.monthAcqCount}→${after2ColC.monthAcqCount}`,
        error: ok8 ? '' : 'Idempotence globale non garantie.',
        comment: `eligible=${eligible.length}, alreadyCredited=${alreadyCreditedEmployees.length}, credited=${creditedEmployees.length}, balancesGloballyUnchanged=${balancesGloballyUnchanged}, movementIdsGloballyUnchanged=${movementIdsGloballyUnchanged}, doubleAcquisition=${noDoubleCredit ? 'non' : 'oui'}`,
        duration: Date.now() - start8,
      }))
      console.log(`BAL-008 ${ok8 ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    }
  }

  // ===== BAL-009 — prorata automatique arrivée/départ (B - API) =====
  {
    const start9 = Date.now()
    try {
      const adminLogin = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email: 'admin.recette@gmes.fr', password: 'RecetteGMES@2026!' },
      })
      const adminToken = adminLogin.data?.accessToken

      const usersAll9 = await apiRequest('/users', { token: rhToken })
      const users9 = Array.isArray(usersAll9.data) ? usersAll9.data : []
      const colProrata = users9.find((u) => u.email === 'col-prorata.recette@gmes.fr')
      const colProrataId = colProrata?.id

      if (!adminToken || !colProrataId) {
        throw new Error('Fixture BAL-009 incomplète (admin ou COL-PRORATA introuvable).')
      }

      // Service INTERNE dédié pour permettre la mise à jour API de COL-PRORATA.
      const svc = await apiRequest('/services', {
        method: 'POST',
        token: adminToken,
        body: { name: 'Service BAL-009 prorata', serviceType: 'INTERNE' },
      })
      let serviceId = svc.data?.id
      if (!serviceId) {
        const svcList = await apiRequest('/services', { token: adminToken })
        const list = Array.isArray(svcList.data) ? svcList.data : []
        serviceId = list.find((s) => s.name === 'Service BAL-009 prorata')?.id
      }
      if (!serviceId) {
        throw new Error(`Création service BAL-009 échouée (HTTP ${svc.status}).`)
      }

      // Arrivée en cours de mois : hireDate = 2026-07-16 (milieu de juillet 2026).
      const hirePatch = await apiRequest(`/users/${colProrataId}`, {
        method: 'PATCH',
        token: rhToken,
        body: { hireDate: '2026-07-16', serviceId },
      })

      // Snapshot avant acquisition de juillet.
      const balBefore = await apiRequest(`/leave-balances/employee/${colProrataId}`, { token: rhToken })
      const balancesBefore = Array.isArray(balBefore.data) ? balBefore.data : []
      const nBefore = balancesBefore.find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
      const balanceIdP = nBefore?.id
      const histBefore = await apiRequest(`/leave-balances/employee/${colProrataId}/history`, { token: rhToken })
      const histBeforeList = Array.isArray(histBefore.data) ? histBefore.data : []
      const beforeIds = new Set(histBeforeList.map((m) => m.id))

      // Lancement réel de l'acquisition du mois de juillet 2026.
      const run = await apiRequest('/leave-balances/accrual/run', {
        method: 'POST',
        token: rhToken,
        body: { accrualMonth: '2026-07' },
      })
      const runStatus = run.status
      const runData = run.data

      const credited = Array.isArray(runData?.creditedEmployees) ? runData.creditedEmployees : []
      const manualReview = Array.isArray(runData?.manualReviewRequired) ? runData.manualReviewRequired : []
      const creditedProrata = credited.some((e) => Number(e.employeeId) === Number(colProrataId))
      const manualReviewProrata = manualReview.some((e) => Number(e.employeeId) === Number(colProrataId))

      // Relecture après.
      const balAfter = await apiRequest(`/leave-balances/employee/${colProrataId}`, { token: rhToken })
      const balancesAfter = Array.isArray(balAfter.data) ? balAfter.data : []
      const nAfter = balancesAfter.find((b) => b.id === balanceIdP)
      const histAfter = await apiRequest(`/leave-balances/employee/${colProrataId}/history`, { token: rhToken })
      const histAfterList = Array.isArray(histAfter.data) ? histAfter.data : []
      const newMoves = histAfterList.filter((m) => !beforeIds.has(m.id))

      const acquiredSame = Number(nBefore?.acquiredDays ?? 0) === Number(nAfter?.acquiredDays ?? 0)
      const availableSame = Number(nBefore?.availableDays ?? 0) === Number(nAfter?.availableDays ?? 0)
      const noNewMovement = newMoves.length === 0
      const arrivalOk = !creditedProrata && manualReviewProrata && acquiredSame && availableSame && noNewMovement

      // Départ : le modèle users n'a pas de champ date de sortie (exitDate).
      const userOne = await apiRequest(`/users/${colProrataId}`, { token: rhToken })
      const userObj = userOne.data
      const hasExitDateField = typeof userObj === 'object' && userObj !== null && 'exitDate' in userObj
      const exitPatch = await apiRequest(`/users/${colProrataId}`, {
        method: 'PATCH',
        token: rhToken,
        body: { exitDate: '2026-07-16' },
      })
      const exitRejected = exitPatch.status === 400
      const departureNotModeled = !hasExitDateField && exitRejected

      const currentBehaviorOk = hirePatch.status === 200 && (runStatus === 200 || runStatus === 201) && arrivalOk && departureNotModeled

      results.push(result({
        id: 'BAL-009',
        priority: 'P2',
        scenario: 'Prorata automatique arrivée/départ',
        type: 'B - API',
        status: STATUS.BLOQUE,
        resultText: `arrivée hireDate=2026-07-16 run=2026-07 HTTP=${runStatus} credited=${creditedProrata} manualReview=${manualReviewProrata} newMoves=${newMoves.length} | départ exitDate modélisé=${hasExitDateField} PATCH exitDate HTTP=${exitPatch.status} | règle prorata non finalisée → Bloqué`,
        error: 'Règle fonctionnelle du prorata non finalisée : arbitrage fonctionnel requis.',
        comment: `Comportement actuel documenté=${currentBehaviorOk} : arrivée en cours de mois → manualReviewRequired sans crédit automatique ; départ non modélisable (absence de date de fin de contrat). Décision fonctionnelle requise : 1) prorata arrivée ? 2) base calendaire/ouvrée/autre ? 3) arrondi ? 4) traitement départ ? 5) ajout date de sortie au User ? 6) automatique ou contrôle RH ?`,
        duration: Date.now() - start9,
      }))
      console.log(`BAL-009 BLOQUÉ — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'BAL-009', priority: 'P2', scenario: 'Prorata automatique arrivée/départ', type: 'B - API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start9 }))
    }
  }

  // ===== BAL-010 — Tous les rôles consultent les types actifs (C - UI + API) =====
  {
    const start10 = Date.now()
    const activeName = 'BAL-010 Actif'
    const inactiveName = 'BAL-010 Inactif'
    try {
      const roleLogin = async (email) => {
        const r = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email, password: 'RecetteGMES@2026!' },
        })
        if (!r.data?.accessToken) throw new Error(`Login impossible pour ${email}`)
        return r.data.accessToken
      }

      const adminToken = await roleLogin('admin.recette@gmes.fr')

      const typePayload = (name) => ({
        name,
        category: 'DEMANDE_CONGE',
        deductsPaidLeaveBalance: false,
        documentRequired: false,
        documentCanBeAddedLater: false,
        employeeCanCreate: true,
        rhOnly: false,
        allowsDays: true,
        allowsHalfDays: true,
        allowsHours: false,
        requiresValidation: false,
      })

      const createActive = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: typePayload(activeName) })
      const activeTypeId = createActive.data?.id
      const createInactive = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: typePayload(inactiveName) })
      const inactiveTypeId = createInactive.data?.id
      if (inactiveTypeId) {
        await apiRequest(`/leave-types/${inactiveTypeId}/disable`, { method: 'PATCH', token: adminToken })
      }
      if (!activeTypeId || !inactiveTypeId) {
        throw new Error('Fixture BAL-010 incomplète (création des types actif/inactif).')
      }

      // Référence : management contient les deux, le endpoint public n'expose que l'actif.
      const mgmt = await apiRequest('/leave-types/management', { token: adminToken })
      const mgmtList = Array.isArray(mgmt.data) ? mgmt.data : []
      const mgmtHasActive = mgmtList.some((t) => t.id === activeTypeId)
      const mgmtHasInactive = mgmtList.some((t) => t.id === inactiveTypeId)

      const roleDefs = [
        ['ADMIN', 'admin.recette@gmes.fr'],
        ['RH', 'rh.recette@gmes.fr'],
        ['DIRECTEUR', 'directeur.recette@gmes.fr'],
        ['RESPONSABLE_SERVICE', 'responsable.recette@gmes.fr'],
        ['COLLABORATEUR', 'col-a.recette@gmes.fr'],
      ]

      // API : chaque rôle consulte GET /leave-types (types actifs).
      const apiResults = {}
      for (const [roleId, email] of roleDefs) {
        const token = await roleLogin(email)
        const res = await apiRequest('/leave-types', { token })
        const list = Array.isArray(res.data) ? res.data : []
        apiResults[roleId] = {
          http: res.status,
          activeVisible: list.some((t) => t.id === activeTypeId),
          inactiveVisible: list.some((t) => t.id === inactiveTypeId),
        }
      }

      const uiResults = {}
      const uiActiveOnly = async (locator, route) => {
        const options = await locator.allInnerTexts()
        const activeVisible = options.some((t) => String(t).trim() === activeName)
        const inactiveVisible = options.some((t) => String(t).trim() === inactiveName)
        return { route, activeVisible, inactiveVisible, options: options.map((t) => String(t).trim()).filter(Boolean) }
      }

      // ADMIN
      {
        const page = await loginPage(browser, 'admin.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/admin-leave-types"]')
        await page.waitForSelector('.rh-leave-types-card', { timeout: 10000 })
        await page.locator('.rh-leave-types-filters select').nth(1).selectOption('active')
        await page.waitForTimeout(400)
        uiResults.ADMIN = await uiActiveOnly(page.locator('.rh-leave-types-row--body .rh-leave-types-name strong'), '/app/admin-leave-types')
        await capture(page, 'CAP-BAL-010-ADMIN.png')
        await page.close()
      }

      // RH
      {
        const page = await loginPage(browser, 'rh.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/rh-leave-types"]')
        await page.waitForSelector('.rh-leave-types-card', { timeout: 10000 })
        await page.locator('.rh-leave-types-filters select').nth(1).selectOption('active')
        await page.waitForTimeout(400)
        uiResults.RH = await uiActiveOnly(page.locator('.rh-leave-types-row--body .rh-leave-types-name strong'), '/app/rh-leave-types')
        await capture(page, 'CAP-BAL-010-RH.png')
        await page.close()
      }

      // DIRECTEUR
      {
        const page = await loginPage(browser, 'directeur.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/director-statistics"]')
        const typeSelect = page.locator('select').filter({ has: page.locator('option[value="ALL"]') }).first()
        await typeSelect.waitFor({ timeout: 10000 })
        await typeSelect.locator('option', { hasText: activeName }).waitFor({ state: 'attached', timeout: 15000 })
        uiResults.DIRECTEUR = await uiActiveOnly(typeSelect.locator('option'), '/app/director-statistics')
        await capture(page, 'CAP-BAL-010-DIR.png')
        await page.close()
      }

      // RESPONSABLE_SERVICE
      {
        const page = await loginPage(browser, 'responsable.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/requests"]')
        await page.waitForSelector('.manager-all-requests-card', { timeout: 10000 })
        await page.click('.manager-all-requests-filter-button')
        await page.waitForSelector('.manager-all-requests-filter-panel', { timeout: 10000 })
        uiResults.RESPONSABLE_SERVICE = await uiActiveOnly(page.locator('.manager-all-requests-filter-panel select').first().locator('option'), '/app/requests')
        await capture(page, 'CAP-BAL-010-RESP.png')
        await page.close()
      }

      // COLLABORATEUR
      {
        const page = await loginPage(browser, 'col-a.recette@gmes.fr', 'RecetteGMES@2026!')
        await page.click('a[href="/app/new-request"]')
        await page.waitForSelector('.nr-types__pill, .nr-types-empty', { timeout: 10000 })
        uiResults.COLLABORATEUR = await uiActiveOnly(page.locator('.nr-types__pill'), '/app/new-request')
        await capture(page, 'CAP-BAL-010-COL.png')
        await page.close()
      }

      const apiAllOk = Object.values(apiResults).every((r) => r.http === 200 && r.activeVisible && !r.inactiveVisible)
      const uiAllOk = Object.values(uiResults).every((r) => r.activeVisible && !r.inactiveVisible)
      const ok10 = apiAllOk && uiAllOk && mgmtHasActive && mgmtHasInactive

      const uiSummary = Object.entries(uiResults).map(([role, r]) => `${role}=${r.activeVisible && !r.inactiveVisible ? 'ok' : 'ko'}`).join(' ')

      results.push(result({
        id: 'BAL-010',
        priority: 'P2',
        scenario: 'Tous les rôles consultent les types actifs',
        type: 'C - UI + API',
        status: ok10 ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `API 5 rôles ${apiAllOk ? 'ok' : 'ko'} | UI ${uiSummary} | actif="${activeName}" visible | inactif="${inactiveName}" masqué | management actif=${mgmtHasActive} inactif=${mgmtHasInactive}`,
        error: ok10 ? '' : 'Un rôle ne consulte pas correctement les types actifs.',
        comment: `API: ${Object.entries(apiResults).map(([r, v]) => `${r}=HTTP${v.http}/actif${v.activeVisible}/inactif${v.inactiveVisible}`).join(' ')}. UI: ${Object.entries(uiResults).map(([r, v]) => `${r}:${v.route}`).join(' ')}.`,
        duration: Date.now() - start10,
      }))
      console.log(`BAL-010 ${ok10 ? 'OK' : 'NON CONFORME'} — ${results[results.length - 1].result}`)
    } catch (error) {
      results.push(result({ id: 'BAL-010', priority: 'P2', scenario: 'Tous les rôles consultent les types actifs', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start10 }))
    }
  }

  await browser.close()

  writeReport(results, { label: 'recette-results-bal' })
  console.log('BAL-001..010 terminés')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
