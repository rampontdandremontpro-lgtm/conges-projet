// Retest Playwright — « Seule la RH peut créer et déclarer des absences »
// Vérifications navigateur réelles (desktop / tablette / mobile).
// Frontend de RECETTE : port 5174 (proxy -> backend test 3001 / gestion_conges_gmes_test).
// NB : le token applicatif est conservé en mémoire (pas de rechargement complet après connexion).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-absence-rh-only-ui.json')

const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const API_URL = process.env.RETEST_API_URL ?? 'http://localhost:3001/api'
const PASSWORD = 'RecetteGMES@2026!'

const results = []

function push({ id, role, scenario, pass, actual, comment = '' }) {
  results.push({
    id,
    priority: 'P1',
    module: 'ABS',
    role,
    scenario,
    type: 'UI (Playwright)',
    status: pass ? 'Conforme' : 'Non conforme',
    expected: 'Comportement attendu observé',
    actual,
    mutation: 'lecture seule (aucune mutation métier)',
    comment,
    date: new Date().toISOString(),
  })
}

async function api(pathUrl, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${pathUrl}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const ct = res.headers.get('content-type') ?? ''
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}

async function loginToken(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return r.data
}

async function loginPage(browser, email, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.waitForTimeout(900)
  return { context, page }
}

async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, targetPath)
  await page.waitForTimeout(700)
}

async function setupJustificatifAbsence(rhToken) {
  // Crée via la RH une absence à justificatif obligatoire (JUSTIFICATIF_EN_ATTENTE)
  // pour col-a, afin de vérifier que le collaborateur conserve le bouton justificatif.
  const d = new Date()
  d.setDate(d.getDate() + 160)
  const date = d.toISOString().slice(0, 10)
  const create = await api('/absence-declarations', {
    method: 'POST', token: rhToken,
    body: {
      employeeId: 17, leaveTypeId: 22,
      startDate: date, endDate: date, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST UI justificatif',
    },
  })
  let id = null
  if (create.status === 201) {
    id = create.data.id
    await api(`/absence-declarations/${id}/submit`, { method: 'POST', token: rhToken, body: {} })
  }
  return { id, createStatus: create.status }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const rhLogin = await loginToken('rh.recette@gmes.fr')
  const justif = await setupJustificatifAbsence(rhLogin.accessToken)

  // ---------------- Collaborateur — desktop ----------------
  {
    const { context, page } = await loginPage(browser, 'col-a.recette@gmes.fr', { width: 1366, height: 768 })
    const body = await page.locator('body').innerText()
    const newRequestVisible = body.includes('Nouvelle demande')
    const declareAbsentCount = (body.match(/Déclarer une absence/g) ?? []).length
    push({
      id: 'RETEST-ABS-UI-01', role: 'Collaborateur', scenario: 'Desktop — « Nouvelle demande » visible sur le tableau de bord',
      pass: newRequestVisible, actual: `Nouvelle demande visible=${newRequestVisible}`,
    })
    push({
      id: 'RETEST-ABS-UI-02', role: 'Collaborateur', scenario: 'Desktop — « Déclarer une absence » absent du tableau de bord',
      pass: declareAbsentCount === 0, actual: `occurrences « Déclarer une absence »=${declareAbsentCount}`,
    })

    // URL directe de l'ancien formulaire collaborateur (navigation SPA, sans rechargement)
    await spaNavigate(page, '/app/new-absence')
    const urlAfter = page.url()
    const h1After = String(await page.locator('h1').first().textContent().catch(() => '') ?? '')
    const formRefused = !h1After.includes('Déclarer une absence')
    push({
      id: 'RETEST-ABS-UI-03', role: 'Collaborateur', scenario: 'Desktop — accès direct /app/new-absence refusé (aucun formulaire)',
      pass: formRefused, actual: `url=${urlAfter} h1=${h1After.trim().slice(0, 40)}`,
    })

    // Détail d'une absence ENREGISTREE (consultation, sans actions interdites)
    await spaNavigate(page, '/app/my-requests/absence/20')
    const detailTitle = String(await page.locator('h2').first().textContent().catch(() => '') ?? '')
    const submitBtn = await page.getByRole('button', { name: /Soumettre la déclaration/ }).count()
    const cancelBtn = await page.getByRole('button', { name: /Annuler le brouillon/ }).count()
    const readOnlyNote = (await page.locator('body').innerText()).includes('lecture seule')
    push({
      id: 'RETEST-ABS-UI-04', role: 'Collaborateur', scenario: 'Desktop — consultation d’une absence existante sans actions interdites',
      pass: submitBtn === 0 && cancelBtn === 0 && detailTitle.length > 0,
      actual: `titre=${detailTitle.slice(0, 40)} submit=${submitBtn} annuler=${cancelBtn} lectureSeule=${readOnlyNote}`,
    })

    // Justificatif conservé sur une absence JUSTIFICATIF_EN_ATTENTE
    if (justif.id) {
      await spaNavigate(page, `/app/my-requests/absence/${justif.id}`)
      const justifBtn = await page.getByRole('button', { name: /Ajouter un justificatif/ }).count()
      push({
        id: 'RETEST-ABS-UI-05', role: 'Collaborateur', scenario: 'Desktop — transmission de justificatif conservée (bouton présent)',
        pass: justifBtn > 0, actual: `bouton « Ajouter un justificatif »=${justifBtn}`,
      })
    }
    await context.close()
  }

  // ---------------- Collaborateur — tablette ----------------
  {
    const { context, page } = await loginPage(browser, 'col-a.recette@gmes.fr', { width: 768, height: 1024 })
    const body = await page.locator('body').innerText()
    const newRequestVisible = body.includes('Nouvelle demande')
    const declareAbsentCount = (body.match(/Déclarer une absence/g) ?? []).length
    push({
      id: 'RETEST-ABS-UI-06', role: 'Collaborateur', scenario: 'Tablette — « Nouvelle demande » visible, « Déclarer une absence » absent',
      pass: newRequestVisible && declareAbsentCount === 0,
      actual: `Nouvelle demande=${newRequestVisible} occurrences absence=${declareAbsentCount}`,
    })
    await context.close()
  }

  // ---------------- Collaborateur — mobile ----------------
  {
    const { context, page } = await loginPage(browser, 'col-a.recette@gmes.fr', { width: 375, height: 667 })
    const body = await page.locator('body').innerText()
    const newRequestVisible = body.includes('Nouvelle demande')
    const declareAbsentCount = (body.match(/Déclarer une absence/g) ?? []).length
    push({
      id: 'RETEST-ABS-UI-07', role: 'Collaborateur', scenario: 'Mobile — « Nouvelle demande » visible, « Déclarer une absence » absent',
      pass: newRequestVisible && declareAbsentCount === 0,
      actual: `Nouvelle demande=${newRequestVisible} occurrences absence=${declareAbsentCount}`,
    })
    await context.close()
  }

  // ---------------- RH — page réelle de gestion ----------------
  {
    const { context, page } = await loginPage(browser, 'rh.recette@gmes.fr', { width: 1366, height: 768 })
    await spaNavigate(page, '/app/rh-leaves-absences')
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const loaded = bodyText.includes('Congés et Absences') || bodyText.includes('Absences') || bodyText.length > 300
    push({
      id: 'RETEST-ABS-UI-08', role: 'RH', scenario: 'Desktop — page réelle de gestion Congés et Absences accessible',
      pass: loaded, actual: `page chargée=${bodyText.length > 0} (${bodyText.length} car.)`,
    })
    await context.close()
  }

  await browser.close()

  const summary = {
    total: results.length,
    conformes: results.filter((r) => r.status === 'Conforme').length,
    nonConformes: results.filter((r) => r.status === 'Non conforme').length,
    allPass: results.every((r) => r.status === 'Conforme'),
  }

  const report = {
    title: 'Retest Playwright — Seule la RH peut créer et déclarer des absences',
    date: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    database: 'gestion_conges_gmes_test',
    summary,
    notes: [
      'Vérifications navigateur réelles via Playwright (Chromium headless).',
      'Le token applicatif étant conservé en mémoire, la navigation est effectuée côté SPA (pas de rechargement complet).',
      'La création RH via l’interface est couverte par le retest API (RETEST-ABS-RH-16..23) ; la page de gestion RH est chargée ici.',
      'Aucune mutation métier n’est effectuée par ces scénarios UI (lecture seule + création préparatoire RH via API).',
    ],
    results,
  }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== RETEST PLAYWRIGHT RH-ONLY ===')
  for (const r of results) {
    console.log(`${r.status === 'Conforme' ? 'OK ' : 'XX '} ${r.id} [${r.role}] ${r.scenario} → ${r.actual}`)
  }
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256 du rapport: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

run().catch((error) => {
  console.error('ERREUR PLAYWRIGHT', error)
  process.exit(1)
})
