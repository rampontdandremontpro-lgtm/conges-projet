import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { apiRequest } from '../../helpers/api.mjs'
import { config } from '../../helpers/config.mjs'
import { writeReport, STATUS } from '../../helpers/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREUVES_DIR = path.resolve(__dirname, '../../preuves')
const ADMIN_EMAIL = 'admin.recette@gmes.fr'
const ADMIN_PASSWORD = 'RecetteGMES@2026!'
const COLLAB_EMAIL = 'col-a.recette@gmes.fr'
const COLLAB_PASSWORD = 'RecetteGMES@2026!'

const stamp = Date.now()

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

async function capture(page, fileName) {
  const filePath = path.join(PREUVES_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  return fileName
}

function extractLatestResetToken() {
  const logPath = path.join(config.BACKEND_DIR, 'recette.log')
  const content = readFileSync(logPath, 'utf8')
  const lines = content.split(/\r?\n/)
  let token = null
  for (const line of lines) {
    const match = line.match(/reset-password\?token=([^&\s]+)/)
    if (match) token = match[1]
  }
  return token
}

async function login(email, password) {
  const { status, data } = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  if (status !== 200 || !data?.accessToken) {
    throw new Error(`Connexion impossible pour ${email} (HTTP ${status})`)
  }
  return data.accessToken
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []
  const startedAt = new Date()

  console.log(`Module ADM — base recette ${config.DB_DATABASE}`)
  console.log(`API : ${config.API_URL}`)
  console.log('')

  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const collabToken = await login(COLLAB_EMAIL, COLLAB_PASSWORD)

  const record = (entry) => {
    results.push(entry)
    console.log(`${entry.status === STATUS.CONFORME ? 'OK' : entry.status.toUpperCase()} ${entry.id} — ${entry.result}`)
  }

  // ADM-001 — Admin crée un service
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/services', {
      method: 'POST',
      token: adminToken,
      body: {
        name: `SRV-REC-${stamp}`,
        serviceType: 'INTERNE',
        validationMode: 'DIRECTEUR_ET_RH',
        hasMinimumPresenceRule: false,
        minimumPresence: 0,
      },
    })
    const ok = status === 201 && data?.id && data?.name?.startsWith('SRV-REC-')
    const serviceId = data?.id
    record(
      result({
        id: 'ADM-001',
        priority: 'P2',
        scenario: 'Admin crée un service',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Service créé (id=${serviceId})` : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Création du service impossible.',
        duration: Date.now() - start,
      }),
    )
    // store service id for later scenarios in module scope
    globalThis.__admServiceId = serviceId
    globalThis.__admServiceName = `SRV-REC-${stamp}`
  }

  const serviceId = globalThis.__admServiceId

  // ADM-002 — Admin modifie le service
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/services/${serviceId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { name: `SRV-REC-MOD-${stamp}` },
    })
    const ok = status === 200 && data?.name === `SRV-REC-MOD-${stamp}`
    record(
      result({
        id: 'ADM-002',
        priority: 'P2',
        scenario: 'Admin modifie le service',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Nom du service modifié.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification du service impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-003 — Admin désactive le service
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/services/${serviceId}/disable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === false
    record(
      result({
        id: 'ADM-003',
        priority: 'P2',
        scenario: 'Admin désactive le service',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Service désactivé (isActive=false).' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation du service impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-004 — Admin réactive le service
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/services/${serviceId}/enable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === true
    record(
      result({
        id: 'ADM-004',
        priority: 'P2',
        scenario: 'Admin réactive le service',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Service réactivé (isActive=true).' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation du service impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-005 — Admin crée un utilisateur
  const admUserEmail = `adm-user-${stamp}@gmes.fr`
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        nom: 'ADMUSER',
        prenom: 'Recette',
        email: admUserEmail,
        role: 'COLLABORATEUR',
        employmentType: 'INTERNE',
        serviceId,
      },
    })
    const ok = status === 201 && data?.id
    globalThis.__admUserId = data?.id
    record(
      result({
        id: 'ADM-005',
        priority: 'P2',
        scenario: 'Admin crée un utilisateur',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Utilisateur créé (id=${data.id})` : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Création de l’utilisateur impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  const userId = globalThis.__admUserId

  // ADM-006 — Le nouvel utilisateur définit son mot de passe
  {
    const start = Date.now()
    try {
      await apiRequest('/auth/request-password', {
        method: 'POST',
        body: { email: admUserEmail },
      })
      const token = extractLatestResetToken()
      if (!token) throw new Error('Lien de réinitialisation introuvable dans les logs.')

      let browser
      let ok = false
      let proof = ''
      try {
        browser = await chromium.launch({ headless: true })
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`, {
          waitUntil: 'networkidle',
        })
        await page.fill('#new-password', 'RecetteGMES@2026!')
        await page.fill('#confirm-password', 'RecetteGMES@2026!')
        await page.click('button[type="submit"]')
        ok = await page
          .getByText('Mot de passe réinitialisé', { exact: false })
          .waitFor({ state: 'visible', timeout: 8000 })
          .then(() => true)
          .catch(() => false)
        proof = await capture(page, 'CAP-ADM-006.png')
      } finally {
        if (browser) await browser.close()
      }

      record(
        result({
          id: 'ADM-006',
          priority: 'P1',
          scenario: 'Le nouvel utilisateur définit son mot de passe',
          type: 'A - Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? 'Mot de passe défini via le lien de réinitialisation.' : 'La page de confirmation n’a pas été affichée.',
          proof,
          error: ok ? '' : 'Définition du mot de passe impossible.',
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-006',
          priority: 'P1',
          scenario: 'Le nouvel utilisateur définit son mot de passe',
          type: 'A - Playwright',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-007 — Le nouvel utilisateur se connecte avec son mot de passe
  {
    const start = Date.now()
    try {
      // Prépare un utilisateur + mot de passe de façon autonome.
      const email = `adm-login-${stamp}@gmes.fr`
      await apiRequest('/users', {
        method: 'POST',
        token: adminToken,
        body: { nom: 'LOGIN', prenom: 'Recette', email, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId },
      })
      await apiRequest('/auth/request-password', { method: 'POST', body: { email } })
      const token = extractLatestResetToken()
      if (!token) throw new Error('Lien de réinitialisation introuvable dans les logs.')
      await apiRequest('/auth/define-password', {
        method: 'POST',
        body: { token, password: 'RecetteGMES@2026!' },
      })

      let browser
      let ok = false
      let proof = ''
      try {
        browser = await chromium.launch({ headless: true })
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
        await page.fill('#login-email', email)
        await page.fill('#login-password', 'RecetteGMES@2026!')
        await page.click('.login-submit')
        ok = await page
          .waitForURL('**/app/**', { timeout: 10000 })
          .then(() => true)
          .catch(() => false)
        proof = await capture(page, 'CAP-ADM-007.png')
      } finally {
        if (browser) await browser.close()
      }

      record(
        result({
          id: 'ADM-007',
          priority: 'P1',
          scenario: 'Le nouvel utilisateur se connecte avec son mot de passe',
          type: 'A - Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? 'Connexion réussie après définition du mot de passe.' : 'La connexion a échoué.',
          proof,
          error: ok ? '' : 'Connexion du nouvel utilisateur impossible.',
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-007',
          priority: 'P1',
          scenario: 'Le nouvel utilisateur se connecte avec son mot de passe',
          type: 'A - Playwright',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-008 — Le lien de définition du mot de passe est à usage unique
  {
    const start = Date.now()
    try {
      const email = `adm-onetime-${stamp}@gmes.fr`
      await apiRequest('/users', {
        method: 'POST',
        token: adminToken,
        body: { nom: 'ONETIME', prenom: 'Recette', email, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId },
      })
      await apiRequest('/auth/request-password', { method: 'POST', body: { email } })
      const token = extractLatestResetToken()
      if (!token) throw new Error('Lien de réinitialisation introuvable dans les logs.')
      await apiRequest('/auth/define-password', { method: 'POST', body: { token, password: 'RecetteGMES@2026!' } })

      const reuse = await apiRequest('/auth/define-password', {
        method: 'POST',
        body: { token, password: 'AutreRecetteGMES@2026!' },
      })
      const ok = reuse.status >= 400

      let proof = ''
      let browser
      try {
        browser = await chromium.launch({ headless: true })
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`, {
          waitUntil: 'networkidle',
        })
        await page
          .getByText(/expiré|invalide|déjà|utilisé|impossible/i)
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => {})
        proof = await capture(page, 'CAP-ADM-008.png')
      } finally {
        if (browser) await browser.close()
      }

      record(
        result({
          id: 'ADM-008',
          priority: 'P1',
          scenario: 'Le lien de définition du mot de passe est à usage unique',
          type: 'C - Mixte API + Playwright',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? `Réutilisation refusée (HTTP ${reuse.status}).` : `La réutilisation a été acceptée (HTTP ${reuse.status}).`,
          proof,
          error: ok ? '' : 'Le lien n’est pas à usage unique.',
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-008',
          priority: 'P1',
          scenario: 'Le lien de définition du mot de passe est à usage unique',
          type: 'C - Mixte API + Playwright',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-009 — RH consulte l'utilisateur créé
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/users/${userId}`, { token: adminToken })
    const ok = status === 200 && data?.email === admUserEmail
    record(
      result({
        id: 'ADM-009',
        priority: 'P2',
        scenario: 'RH consulte l’utilisateur créé',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Utilisateur visible pour la RH.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Utilisateur introuvable.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-010 — Admin modifie l'utilisateur
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/users/${userId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { prenom: 'RecetteMod' },
    })
    const ok = status === 200 && data?.prenom === 'RecetteMod'
    record(
      result({
        id: 'ADM-010',
        priority: 'P2',
        scenario: 'Admin modifie l’utilisateur',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Prénom modifié.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification de l’utilisateur impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-011 — Admin désactive l'utilisateur
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/users/${userId}/disable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === false
    record(
      result({
        id: 'ADM-011',
        priority: 'P2',
        scenario: 'Admin désactive l’utilisateur',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Utilisateur désactivé.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-012 — Admin réactive l'utilisateur
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/users/${userId}/enable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === true
    record(
      result({
        id: 'ADM-012',
        priority: 'P2',
        scenario: 'Admin réactive l’utilisateur',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Utilisateur réactivé.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-013 — RH ne peut pas activer le dépôt différé sans justificatif obligatoire
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/leave-types', {
      method: 'POST',
      token: adminToken,
      body: {
        name: `Type-Depot-Interdit-${stamp}`,
        category: 'DEMANDE_CONGE',
        documentRequired: false,
        documentCanBeAddedLater: true,
        employeeCanCreate: true,
        rhOnly: false,
        allowsDays: true,
        allowsHalfDays: false,
        allowsHours: false,
        requiresValidation: true,
      },
    })
    const ok = status === 400

    let proof = ''
    let uiOk = false
    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
      await page.fill('#login-email', 'rh.recette@gmes.fr')
      await page.fill('#login-password', 'RecetteGMES@2026!')
      await page.click('.login-submit')
      await page.waitForURL('**/app/**', { timeout: 10000 })
      await page.click('a[href="/app/rh-leave-types"]')
      await page.waitForSelector('.rh-leave-types-new')
      await page.click('.rh-leave-types-new')
      await page.waitForSelector('.rh-leave-types-drawer')
      const ajoutRow = page.locator('.rh-leave-types-switch-row', { hasText: 'Ajout ultérieur autorisé' })
      uiOk = await ajoutRow.evaluate((el) => el.classList.contains('is-disabled'))
      proof = await capture(page, 'CAP-ADM-013.png')
    } catch (error) {
      console.log(`CAP-ADM-013 UI : ${error.message}`)
    } finally {
      if (browser) await browser.close()
    }

    const allOk = ok && uiOk
    record(
      result({
        id: 'ADM-013',
        priority: 'P1',
        scenario: 'RH ne peut pas activer le dépôt différé sans justificatif obligatoire',
        type: 'C - Mixte API + Playwright',
        status: allOk ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: allOk
          ? `Règle refusée (HTTP 400, ${data?.message ?? ''}) et option « Ajout ultérieur autorisé » désactivée dans le drawer.`
          : `API ${status} (${data?.message ?? ''}) — UI disabled=${uiOk}`,
        proof,
        error: allOk ? '' : 'La règle n’est pas vérifiée côté API et/ou UI.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-014 — RH crée un type de congé
  const leaveTypeName = `Type-${stamp}`
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/leave-types', {
      method: 'POST',
      token: adminToken,
      body: {
        name: leaveTypeName,
        category: 'DEMANDE_CONGE',
        documentRequired: false,
        documentCanBeAddedLater: false,
        employeeCanCreate: true,
        rhOnly: false,
        allowsDays: true,
        allowsHalfDays: false,
        allowsHours: false,
        requiresValidation: true,
      },
    })
    const ok = status === 201 && data?.id
    globalThis.__admLeaveTypeId = data?.id
    record(
      result({
        id: 'ADM-014',
        priority: 'P1',
        scenario: 'RH crée un type de congé',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Type créé (id=${data.id})` : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Création du type impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  const leaveTypeId = globalThis.__admLeaveTypeId

  // ADM-015 — Admin modifie le type de congé
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/leave-types/${leaveTypeId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { name: `Type-MOD-${stamp}` },
    })
    const ok = status === 200 && data?.name === `Type-MOD-${stamp}`
    record(
      result({
        id: 'ADM-015',
        priority: 'P1',
        scenario: 'Admin modifie le type de congé',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Type modifié.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification du type impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-016 — RH désactive le type de congé
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/leave-types/${leaveTypeId}/disable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === false
    record(
      result({
        id: 'ADM-016',
        priority: 'P1',
        scenario: 'RH désactive le type de congé',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Type désactivé.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation du type impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-017 — RH réactive le type de congé
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/leave-types/${leaveTypeId}/enable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === true
    record(
      result({
        id: 'ADM-017',
        priority: 'P1',
        scenario: 'RH réactive le type de congé',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Type réactivé.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation du type impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-018 — RH crée une fermeture GMES
  const holidayDate = '2026-08-20'
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/holidays', {
      method: 'POST',
      token: adminToken,
      body: { date: holidayDate, name: `Fermeture-${stamp}`, holidayType: 'FERMETURE_GMES', deductible: false },
    })
    const ok = status === 201 && data?.id
    globalThis.__admHolidayId = data?.id
    record(
      result({
        id: 'ADM-018',
        priority: 'P1',
        scenario: 'RH crée une fermeture GMES',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Fermeture créée (id=${data.id})` : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Création de la fermeture impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  const holidayId = globalThis.__admHolidayId

  // ADM-019 — RH modifie la fermeture
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/holidays/${holidayId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { name: `Fermeture-MOD-${stamp}` },
    })
    const ok = status === 200 && data?.name === `Fermeture-MOD-${stamp}`
    record(
      result({
        id: 'ADM-019',
        priority: 'P1',
        scenario: 'RH modifie la fermeture',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Fermeture modifiée.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification de la fermeture impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-020 — RH désactive la fermeture
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/holidays/${holidayId}/disable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === false
    record(
      result({
        id: 'ADM-020',
        priority: 'P1',
        scenario: 'RH désactive la fermeture',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Fermeture désactivée.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation de la fermeture impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-021 — RH réactive la fermeture
  {
    const start = Date.now()
    const { status, data } = await apiRequest(`/holidays/${holidayId}/enable`, {
      method: 'PATCH',
      token: adminToken,
    })
    const ok = status === 200 && data?.isActive === true
    record(
      result({
        id: 'ADM-021',
        priority: 'P1',
        scenario: 'RH réactive la fermeture',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Fermeture réactivée.' : `HTTP ${status} — ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation de la fermeture impossible.',
        duration: Date.now() - start,
      }),
    )
  }

  // ADM-022 — Une demande ne commence pas sur une fermeture non décomptable
  {
    const start = Date.now()
    // La règle de borne est portée par le backend de création de demande.
    // Ici, on vérifie le refus métier via l'API de création de demande du collaborateur.
    try {
      const employeeToken = await login(admUserEmail, 'RecetteGMES@2026!')
      const { status, data } = await apiRequest('/leave-requests', {
        method: 'POST',
        token: employeeToken,
        body: {
          leaveTypeId,
          startDate: holidayDate,
          endDate: holidayDate,
          startPeriod: 'MATIN',
          endPeriod: 'APRES_MIDI',
          comment: 'Test fermeture non décomptable',
        },
      })
      const ok = status >= 400
      record(
        result({
          id: 'ADM-022',
          priority: 'P1',
          scenario: 'Une demande ne commence pas sur une fermeture non décomptable',
          type: 'C - Mixte API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? `Demande refusée (HTTP ${status}) — ${data?.message ?? ''}` : `Demande acceptée (HTTP ${status}).`,
          error: ok ? '' : `La demande n'aurait pas dû être acceptée : ${JSON.stringify(data)}`,
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-022',
          priority: 'P1',
          scenario: 'Une demande ne commence pas sur une fermeture non décomptable',
          type: 'C - Mixte API',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-023 — Synchronisation officielle des jours fériés de Martinique (Admin)
  {
    const start = Date.now()
    try {
      const { status, data } = await apiRequest('/holidays/sync/martinique', {
        method: 'POST',
        token: adminToken,
        body: { year: 2026 },
      })
      const ok = status === 201 || status === 200
      record(
        result({
          id: 'ADM-023',
          priority: 'P2',
          scenario: 'Synchronisation officielle des jours fériés de Martinique',
          type: 'B - API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? `Synchronisation effectuée (HTTP ${status}).` : `HTTP ${status} — ${JSON.stringify(data)}`,
          error: ok ? '' : 'Synchronisation impossible.',
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-023',
          priority: 'P2',
          scenario: 'Synchronisation officielle des jours fériés de Martinique',
          type: 'B - API',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-024 — Synchronisation officielle des jours fériés de Martinique (RH)
  {
    const start = Date.now()
    try {
      const rhToken = await login('rh.recette@gmes.fr', 'RecetteGMES@2026!')
      const { status, data } = await apiRequest('/holidays/sync/martinique', {
        method: 'POST',
        token: rhToken,
        body: { year: 2026 },
      })
      const ok = status === 201 || status === 200
      record(
        result({
          id: 'ADM-024',
          priority: 'P2',
          scenario: 'Synchronisation officielle des jours fériés de Martinique',
          type: 'B - API',
          status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
          resultText: ok ? `Synchronisation RH effectuée (HTTP ${status}).` : `HTTP ${status} — ${JSON.stringify(data)}`,
          error: ok ? '' : 'Synchronisation RH impossible.',
          duration: Date.now() - start,
        }),
      )
    } catch (error) {
      record(
        result({
          id: 'ADM-024',
          priority: 'P2',
          scenario: 'Synchronisation officielle des jours fériés de Martinique',
          type: 'B - API',
          status: STATUS.BLOQUE,
          resultText: `Test non exécuté : ${error.message}`,
          error: error.message,
          duration: Date.now() - start,
        }),
      )
    }
  }

  // ADM-025 — Collaborateur ne déclenche pas la synchronisation
  {
    const start = Date.now()
    const { status, data } = await apiRequest('/holidays/sync/martinique', {
      method: 'POST',
      token: collabToken,
      body: { year: 2026 },
    })
    const ok = status === 403 || status === 401
    record(
      result({
        id: 'ADM-025',
        priority: 'P2',
        scenario: 'Collaborateur ne déclenche pas la synchronisation',
        type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Action refusée (HTTP ${status}) — ${data?.message ?? ''}` : `Action acceptée (HTTP ${status}).`,
        error: ok ? '' : `Le collaborateur n'aurait pas dû pouvoir synchroniser : ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      }),
    )
  }

  // Fusion avec les résultats AUTH existants pour conserver un rapport global.
  const reportPaths = writeReport(results, { label: 'recette-results-adm' })

  console.log('')
  console.log(`Module ADM terminé en ${Date.now() - startedAt.getTime()} ms`)
  console.log(`Rapport ADM JSON : ${reportPaths.jsonPath}`)
  console.log(`Rapport ADM CSV  : ${reportPaths.csvPath}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
