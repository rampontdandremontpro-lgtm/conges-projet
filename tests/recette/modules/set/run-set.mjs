import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../../helpers/api.mjs'
import { config } from '../../helpers/config.mjs'
import { writeReport, STATUS } from '../../helpers/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES_DIR = path.resolve(__dirname, '../../preuves')

const RH_EMAIL = 'rh.recette@gmes.fr'
const RH_PASSWORD = 'RecetteGMES@2026!'

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

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []
  const startedAt = new Date()

  console.log(`SET — base recette ${config.DB_DATABASE}`)

  const login = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email: RH_EMAIL, password: RH_PASSWORD },
  })
  const rhToken = login.data?.accessToken

  const record = (entry) => {
    results.push(entry)
    console.log(`${entry.status === STATUS.CONFORME ? 'OK' : entry.status.toUpperCase()} ${entry.id} — ${entry.result}`)
  }

  // ============ SET-001 à SET-004 : MODIFICATION_DEADLINE_DAYS (API) ============

  let originalDeadline = null

  // SET-001 — consultation
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/settings/MODIFICATION_DEADLINE_DAYS', { token: rhToken })
    originalDeadline = data?.settingValue
    const ok = status === 200 && data?.settingValue !== undefined
    record(result({
      id: 'SET-001', priority: 'P2', scenario: 'RH consulte MODIFICATION_DEADLINE_DAYS', type: 'B - API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: ok ? `Valeur lue : ${data.settingValue}` : `HTTP ${status} — ${JSON.stringify(data)}`,
      error: ok ? '' : 'Consultation impossible.',
      duration: Date.now() - start,
    }))
  }

  // SET-002 — modification
  {
    const start = Date.now()
    const newValue = '15'
    const { status, data } = await apiRequest('/settings/MODIFICATION_DEADLINE_DAYS', {
      method: 'PATCH',
      token: rhToken,
      body: { settingValue: newValue },
    })
    const ok = status === 200 && data?.settingValue === newValue
    record(result({
      id: 'SET-002', priority: 'P2', scenario: 'RH modifie MODIFICATION_DEADLINE_DAYS', type: 'B - API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: ok ? `Valeur modifiée à ${newValue}.` : `HTTP ${status} — ${JSON.stringify(data)}`,
      error: ok ? '' : 'Modification impossible.',
      duration: Date.now() - start,
    }))
  }

  // SET-003 — relecture
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/settings/MODIFICATION_DEADLINE_DAYS', { token: rhToken })
    const ok = status === 200 && data?.settingValue === '15'
    record(result({
      id: 'SET-003', priority: 'P2', scenario: 'Le paramètre modifié est relu', type: 'B - API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: ok ? `Valeur relue : ${data.settingValue}` : `HTTP ${status} — ${JSON.stringify(data)}`,
      error: ok ? '' : 'Relecture incohérente.',
      duration: Date.now() - start,
    }))
  }

  // SET-004 — restauration
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/settings/MODIFICATION_DEADLINE_DAYS', {
      method: 'PATCH',
      token: rhToken,
      body: { settingValue: originalDeadline ?? '7' },
    })
    const ok = status === 200 && data?.settingValue === (originalDeadline ?? '7')
    record(result({
      id: 'SET-004', priority: 'P2', scenario: 'RH restaure MODIFICATION_DEADLINE_DAYS', type: 'B - API',
      status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
      resultText: ok ? `Valeur restaurée à ${originalDeadline ?? '7'}.` : `HTTP ${status} — ${JSON.stringify(data)}`,
      error: ok ? '' : 'Restauration impossible.',
      duration: Date.now() - start,
    }))
  }

  // ============ SET-005 à SET-007 : période saisonnière (UI + API) ============

  const browser = await chromium.launch({ headless: true })
  const page = await loginPage(browser, RH_EMAIL, RH_PASSWORD)

  const seasonalBefore = await apiRequest('/settings/seasonal-period', { token: rhToken })
  const originalStart = seasonalBefore.data?.summerPeriodStart
  const originalEnd = seasonalBefore.data?.summerPeriodEnd

  const startInput = page.locator('label').filter({ hasText: 'Date de début' }).locator('input')
  const endInput = page.locator('label').filter({ hasText: 'Date de fin' }).locator('input')

  // SET-005 — lecture UI
  {
    const start = Date.now()
    try {
      await page.click('a[href="/app/rh-summer-period"]')
      await page.waitForSelector('.rh-summer-period-page')
      const uiStart = await startInput.inputValue()
      const uiEnd = await endInput.inputValue()
      const ok = uiStart.endsWith(`-${originalStart}`) && uiEnd.endsWith(`-${originalEnd}`)
      record(result({
        id: 'SET-005', priority: 'P2', scenario: 'Lecture de la période saisonnière', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `UI start=${uiStart}, end=${uiEnd}.` : `UI start=${uiStart}, end=${uiEnd}, attendu ${originalStart}/${originalEnd}`,
        error: ok ? '' : 'Lecture UI incohérente.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'SET-005', priority: 'P2', scenario: 'Lecture de la période saisonnière', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // SET-006 — modification temporaire UI
  {
    const start = Date.now()
    try {
      await startInput.fill('2026-06-01')
      await endInput.fill('2026-09-30')
      await page.getByRole('button', { name: 'Enregistrer les paramètres', exact: true }).click()
      await page.locator('.rh-summer-period-feedback--success').waitFor({ state: 'visible', timeout: 8000 })

      const after = await apiRequest('/settings/seasonal-period', { token: rhToken })
      const ok = after.data?.summerPeriodStart === '06-01' && after.data?.summerPeriodEnd === '09-30'
      record(result({
        id: 'SET-006', priority: 'P2', scenario: 'RH modifie temporairement la période saisonnière', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Période modifiée : ${after.data.summerPeriodStart} → ${after.data.summerPeriodEnd}.` : JSON.stringify(after.data),
        error: ok ? '' : 'Modification UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'SET-006', priority: 'P2', scenario: 'RH modifie temporairement la période saisonnière', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // SET-007 — restauration UI
  {
    const start = Date.now()
    try {
      await startInput.fill(`2026-${originalStart}`)
      await endInput.fill(`2026-${originalEnd}`)
      await page.getByRole('button', { name: 'Enregistrer les paramètres', exact: true }).click()
      await page.locator('.rh-summer-period-feedback--success').waitFor({ state: 'visible', timeout: 8000 })

      const after = await apiRequest('/settings/seasonal-period', { token: rhToken })
      const ok = after.data?.summerPeriodStart === originalStart && after.data?.summerPeriodEnd === originalEnd
      record(result({
        id: 'SET-007', priority: 'P2', scenario: 'RH restaure la période saisonnière', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Période restaurée : ${originalStart} → ${originalEnd}.` : JSON.stringify(after.data),
        error: ok ? '' : 'Restauration UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'SET-007', priority: 'P2', scenario: 'RH restaure la période saisonnière', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  await browser.close()

  writeReport(results, { label: 'recette-results-set' })

  console.log('')
  console.log(`SET terminé en ${Date.now() - startedAt.getTime()} ms`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
