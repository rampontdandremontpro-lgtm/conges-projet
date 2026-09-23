import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../../helpers/api.mjs'
import { config } from '../../helpers/config.mjs'
import { writeReport, STATUS } from '../../helpers/report.mjs'
import { loadAccounts } from '../../helpers/tokens.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES_DIR = path.resolve(__dirname, '../../preuves')

const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'all'
const RUN_API = MODE === 'api' || MODE === 'all'
const RUN_UI = MODE === 'ui' || MODE === 'all'
const REPORT_LABEL =
  MODE === 'all' ? 'recette-results-auth' : `recette-results-${MODE}`

const KNOWN_EMAIL = 'admin.recette@gmes.fr'
const UNKNOWN_EMAIL = 'compte.inconnu.recette@gmes.fr'

function result({
  id,
  priority,
  scenario,
  type,
  status,
  resultText,
  proof = '',
  error = '',
  comment = '',
  duration,
}) {
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

async function capture(page, fileName) {
  const filePath = path.join(PREUVES_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  return fileName
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []
  const startedAt = new Date()

  console.log(`Mode      : ${MODE}`)
  console.log(`Frontend  : ${config.FRONTEND_URL}`)
  console.log(`API       : ${config.API_URL}`)
  console.log('')

  // AUTH-001 — Racine de l'API disponible
  if (RUN_API) {
    const start = Date.now()
    const { status, data } = await apiRequest('/')
    const ok = status === 200 && data === 'Hello World!'
    results.push(
      result({
        id: 'AUTH-001',
        priority: 'P2',
        scenario: 'Racine de l’API disponible',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `HTTP 200 — ${data}` : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'La racine /api ne répond pas comme attendu.',
        duration: Date.now() - start,
      }),
    )
    console.log(`${ok ? 'OK' : 'KO'} AUTH-001`)
  }

  // AUTH-002 — Connexion refusée avec un mauvais mot de passe (UI)
  if (RUN_UI) {
    const start = Date.now()
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
      await page.fill('#login-email', KNOWN_EMAIL)
      await page.fill('#login-password', 'mot-de-passe-incorrect')
      await page.click('.login-submit')
      const errorVisible = await page
        .getByText('Adresse e-mail ou mot de passe incorrect.', { exact: false })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)

      const proof = await capture(page, 'CAP-AUTH-002.png')
      const ok = errorVisible
      results.push(
        result({
          id: 'AUTH-002',
          priority: 'P1',
          scenario: 'Connexion refusée avec un mauvais mot de passe',
          type: 'A - Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok
            ? 'Message d’erreur explicite affiché, pas de connexion.'
            : 'Message d’erreur attendu non affiché.',
          proof,
          error: ok ? '' : 'Message d’erreur de connexion introuvable.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${ok ? 'OK' : 'KO'} AUTH-002`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-002',
          priority: 'P1',
          scenario: 'Connexion refusée avec un mauvais mot de passe',
          type: 'A - Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test UI : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-002 — ${error.message}`)
    } finally {
      if (browser) await browser.close()
    }
  }

  // AUTH-003 — Demande de définition de mot de passe pour un compte connu (UI)
  if (RUN_UI) {
    const start = Date.now()
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/forgot-password`, { waitUntil: 'networkidle' })
      await page.fill('#forgot-email', KNOWN_EMAIL)
      await page.click('.login-submit')
      const successVisible = await page
        .getByText('Consultez votre boîte e-mail', { exact: false })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
      const proof = await capture(page, 'CAP-AUTH-003.png')
      const ok = successVisible
      results.push(
        result({
          id: 'AUTH-003',
          priority: 'P1',
          scenario: 'Demande de définition de mot de passe pour un compte connu',
          type: 'A - Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok
            ? 'Écran de confirmation affiché pour un compte connu.'
            : 'Écran de confirmation attendu non affiché.',
          proof,
          error: ok ? '' : 'Message de confirmation introuvable.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${ok ? 'OK' : 'KO'} AUTH-003`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-003',
          priority: 'P1',
          scenario: 'Demande de définition de mot de passe pour un compte connu',
          type: 'A - Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test UI : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-003 — ${error.message}`)
    } finally {
      if (browser) await browser.close()
    }
  }

  // AUTH-004 — Demande de définition de mot de passe pour un compte inconnu (UI)
  if (RUN_UI) {
    const start = Date.now()
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/forgot-password`, { waitUntil: 'networkidle' })
      await page.fill('#forgot-email', UNKNOWN_EMAIL)
      await page.click('.login-submit')
      const successVisible = await page
        .getByText('Consultez votre boîte e-mail', { exact: false })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
      const proof = await capture(page, 'CAP-AUTH-004.png')
      const ok = successVisible
      results.push(
        result({
          id: 'AUTH-004',
          priority: 'P1',
          scenario: 'Demande de définition de mot de passe pour un compte inconnu',
          type: 'A - Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok
            ? 'Écran de confirmation générique affiché pour un compte inconnu.'
            : 'Écran de confirmation attendu non affiché.',
          proof,
          error: ok ? '' : 'Message de confirmation introuvable.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${ok ? 'OK' : 'KO'} AUTH-004`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-004',
          priority: 'P1',
          scenario: 'Demande de définition de mot de passe pour un compte inconnu',
          type: 'A - Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test UI : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-004 — ${error.message}`)
    } finally {
      if (browser) await browser.close()
    }
  }

  // AUTH-005 — La récupération ne révèle pas l'existence du compte (mixte API/UI)
  if (RUN_API && RUN_UI) {
    const start = Date.now()
    try {
      const known = await apiRequest('/auth/request-password', {
        method: 'POST',
        body: { email: KNOWN_EMAIL },
      })
      const unknown = await apiRequest('/auth/request-password', {
        method: 'POST',
        body: { email: UNKNOWN_EMAIL },
      })
      const sameMessage =
        known.status === 200 &&
        unknown.status === 200 &&
        JSON.stringify(known.data) === JSON.stringify(unknown.data)

      let proof = ''
      let browser
      try {
        browser = await chromium.launch({ headless: true })
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/forgot-password`, { waitUntil: 'networkidle' })
        await page.fill('#forgot-email', UNKNOWN_EMAIL)
        await page.click('.login-submit')
        await page
          .getByText('Consultez votre boîte e-mail', { exact: false })
          .waitFor({ state: 'visible', timeout: 5000 })
        proof = await capture(page, 'CAP-AUTH-005.png')
      } finally {
        if (browser) await browser.close()
      }

      const ok = sameMessage
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok
            ? 'Les réponses API pour compte connu/inconnu sont strictement identiques.'
            : `Réponses différentes : ${JSON.stringify(known.data)} vs ${JSON.stringify(unknown.data)}`,
          proof,
          error: ok ? '' : 'Divulgation de l’existence du compte détectée.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${ok ? 'OK' : 'KO'} AUTH-005`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-005 — ${error.message}`)
    }
  } else if (RUN_API) {
    const start = Date.now()
    try {
      const known = await apiRequest('/auth/request-password', {
        method: 'POST',
        body: { email: KNOWN_EMAIL },
      })
      const unknown = await apiRequest('/auth/request-password', {
        method: 'POST',
        body: { email: UNKNOWN_EMAIL },
      })
      const sameMessage =
        known.status === 200 &&
        unknown.status === 200 &&
        JSON.stringify(known.data) === JSON.stringify(unknown.data)
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: sameMessage ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: sameMessage
            ? 'Réponses API connues/inconnues strictement identiques (volet API).'
            : `Réponses différentes : ${JSON.stringify(known.data)} vs ${JSON.stringify(unknown.data)}`,
          comment: 'Volet UI exécuté par npm run test:recette:ui.',
          error: sameMessage ? '' : 'Divulgation de l’existence du compte détectée.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${sameMessage ? 'OK' : 'KO'} AUTH-005 (API)`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test API : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-005 (API) — ${error.message}`)
    }
  } else if (RUN_UI) {
    const start = Date.now()
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/forgot-password`, { waitUntil: 'networkidle' })
      await page.fill('#forgot-email', UNKNOWN_EMAIL)
      await page.click('.login-submit')
      const successVisible = await page
        .getByText('Consultez votre boîte e-mail', { exact: false })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
      const proof = await capture(page, 'CAP-AUTH-005.png')
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: successVisible ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: successVisible
            ? 'Écran générique affiché pour un compte inconnu (volet UI).'
            : 'Écran générique attendu non affiché.',
          proof,
          comment: 'Volet API exécuté par npm run test:recette:api.',
          error: successVisible ? '' : 'Message de confirmation introuvable.',
          duration: Date.now() - start,
        }),
      )
      console.log(`${successVisible ? 'OK' : 'KO'} AUTH-005 (UI)`)
    } catch (error) {
      results.push(
        result({
          id: 'AUTH-005',
          priority: 'P1',
          scenario: 'La récupération de mot de passe ne révèle pas l’existence du compte',
          type: 'C - Mixte API + Playwright',
          status: STATUS.BLOQUE,
          resultText: `Impossible d’exécuter le test UI : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
      console.log(`BLOQUE AUTH-005 (UI) — ${error.message}`)
    } finally {
      if (browser) await browser.close()
    }
  }

  // AUTH-006 — Lecture du profil authentifié pour chaque rôle (API)
  if (RUN_API) {
    const start = Date.now()
    const accounts = loadAccounts()
    let ok = true
    const details = []
    for (const account of accounts) {
      const login = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email: account.email, password: account.password },
      })
      const token = login.data?.accessToken
      const { status, data } = await apiRequest('/auth/me', { token })
      const roleOk =
        login.status === 200 &&
        status === 200 &&
        data?.role === account.role &&
        String(data?.id) === String(account.id)
      if (!roleOk) ok = false
      details.push(
        `${account.role}: login ${login.status}, me ${status}${roleOk ? '' : ` — ${JSON.stringify(data)}`}`,
      )
    }
    results.push(
      result({
        id: 'AUTH-006',
        priority: 'P2',
        scenario: 'Lecture du profil authentifié pour chaque rôle',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: details.join(' | '),
        error: ok ? '' : 'Un ou plusieurs profils ne sont pas conformes.',
        duration: Date.now() - start,
      }),
    )
    console.log(`${ok ? 'OK' : 'KO'} AUTH-006 — ${details.join(' | ')}`)
  }

  // AUTH-007 — /auth/me sans jeton
  if (RUN_API) {
    const start = Date.now()
    const { status, data } = await apiRequest('/auth/me')
    const ok = status === 401
    results.push(
      result({
        id: 'AUTH-007',
        priority: 'P1',
        scenario: '/auth/me sans jeton',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `HTTP ${status}`,
        error: ok ? '' : `Attendu 401, obtenu ${status} — ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      }),
    )
    console.log(`${ok ? 'OK' : 'KO'} AUTH-007 — HTTP ${status}`)
  }

  // AUTH-008 — Accès à une route protégée sans jeton
  if (RUN_API) {
    const start = Date.now()
    const { status, data } = await apiRequest('/users/me')
    const ok = status === 401
    results.push(
      result({
        id: 'AUTH-008',
        priority: 'P1',
        scenario: 'Accès à une route protégée sans jeton',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `HTTP ${status}`,
        error: ok ? '' : `Attendu 401, obtenu ${status} — ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      }),
    )
    console.log(`${ok ? 'OK' : 'KO'} AUTH-008 — HTTP ${status}`)
  }

  const reportPaths = writeReport(results, { label: REPORT_LABEL })

  console.log('')
  console.log(`Module AUTH (${MODE}) terminé en ${Date.now() - startedAt.getTime()} ms`)
  console.log(`Rapport JSON : ${reportPaths.jsonPath}`)
  console.log(`Rapport CSV  : ${reportPaths.csvPath}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
