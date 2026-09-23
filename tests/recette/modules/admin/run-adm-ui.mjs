import { mkdirSync } from 'node:fs'
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

async function loginPage(browser, email, password) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  return page
}

async function gotoHref(page, href) {
  await page.click(`a[href="${href}"]`)
  await page.waitForLoadState('networkidle')
}

async function confirmByText(page, name, overlaySelector) {
  await page.locator(overlaySelector).waitFor({ state: 'visible', timeout: 8000 })
  await page.getByRole('button', { name, exact: true }).click()
  await page.locator(overlaySelector).waitFor({ state: 'hidden', timeout: 8000 })
}

async function ensureUserOnPage(page, email) {
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('.admin-users-email', { hasText: email }).count()) > 0) {
      return true
    }
    const next = page.getByRole('button', { name: 'Page suivante' })
    if ((await next.count()) === 0 || (await next.isDisabled())) return false
    await next.click()
    await page.waitForLoadState('networkidle')
  }
  return false
}

async function pickFreeClosureDate(adminToken) {
  const { data } = await apiRequest('/holidays/management?year=2026', { token: adminToken })
  const occupied = new Set((data ?? []).filter((h) => h.holidayType === 'FERMETURE_GMES').map((h) => h.date))
  const candidates = ['2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26']
  return candidates.find((date) => !occupied.has(date)) ?? '2026-08-20'
}

async function run() {
  mkdirSync(PREUVES_DIR, { recursive: true })
  const results = []
  const startedAt = new Date()

  console.log(`ADM UI — base recette ${config.DB_DATABASE}`)

  const login = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  const adminToken = login.data?.accessToken

  const record = (entry) => {
    results.push(entry)
    console.log(`${entry.status === STATUS.CONFORME ? 'OK' : entry.status.toUpperCase()} ${entry.id} — ${entry.result}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await loginPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)

  // ============ SERVICES ============
  const serviceName = `SRV-UI-${stamp}`
  let serviceId = null

  // ADM-001
  {
    const start = Date.now()
    try {
      await gotoHref(page, '/app/admin-services')
      await page.click('.admin-services-new')
      await page.waitForSelector('.admin-services-form')
      await page.fill('label:has-text("Nom du service") input', serviceName)
      await page.selectOption('label:has-text("Type") select', 'INTERNE')
      await page.getByRole('button', { name: 'Créer le service', exact: true }).click()

      await page.waitForSelector('.admin-services-view', { state: 'visible', timeout: 8000 })
      const title = await page.locator('.admin-services-drawer__head h2').textContent()
      const viewOk = title?.trim() === serviceName

      await page.locator('.admin-services-close').click()
      await page.locator('.admin-services-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const list = await apiRequest('/services', { token: adminToken })
      const created = list.data?.find((s) => s.name === serviceName)
      serviceId = created?.id
      const ok = viewOk && Boolean(created && created.serviceType === 'INTERNE' && created.isActive)
      record(result({
        id: 'ADM-001', priority: 'P2', scenario: 'Admin crée un service', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Service créé depuis l’UI, drawer view affiché puis fermé (id=${serviceId}).` : `viewOk=${viewOk}, api=${JSON.stringify(created)}`,
        error: ok ? '' : 'Création UI/API non conforme.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-001', priority: 'P2', scenario: 'Admin crée un service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ADM-002
  if (serviceId) {
    const start = Date.now()
    try {
      await page.click(`button[aria-label="Modifier ${serviceName}"]`)
      await page.waitForSelector('.admin-services-form')
      const newName = `SRV-UI-MOD-${stamp}`
      await page.fill('label:has-text("Nom du service") input', newName)
      await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click()

      await page.waitForSelector('.admin-services-view', { state: 'visible', timeout: 8000 })
      const title = await page.locator('.admin-services-drawer__head h2').textContent()
      await page.locator('.admin-services-close').click()
      await page.locator('.admin-services-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const { data } = await apiRequest(`/services/${serviceId}`, { token: adminToken })
      const ok = title?.trim() === newName && data?.name === newName
      record(result({
        id: 'ADM-002', priority: 'P2', scenario: 'Admin modifie le service', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Service modifié depuis l’UI (${data.name}).` : `title=${title}, api=${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-002', priority: 'P2', scenario: 'Admin modifie le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-002', priority: 'P2', scenario: 'Admin modifie le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-001 non disponible.', comment: 'Prérequis ADM-001 non disponible.', duration: 0 }))
  }

  const serviceNameMod = `SRV-UI-MOD-${stamp}`

  // ADM-003
  if (serviceId) {
    const start = Date.now()
    try {
      await page.click(`button[aria-label="Désactiver ${serviceNameMod}"]`)
      await confirmByText(page, 'Désactiver', '.admin-services-confirm-overlay')
      const { data } = await apiRequest(`/services/${serviceId}`, { token: adminToken })
      const ok = data?.isActive === false
      record(result({
        id: 'ADM-003', priority: 'P2', scenario: 'Admin désactive le service', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Service désactivé depuis l’UI (isActive=false).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-003', priority: 'P2', scenario: 'Admin désactive le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-003', priority: 'P2', scenario: 'Admin désactive le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-001 non disponible.', comment: 'Prérequis ADM-001 non disponible.', duration: 0 }))
  }

  // ADM-004
  if (serviceId) {
    const start = Date.now()
    try {
      await page.click(`button[aria-label="Réactiver ${serviceNameMod}"]`)
      await confirmByText(page, 'Réactiver', '.admin-services-confirm-overlay')
      const { data } = await apiRequest(`/services/${serviceId}`, { token: adminToken })
      const ok = data?.isActive === true
      record(result({
        id: 'ADM-004', priority: 'P2', scenario: 'Admin réactive le service', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Service réactivé depuis l’UI (isActive=true).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-004', priority: 'P2', scenario: 'Admin réactive le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-004', priority: 'P2', scenario: 'Admin réactive le service', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-001 non disponible.', comment: 'Prérequis ADM-001 non disponible.', duration: 0 }))
  }

  // ============ UTILISATEURS ============
  const userEmail = `ui-user-${stamp}@gmes.fr`
  let userId = null

  // ADM-005
  {
    const start = Date.now()
    try {
      await gotoHref(page, '/app/admin-users')
      await page.click('.admin-users-new')
      await page.waitForSelector('.admin-users-form')
      const form = page.locator('.admin-users-form')
      await form.locator('label').filter({ hasText: /^Prénom\s/ }).locator('input').fill('Recette')
      await form.locator('label').filter({ hasText: /^Nom\s/ }).locator('input').fill('UIUSER')
      await form.locator('label').filter({ hasText: /^E-mail\s/ }).locator('input').fill(userEmail)
      await form.locator('label').filter({ hasText: /^Rôle\s/ }).locator('select').selectOption('COLLABORATEUR')
      await form.locator('label').filter({ hasText: /^Type\s/ }).locator('select').selectOption('INTERNE')
      await form.locator('label').filter({ hasText: /^Service\s/ }).locator('select').selectOption(String(serviceId))
      await page.getByRole('button', { name: 'Créer l’utilisateur', exact: true }).click()

      await page.waitForSelector('.admin-users-view', { state: 'visible', timeout: 8000 })
      await page.locator('.admin-users-close').click()
      await page.locator('.admin-users-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const list = await apiRequest('/users', { token: adminToken })
      const created = list.data?.find((u) => u.email === userEmail)
      userId = created?.id
      const ok = Boolean(created && created.nom === 'UIUSER' && created.role === 'COLLABORATEUR' && String(created.serviceId) === String(serviceId) && created.isActive)
      record(result({
        id: 'ADM-005', priority: 'P2', scenario: 'Admin crée un utilisateur', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Utilisateur créé depuis l’UI (id=${userId}).` : 'Création UI/API non conforme.',
        error: ok ? '' : 'Utilisateur introuvable ou valeurs incorrectes après création UI.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-005', priority: 'P2', scenario: 'Admin crée un utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ADM-009
  if (userId) {
    const start = Date.now()
    try {
      await gotoHref(page, '/app/admin-users')
      const visible = await ensureUserOnPage(page, userEmail)
      const { status, data } = await apiRequest(`/users/${userId}`, { token: adminToken })
      const ok = visible && status === 200 && data?.email === userEmail
      record(result({
        id: 'ADM-009', priority: 'P2', scenario: 'RH consulte l’utilisateur créé', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Utilisateur visible dans l’UI et consultable via API.' : `visible=${visible}, HTTP ${status}`,
        error: ok ? '' : 'Utilisateur non visible ou non consultable.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-009', priority: 'P2', scenario: 'RH consulte l’utilisateur créé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-009', priority: 'P2', scenario: 'RH consulte l’utilisateur créé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-005 non disponible.', comment: 'Prérequis ADM-005 non disponible.', duration: 0 }))
  }

  // ADM-010
  if (userId) {
    const start = Date.now()
    try {
      await ensureUserOnPage(page, userEmail)
      await page.click(`button[aria-label="Modifier UIUSER Recette"]`)
      await page.waitForSelector('.admin-users-form')
      const form = page.locator('.admin-users-form')
      await form.locator('label').filter({ hasText: /^Prénom\s/ }).locator('input').fill('RecetteMod')
      await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click()

      await page.waitForSelector('.admin-users-view', { state: 'visible', timeout: 8000 })
      await page.locator('.admin-users-close').click()
      await page.locator('.admin-users-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const { data } = await apiRequest(`/users/${userId}`, { token: adminToken })
      const ok = data?.prenom === 'RecetteMod'
      record(result({
        id: 'ADM-010', priority: 'P2', scenario: 'Admin modifie l’utilisateur', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Utilisateur modifié depuis l’UI (prenom=${data.prenom}).` : `Modification non persistée : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-010', priority: 'P2', scenario: 'Admin modifie l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-010', priority: 'P2', scenario: 'Admin modifie l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-005 non disponible.', comment: 'Prérequis ADM-005 non disponible.', duration: 0 }))
  }

  const userModName = 'UIUSER RecetteMod'

  // ADM-011
  if (userId) {
    const start = Date.now()
    try {
      await ensureUserOnPage(page, userEmail)
      await page.click(`button[aria-label="Désactiver ${userModName}"]`)
      await confirmByText(page, 'Désactiver', '.admin-users-confirm-overlay')
      const { data } = await apiRequest(`/users/${userId}`, { token: adminToken })
      const ok = data?.isActive === false
      record(result({
        id: 'ADM-011', priority: 'P2', scenario: 'Admin désactive l’utilisateur', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Utilisateur désactivé depuis l’UI (isActive=false).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-011', priority: 'P2', scenario: 'Admin désactive l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-011', priority: 'P2', scenario: 'Admin désactive l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-005 non disponible.', comment: 'Prérequis ADM-005 non disponible.', duration: 0 }))
  }

  // ADM-012
  if (userId) {
    const start = Date.now()
    try {
      const before = (await apiRequest(`/users/${userId}`, { token: adminToken })).data
      await ensureUserOnPage(page, userEmail)
      await page.click(`button[aria-label="Réactiver ${userModName}"]`)
      await confirmByText(page, 'Réactiver', '.admin-users-confirm-overlay')
      const after = (await apiRequest(`/users/${userId}`, { token: adminToken })).data
      const ok = before?.isActive === false && after?.isActive === true
      record(result({
        id: 'ADM-012', priority: 'P2', scenario: 'Admin réactive l’utilisateur', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Utilisateur réactivé depuis l’UI (avant=${before?.isActive}, après=${after?.isActive}).` : `avant=${before?.isActive}, après=${after?.isActive}`,
        error: ok ? '' : 'La réactivation ne s’est pas appuyée sur un état isActive=false.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-012', priority: 'P2', scenario: 'Admin réactive l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-012', priority: 'P2', scenario: 'Admin réactive l’utilisateur', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-005 non disponible.', comment: 'Prérequis ADM-005 non disponible.', duration: 0 }))
  }

  // ============ TYPES DE CONGÉS ============
  const typeName = `Type-UI-${stamp}`
  let typeId = null

  // ADM-014
  {
    const start = Date.now()
    try {
      await gotoHref(page, '/app/admin-leave-types')
      await page.click('.rh-leave-types-new')
      await page.waitForSelector('.rh-leave-types-form')
      await page.fill('label:has-text("Libellé") input', typeName)
      await page.selectOption('label:has-text("Catégorie") select', 'DEMANDE_CONGE')
      await page.getByRole('button', { name: 'Créer le type', exact: true }).click()
      await page.locator('.rh-leave-types-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const list = await apiRequest('/leave-types/management', { token: adminToken })
      const created = list.data?.find((t) => t.name === typeName)
      typeId = created?.id
      const ok = Boolean(created && created.category === 'DEMANDE_CONGE' && created.isActive)
      record(result({
        id: 'ADM-014', priority: 'P1', scenario: 'RH crée un type de congé', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Type créé depuis l’UI (id=${typeId}).` : 'Création UI/API non conforme.',
        error: ok ? '' : 'Type introuvable après création UI.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-014', priority: 'P1', scenario: 'RH crée un type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ADM-015
  if (typeId) {
    const start = Date.now()
    try {
      await page.locator('.rh-leave-types-row--body', { hasText: typeName }).click()
      await page.waitForSelector('.rh-leave-types-drawer')
      const newName = `Type-UI-MOD-${stamp}`
      await page.fill('label:has-text("Libellé") input', newName)
      await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click()
      await page.locator('.rh-leave-types-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const { data } = await apiRequest(`/leave-types/${typeId}`, { token: adminToken })
      const ok = data?.name === newName
      record(result({
        id: 'ADM-015', priority: 'P1', scenario: 'Admin modifie le type de congé', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Type modifié depuis l’UI (${data.name}).` : `Modification non persistée : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-015', priority: 'P1', scenario: 'Admin modifie le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-015', priority: 'P1', scenario: 'Admin modifie le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-014 non disponible.', comment: 'Prérequis ADM-014 non disponible.', duration: 0 }))
  }

  const typeNameMod = `Type-UI-MOD-${stamp}`

  // ADM-016
  if (typeId) {
    const start = Date.now()
    try {
      await page.click(`button[aria-label="Désactiver ${typeNameMod}"]`)
      await confirmByText(page, 'Désactiver', '.rh-leave-types-confirm-overlay')
      const { data } = await apiRequest(`/leave-types/${typeId}`, { token: adminToken })
      const ok = data?.isActive === false
      record(result({
        id: 'ADM-016', priority: 'P1', scenario: 'RH désactive le type de congé', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Type désactivé depuis l’UI (isActive=false).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-016', priority: 'P1', scenario: 'RH désactive le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-016', priority: 'P1', scenario: 'RH désactive le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-014 non disponible.', comment: 'Prérequis ADM-014 non disponible.', duration: 0 }))
  }

  // ADM-017
  if (typeId) {
    const start = Date.now()
    try {
      await page.locator('.rh-leave-types-row--body', { hasText: typeNameMod }).click()
      await page.waitForSelector('.rh-leave-types-drawer')
      await page.click('.rh-leave-types-status-toggle')
      await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click()
      await page.locator('.rh-leave-types-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const { data } = await apiRequest(`/leave-types/${typeId}`, { token: adminToken })
      const ok = data?.isActive === true
      record(result({
        id: 'ADM-017', priority: 'P1', scenario: 'RH réactive le type de congé', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Type réactivé depuis l’UI (isActive=true).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Réactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-017', priority: 'P1', scenario: 'RH réactive le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-017', priority: 'P1', scenario: 'RH réactive le type de congé', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-014 non disponible.', comment: 'Prérequis ADM-014 non disponible.', duration: 0 }))
  }

  // ============ FERMETURES ============
  const closureDate = await pickFreeClosureDate(adminToken)
  const closureName = `Fermeture-UI-${stamp}`
  let closureId = null

  // ADM-018
  {
    const start = Date.now()
    try {
      await gotoHref(page, '/app/admin-holidays')
      await page.click('.rh-holidays-add')
      await page.waitForSelector('.rh-holidays-form')
      await page.fill('label:has-text("Désignation") input', closureName)
      await page.fill('label:has-text("Date de fermeture") input', closureDate)
      await page.getByRole('button', { name: 'Enregistrer la fermeture', exact: true }).click()
      await page.locator('.rh-holidays-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const list = await apiRequest('/holidays/management', { token: adminToken })
      const created = list.data?.find((h) => h.date === closureDate && h.name === closureName)
      closureId = created?.id
      const ok = Boolean(created && created.holidayType === 'FERMETURE_GMES' && created.isActive)
      record(result({
        id: 'ADM-018', priority: 'P1', scenario: 'RH crée une fermeture GMES', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Fermeture créée depuis l’UI (id=${closureId}).` : 'Création UI/API non conforme.',
        error: ok ? '' : 'Fermeture introuvable après création UI.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-018', priority: 'P1', scenario: 'RH crée une fermeture GMES', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  }

  // ADM-019
  if (closureId) {
    const start = Date.now()
    try {
      await page.locator('.rh-holidays-row--body', { hasText: closureName }).click()
      await page.waitForSelector('.rh-holidays-drawer')
      const newName = `Fermeture-UI-MOD-${stamp}`
      await page.fill('label:has-text("Désignation") input', newName)
      await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click()
      await page.locator('.rh-holidays-overlay').waitFor({ state: 'hidden', timeout: 8000 })

      const { data } = await apiRequest(`/holidays/${closureId}`, { token: adminToken })
      const ok = data?.name === newName
      record(result({
        id: 'ADM-019', priority: 'P1', scenario: 'RH modifie la fermeture', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? `Fermeture modifiée depuis l’UI (${data.name}).` : `Modification non persistée : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Modification UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-019', priority: 'P1', scenario: 'RH modifie la fermeture', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-019', priority: 'P1', scenario: 'RH modifie la fermeture', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-018 non disponible.', comment: 'Prérequis ADM-018 non disponible.', duration: 0 }))
  }

  const closureNameMod = `Fermeture-UI-MOD-${stamp}`

  // ADM-020
  if (closureId) {
    const start = Date.now()
    try {
      await page.locator('.rh-holidays-row--body', { hasText: closureNameMod }).locator('button[title="Supprimer la fermeture"]').click()
      await confirmByText(page, 'Supprimer', '.rh-holidays-confirm-overlay')
      const { data } = await apiRequest(`/holidays/${closureId}`, { token: adminToken })
      const ok = data?.isActive === false
      record(result({
        id: 'ADM-020', priority: 'P1', scenario: 'RH désactive la fermeture', type: 'C - Mixte UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: ok ? 'Fermeture désactivée depuis l’UI (isActive=false).' : `État inattendu : ${JSON.stringify(data)}`,
        error: ok ? '' : 'Désactivation UI non persistée.',
        duration: Date.now() - start,
      }))
    } catch (error) {
      record(result({ id: 'ADM-020', priority: 'P1', scenario: 'RH désactive la fermeture', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: error.message, error: error.message, duration: Date.now() - start }))
    }
  } else {
    record(result({ id: 'ADM-020', priority: 'P1', scenario: 'RH désactive la fermeture', type: 'C - Mixte UI + API', status: STATUS.BLOQUE, resultText: 'Prérequis ADM-018 non disponible.', comment: 'Prérequis ADM-018 non disponible.', duration: 0 }))
  }

  // ADM-021 — anomalie produit confirmée, non rejouée.
  record(result({
    id: 'ADM-021',
    priority: 'P1',
    scenario: 'RH réactive la fermeture',
    type: 'C - Mixte UI + API',
    status: STATUS.NON_CONFORME,
    resultText: 'Aucune action de réactivation de fermeture disponible dans l’UI.',
    error: 'Fonctionnalité UI manquante : réactivation de fermeture GMES.',
    comment: 'ANO-007',
    duration: 0,
  }))

  await browser.close()

  writeReport(results, { label: 'recette-results-adm-ui' })

  console.log('')
  console.log(`ADM UI terminé en ${Date.now() - startedAt.getTime()} ms`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
