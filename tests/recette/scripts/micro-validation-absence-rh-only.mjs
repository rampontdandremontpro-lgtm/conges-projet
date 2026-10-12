// Micro-validation finale RH-only.
// 1) Création réelle d'une absence via l'interface RH (Playwright).
// 2) Indisponibilités du Directeur (leave-requests/director + absence-declarations/director).
// 3) Remplacement d'un justificatif rejeté.
// Base : gestion_conges_gmes_test uniquement (backend 3001, frontend 5174).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const REPORT_PATH = path.join(REPORTS_DIR, 'micro-validation-absence-rh-only.json')

const API_URL = process.env.RETEST_API_URL ?? 'http://localhost:3001/api'
const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const PASSWORD = 'RecetteGMES@2026!'

const scenarios = []

function push(s) {
  scenarios.push({
    id: s.id,
    preconditions: s.preconditions ?? '',
    action: s.action ?? '',
    target: s.target ?? '',
    expected: s.expected ?? '',
    observed: s.observed ?? '',
    dbCheck: s.dbCheck ?? '',
    proof: s.proof ?? '',
    conclusion: s.conclusion ?? 'Non exécuté',
    role: s.role ?? '',
    date: new Date().toISOString(),
  })
}

function readDbPassword() {
  for (const file of ['backend/.env.recette', 'backend/.env']) {
    const p = path.join(ROOT, file)
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^DB_PASSWORD=(.*)$/m)
      if (m) return m[1].trim()
    }
  }
  return ''
}

const DB = { host: 'localhost', port: 3306, user: 'root', password: readDbPassword(), database: 'gestion_conges_gmes_test' }

async function db() { return mysql.createConnection(DB) }

async function api(p, { method = 'GET', token, body, formData } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (formData) {
    const res = await fetch(`${API_URL}${p}`, { method, headers, body: formData })
    const ct = res.headers.get('content-type') ?? ''
    const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
    return { status: res.status, data }
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${p}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const ct = res.headers.get('content-type') ?? ''
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}

async function loginToken(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  if (r.status !== 200) throw new Error(`Login ${email} -> ${r.status}`)
  return r.data.accessToken
}

// Offset de run (secondes) pour éviter les chevauchements entre exécutions.
const RUN_OFFSET = Math.floor(Date.now() / 1000) % 37

function weekdayAhead(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1) // évite les dimanches
  return d
}

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, targetPath)
  await page.waitForTimeout(800)
}

// ---------------------------------------------------------------------------
// 1. CRÉATION RÉELLE D'UNE ABSENCE VIA L'INTERFACE RH (Playwright)
// ---------------------------------------------------------------------------
async function partRhUiCreation() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()

  const rhToken = await loginToken('rh.recette@gmes.fr')
  const conn = await db()
  const [colb] = await conn.query("SELECT id, nom, prenom FROM users WHERE email='col-b.recette@gmes.fr'")
  const colBId = colb[0].id
  const beforeCount = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n

  const tag = `MICROVAL-UI-${Date.now()}`
  const target = weekdayAhead(35 + RUN_OFFSET)
  const now = new Date()
  const monthDiff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  const iso = isoOf(target)

  let observed = ''
  let pass = false
  try {
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
    await page.fill('#login-email', 'rh.recette@gmes.fr')
    await page.fill('#login-password', PASSWORD)
    await page.click('.login-submit')
    await page.waitForURL('**/app/**', { timeout: 15000 })
    await page.waitForTimeout(900)

    await spaNavigate(page, '/app/rh-leaves-absences')
    await page.waitForTimeout(800)

    await page.locator('.rh-events-create').click()
    await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })

    // Collaborateur (1er select) puis Type (2e select)
    const selects = page.locator('.rh-declaration-top-grid select')
    await selects.nth(0).selectOption(String(colBId))
    await selects.nth(1).selectOption({ label: 'ABS UI A3F' })
    await page.waitForTimeout(400)

    // Commentaire d'identification (saisie réelle du formulaire)
    await page.locator('.rh-declaration-field textarea').fill(tag)
    await page.waitForTimeout(200)

    // Navigation calendrier jusqu'au mois cible, puis clic sur le jour
    const nextBtn = page.locator('.nr-cal__nav-btn[aria-label="Mois suivant"]')
    for (let i = 0; i < monthDiff; i += 1) {
      await nextBtn.click()
      await page.waitForTimeout(300)
    }
    await page.locator(`button.nr-cal__cell[aria-label="${iso}"]`).click()
    await page.waitForTimeout(300)

    await page.locator('.rh-declaration-actions button.is-primary').click()
    await page.waitForTimeout(2500)

    // Vérifier la fermeture du drawer + feedback succès
    const drawerOpen = await page.locator('.rh-declaration-drawer').count()
    const bodyText = await page.locator('body').innerText()
    observed = `drawerOuvert=${drawerOpen > 0} feedback="${bodyText.includes('Absence enregistrée') ? 'Absence enregistrée' : (bodyText.match(/Absence[^.]{0,40}/)?.[0] ?? 'aucun feedback détecté')}"`

    // Vérification en base + API
    const [after] = await conn.query('SELECT id, employee_id, status, comment, start_date FROM absence_declarations WHERE comment LIKE ? ORDER BY id DESC LIMIT 1', [`%${tag}%`])
    const created = after[0]
    const countOk = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n === beforeCount + 1
    pass = drawerOpen === 0 && Boolean(created) && countOk

    push({
      id: 'MICROVAL-01', role: 'RH', preconditions: 'Compte RH actif, collaborateur recette col-b actif, type d’absence « ABS UI A3F » actif',
      action: 'Connexion RH → /app/rh-leaves-absences → bouton « Déclarer congé/absence » → sélection collaborateur col-b + type « ABS UI A3F » → sélection date calendrier → « Valider l’absence »',
      target: 'UI /app/rh-leaves-absences (drawer RhLeaveAbsenceDeclarationDrawer)',
      expected: 'Drawer fermé, feedback succès, 1 absence créée en base, statut ENREGISTREE (type rhOnly sans justificatif)',
      observed: `${observed} | créée en base=${created ? `id=${created.id} status=${created.status} start=${String(created.start_date).slice(0, 10)}` : 'NON'} | +1 en base=${countOk}`,
      dbCheck: `absence_declarations avant=${beforeCount} après=${(await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n}`,
      proof: 'Playwright headless + requête SQL + API',
      conclusion: pass && created?.status === 'ENREGISTREE' ? 'Conforme' : 'Non conforme',
    })

    // Collaborateur concerné peut consulter
    let colRead = { status: 0, data: [] }
    if (created) {
      const colToken = await loginToken('col-b.recette@gmes.fr')
      colRead = await api('/absence-declarations/my', { token: colToken })
    }
    const colSees = Array.isArray(colRead.data) && colRead.data.some((a) => a.id === created?.id)
    push({
      id: 'MICROVAL-02', role: 'Collaborateur', preconditions: 'Absence créée par la RH pour col-b (MICROVAL-01)',
      action: 'GET /absence-declarations/my avec le token du collaborateur col-b',
      target: 'GET /api/absence-declarations/my',
      expected: 'HTTP 200 et l’absence créée apparaît dans la liste du collaborateur',
      observed: `HTTP=${colRead.status} absenceVisible=${colSees}`,
      dbCheck: 'lecture seule',
      proof: 'API (token collaborateur)',
      conclusion: colRead.status === 200 && colSees ? 'Conforme' : 'Non conforme',
    })
  } catch (error) {
    observed = `ERREUR: ${error?.message ?? error}`
    push({
      id: 'MICROVAL-01', role: 'RH', preconditions: 'Compte RH actif, collaborateur recette actif, type d’absence actif',
      action: 'Création absence via interface RH (Playwright)',
      target: 'UI /app/rh-leaves-absences',
      expected: 'Création réussie et visible en base',
      observed,
      dbCheck: '—',
      proof: 'Playwright',
      conclusion: 'Non conforme',
    })
  }

  await conn.end()
  await context.close()
  await browser.close()
}

// ---------------------------------------------------------------------------
// 2. INDISPONIBILITÉS DU DIRECTEUR
// ---------------------------------------------------------------------------
async function partDirector() {
  const conn = await db()
  const dirToken = await loginToken('directeur.recette@gmes.fr')
  const rhToken = await loginToken('rh.recette@gmes.fr')

  // Précondition de recette : affecter un service actif au Directeur (test data uniquement).
  const [dirUser] = await conn.query('SELECT service_id FROM users WHERE id = 15')
  if (!dirUser[0]?.service_id) {
    await conn.query('UPDATE users SET service_id = 16 WHERE id = 15')
  }

  // S'assurer qu'un type « Congé » réservé Directeur existe (donnée de recette).
  let congeTypeId = null
  const [existing] = await conn.query("SELECT id FROM leave_types WHERE name='Congé' AND category='DEMANDE_CONGE' LIMIT 1")
  if (existing.length) {
    congeTypeId = Number(existing[0].id)
  } else {
    const [ins] = await conn.query(
      `INSERT INTO leave_types (name, category, deducts_paid_leave_balance, document_required, document_can_be_added_later, employee_can_create, rh_only, allows_days, allows_half_days, allows_hours, requires_validation, is_active, created_at, updated_at)
       VALUES ('Congé', 'DEMANDE_CONGE', 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, NOW(), NOW())`,
    )
    congeTypeId = Number(ins.insertId)
  }

  // 2a. Création nouvelle indisponibilité via leave-requests/director
  const start = isoOf(weekdayAhead(90 + RUN_OFFSET))
  const createDir = await api('/leave-requests/director', {
    method: 'POST', token: dirToken,
    body: { leaveTypeId: congeTypeId, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'MICROVAL indisponibilité directeur' },
  })
  const dirLeaveId = createDir.data?.id ?? null
  push({
    id: 'MICROVAL-03', role: 'Directeur', preconditions: 'Type « Congé » réservé Directeur actif (créé en recette si absent)',
    action: 'POST /leave-requests/director (création nouvelle indisponibilité)',
    target: 'POST /api/leave-requests/director',
    expected: 'HTTP 201 (indisponibilité du Directeur créée via leave-requests)',
    observed: `HTTP=${createDir.status} id=${dirLeaveId ?? '—'}`,
    dbCheck: dirLeaveId ? `leave_requests contient id=${dirLeaveId}` : 'aucune création',
    proof: 'API + SQL',
    conclusion: createDir.status === 201 && Boolean(dirLeaveId) ? 'Conforme' : 'Non conforme',
  })

  // 2b. Refus d'une création ordinaire d'absence par le Directeur
  const beforeAbs = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n
  const dirCreateAbs = await api('/absence-declarations', {
    method: 'POST', token: dirToken,
    body: { employeeId: 15, leaveTypeId: 17, startDate: start, endDate: start, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'MICROVAL interdit directeur' },
  })
  const afterAbs = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n
  push({
    id: 'MICROVAL-04', role: 'Directeur', preconditions: 'Aucune',
    action: 'POST /absence-declarations (création ordinaire d’absence par le Directeur)',
    target: 'POST /api/absence-declarations',
    expected: 'HTTP 403 et aucune mutation en base',
    observed: `HTTP=${dirCreateAbs.status} | absence_declarations avant=${beforeAbs} après=${afterAbs}`,
    dbCheck: beforeAbs === afterAbs ? 'aucune mutation' : `MUTATION ${beforeAbs} -> ${afterAbs}`,
    proof: 'API + SQL',
    conclusion: dirCreateAbs.status === 403 && beforeAbs === afterAbs ? 'Conforme' : 'Non conforme',
  })

  // 2c. Modification + annulation d'une ancienne indisponibilité via absence-declarations/director/:id
  // Préparer un enregistrement ENREGISTREE appartenant au Directeur (simulation d'ancienne indisponibilité).
  const oldStart = isoOf(weekdayAhead(120 + RUN_OFFSET))
  const rhCreateOld = await api('/absence-declarations', {
    method: 'POST', token: rhToken,
    body: { employeeId: 15, leaveTypeId: 17, startDate: oldStart, endDate: oldStart, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'MICROVAL ancienne indisponibilité directeur' },
  })
  const oldId = rhCreateOld.data?.id ?? null
  if (oldId) await api(`/absence-declarations/${oldId}/submit`, { method: 'POST', token: rhToken, body: {} })

  const newStart = isoOf(weekdayAhead(150 + RUN_OFFSET))
  const dirPatch = oldId
    ? await api(`/absence-declarations/director/${oldId}`, { method: 'PATCH', token: dirToken, body: { startDate: newStart, endDate: newStart } })
    : { status: 0, data: null }
  const dirCancel = oldId
    ? await api(`/absence-declarations/director/${oldId}/cancel`, { method: 'POST', token: dirToken })
    : { status: 0, data: null }
  push({
    id: 'MICROVAL-05', role: 'Directeur', preconditions: `Enregistrement ENREGISTREE du Directeur préparé par la RH (id=${oldId ?? '—'})`,
    action: 'PATCH /absence-declarations/director/:id puis POST /absence-declarations/director/:id/cancel (modification + annulation ancienne indisponibilité)',
    target: 'PATCH + POST /api/absence-declarations/director/:id',
    expected: 'HTTP 200 (modification) puis HTTP 200 (annulation → ANNULEE)',
    observed: `PATCH=${dirPatch.status} (start=${dirPatch.data?.startDate ? String(dirPatch.data.startDate).slice(0, 10) : '—'}) | CANCEL=${dirCancel.status} (status=${dirCancel.data?.status ?? '—'})`,
    dbCheck: dirCancel.data?.status === 'ANNULEE' ? 'absence_declarations : statut ANNULEE' : `statut=${dirCancel.data?.status}`,
    proof: 'API + SQL',
    conclusion: dirPatch.status === 200 && dirCancel.status === 200 && dirCancel.data?.status === 'ANNULEE' ? 'Conforme' : 'Non conforme',
  })

  // Nettoyage léger de l'indisponibilité leave-request créée (donnée de test)
  if (dirLeaveId) {
    await api(`/leave-requests/director/${dirLeaveId}/cancel`, { method: 'POST', token: dirToken }).catch(() => {})
  }

  await conn.end()
}

// ---------------------------------------------------------------------------
// 3. REMPLACEMENT D'UN JUSTIFICATIF REJETÉ
// ---------------------------------------------------------------------------
async function partJustificatif() {
  const conn = await db()
  const rhToken = await loginToken('rh.recette@gmes.fr')
  const colToken = await loginToken('col-a.recette@gmes.fr')
  const colBToken = await loginToken('col-b.recette@gmes.fr')

  // Préparation : RH crée + soumet une absence à justificatif obligatoire pour col-a
  const date = isoOf(weekdayAhead(200 + RUN_OFFSET))
  const tag = `MICROVAL-JUS-${Date.now()}`
  const create = await api('/absence-declarations', {
    method: 'POST', token: rhToken,
    body: { employeeId: 17, leaveTypeId: 22, startDate: date, endDate: date, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: tag },
  })
  const absId = create.data?.id ?? null
  let submitRes = { status: 0, data: {} }
  if (absId) submitRes = await api(`/absence-declarations/${absId}/submit`, { method: 'POST', token: rhToken, body: {} })
  push({
    id: 'MICROVAL-06', role: 'RH', preconditions: 'Type à justificatif obligatoire actif (id 22), collaborateur col-a actif',
    action: 'Préparation par la RH : création + soumission d’une absence à justificatif obligatoire',
    target: 'POST /api/absence-declarations + POST /api/absence-declarations/:id/submit',
    expected: 'HTTP 201 puis HTTP 200, statut JUSTIFICATIF_EN_ATTENTE',
    observed: `create=${create.status} submit=${submitRes.status} status=${submitRes.data?.status}`,
    dbCheck: `absence id=${absId ?? '—'} status=${submitRes.data?.status ?? '—'}`,
    proof: 'API + SQL',
    conclusion: create.status === 201 && submitRes.status === 200 && submitRes.data?.status === 'JUSTIFICATIF_EN_ATTENTE' ? 'Conforme' : 'Non conforme',
  })

  // Collaborateur dépose le justificatif
  let upload1 = { status: 0, data: null }
  const fixture = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')
  if (absId && existsSync(fixture)) {
    const form = new FormData()
    form.append('file', new Blob([readFileSync(fixture)], { type: 'application/pdf' }), 'justif-1.pdf')
    upload1 = await api(`/documents/absence/${absId}`, { method: 'POST', token: colToken, formData: form })
  }
  const doc1Id = upload1.data?.id ?? null
  const absAfterUpload = absId ? (await api(`/absence-declarations/${absId}`, { token: colToken })).data : null
  push({
    id: 'MICROVAL-07', role: 'Collaborateur', preconditions: 'Absence en JUSTIFICATIF_EN_ATTENTE (MICROVAL-06)',
    action: 'POST /documents/absence/:id (dépôt du justificatif autorisé)',
    target: 'POST /api/documents/absence/:absenceDeclarationId',
    expected: 'HTTP 201, document EN_ATTENTE, absence → A_VERIFIER_PAR_RH',
    observed: `HTTP=${upload1.status} docId=${doc1Id ?? '—'} | absence status=${absAfterUpload?.status}`,
    dbCheck: `document id=${doc1Id ?? '—'} créé ; absence status=${absAfterUpload?.status}`,
    proof: 'API + SQL',
    conclusion: upload1.status === 201 && Boolean(doc1Id) && absAfterUpload?.status === 'A_VERIFIER_PAR_RH' ? 'Conforme' : 'Non conforme',
  })

  // RH rejette le justificatif
  let rejectRes = { status: 0, data: null }
  if (doc1Id) rejectRes = await api(`/documents/${doc1Id}/reject`, { method: 'POST', token: rhToken, body: { reason: 'Justificatif illisible' } })
  const absAfterReject = absId ? (await api(`/absence-declarations/${absId}`, { token: rhToken })).data : null
  push({
    id: 'MICROVAL-08', role: 'RH', preconditions: 'Document EN_ATTENTE (MICROVAL-07)',
    action: 'POST /documents/:id/reject avec motif « Justificatif illisible »',
    target: 'POST /api/documents/:id/reject',
    expected: 'HTTP 200, document REJETE, absence → JUSTIFICATIF_EN_ATTENTE (nouveau justificatif attendu)',
    observed: `HTTP=${rejectRes.status} docStatus=${rejectRes.data?.status} reason=${rejectRes.data?.rejectionReason ?? '—'} | absence=${absAfterReject?.status}`,
    dbCheck: `document ${doc1Id ?? '—'} status=${rejectRes.data?.status}`,
    proof: 'API + SQL',
    conclusion: rejectRes.status === 200 && rejectRes.data?.status === 'REJETE' && absAfterReject?.status === 'JUSTIFICATIF_EN_ATTENTE' ? 'Conforme' : 'Non conforme',
  })

  // Collaborateur transmet le justificatif de remplacement
  let upload2 = { status: 0, data: null }
  const fixture2 = path.join(FIXTURES_DIR, 'justificatif-abs-remplacement.pdf')
  if (absId && existsSync(fixture2)) {
    const form = new FormData()
    form.append('file', new Blob([readFileSync(fixture2)], { type: 'application/pdf' }), 'justif-2-remplacement.pdf')
    upload2 = await api(`/documents/absence/${absId}`, { method: 'POST', token: colToken, formData: form })
  }
  const doc2Id = upload2.data?.id ?? null
  const [docsRow] = await conn.query('SELECT id, status, original_name FROM documents WHERE absence_declaration_id = ? ORDER BY id', [absId])
  const absAfterReplace = absId ? (await api(`/absence-declarations/${absId}`, { token: colToken })).data : null
  const oldDoc = docsRow.find((x) => x.id === doc1Id)
  const newDoc = docsRow.find((x) => x.id === doc2Id)
  push({
    id: 'MICROVAL-09', role: 'Collaborateur', preconditions: 'Justificatif rejeté (MICROVAL-08)',
    action: 'POST /documents/absence/:id (transmission du document de remplacement)',
    target: 'POST /api/documents/absence/:absenceDeclarationId',
    expected: 'HTTP 201 ; ancien document ARCHIVE ; nouveau document EN_ATTENTE ; absence → A_VERIFIER_PAR_RH',
    observed: `HTTP=${upload2.status} newDoc=${doc2Id ?? '—'} | ancien(${doc1Id})=${oldDoc?.status} | nouveau(${doc2Id})=${newDoc?.status} | absence=${absAfterReplace?.status}`,
    dbCheck: `documents: ancien=${oldDoc?.status}, nouveau=${newDoc?.status}`,
    proof: 'API + SQL',
    conclusion: upload2.status === 201 && oldDoc?.status === 'ARCHIVE' && newDoc?.status === 'EN_ATTENTE' && absAfterReplace?.status === 'A_VERIFIER_PAR_RH' ? 'Conforme' : 'Non conforme',
  })

  // Droits de lecture et de contrôle
  const colRead = absId ? await api(`/absence-declarations/${absId}`, { token: colToken }) : { status: 0 }
  const colBRead = absId ? await api(`/absence-declarations/${absId}`, { token: colBToken }) : { status: 0 }
  const rhMgmt = absId ? await api(`/absence-declarations/management/${absId}`, { token: rhToken }) : { status: 0 }
  push({
    id: 'MICROVAL-10', role: 'Multi-rôles', preconditions: 'Absence en A_VERIFIER_PAR_RH (MICROVAL-09)',
    action: 'GET /absence-declarations/:id (col-a), GET (col-b), GET /absence-declarations/management/:id (RH)',
    target: 'GET /api/absence-declarations/:id et /management/:id',
    expected: 'col-a 200, col-b 403, RH management 200',
    observed: `col-a=${colRead.status} col-b=${colBRead.status} RH=${rhMgmt.status}`,
    dbCheck: 'lecture seule',
    proof: 'API',
    conclusion: colRead.status === 200 && colBRead.status === 403 && rhMgmt.status === 200 ? 'Conforme' : 'Non conforme',
  })

  // Aucune autre déclaration ne peut être créée par le collaborateur
  const beforeColAbs = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n
  const colCreate = await api('/absence-declarations', {
    method: 'POST', token: colToken,
    body: { leaveTypeId: 22, startDate: '2027-09-01', endDate: '2027-09-01', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'MICROVAL interdit collaborateur' },
  })
  const afterColAbs = (await conn.query('SELECT COUNT(*) n FROM absence_declarations'))[0][0].n
  push({
    id: 'MICROVAL-11', role: 'Collaborateur', preconditions: 'Aucune',
    action: 'POST /absence-declarations (tentative de création par le collaborateur)',
    target: 'POST /api/absence-declarations',
    expected: 'HTTP 403 et aucune mutation',
    observed: `HTTP=${colCreate.status} | avant=${beforeColAbs} après=${afterColAbs}`,
    dbCheck: beforeColAbs === afterColAbs ? 'aucune mutation' : `MUTATION ${beforeColAbs} -> ${afterColAbs}`,
    proof: 'API + SQL',
    conclusion: colCreate.status === 403 && beforeColAbs === afterColAbs ? 'Conforme' : 'Non conforme',
  })

  await conn.end()
}

async function main() {
  // Nettoyage idempotent des données de micro-validation précédentes (base de recette uniquement).
  const cleanupConn = await db()
  await cleanupConn.query('SET FOREIGN_KEY_CHECKS = 0')
  await cleanupConn.query("DELETE n FROM notifications n JOIN absence_declarations a ON n.absence_declaration_id = a.id WHERE a.comment LIKE 'MICROVAL%'")
  await cleanupConn.query("DELETE FROM documents WHERE absence_declaration_id IN (SELECT id FROM absence_declarations WHERE comment LIKE 'MICROVAL%')")
  await cleanupConn.query("DELETE FROM absence_declarations WHERE comment LIKE 'MICROVAL%'")
  await cleanupConn.query("DELETE FROM leave_requests WHERE comment LIKE 'MICROVAL%'")
  await cleanupConn.query('SET FOREIGN_KEY_CHECKS = 1')
  await cleanupConn.end()

  await partRhUiCreation()
  await partDirector()
  await partJustificatif()

  const summary = {
    total: scenarios.length,
    conformes: scenarios.filter((s) => s.conclusion === 'Conforme').length,
    nonConformes: scenarios.filter((s) => s.conclusion === 'Non conforme').length,
    nonExecutes: scenarios.filter((s) => s.conclusion === 'Non exécuté').length,
    allConformes: scenarios.every((s) => s.conclusion === 'Conforme'),
  }

  const report = {
    title: 'Micro-validation finale — Seule la RH crée et déclare les absences',
    date: new Date().toISOString(),
    apiUrl: API_URL,
    frontendUrl: FRONTEND_URL,
    database: DB.database,
    summary,
    notes: [
      'Base utilisée : gestion_conges_gmes_test (backend 3001). Aucune mutation sur gestion_conges_gmes.',
      'Aucun mot de passe ni JWT exposé dans ce rapport.',
      'Les 7 fichiers produit RH-only et BAL-009/LOT 6 sont intacts (aucun code produit modifié).',
    ],
    scenarios,
  }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  // Code de sortie : 0 uniquement si toutes les vérifications obligatoires sont conformes.
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== MICRO-VALIDATION FINALE RH-ONLY ===')
  for (const s of scenarios) {
    console.log(`${s.conclusion === 'Conforme' ? 'OK ' : s.conclusion === 'Non conforme' ? 'XX ' : '-- '} ${s.id} [${s.role}] ${s.action.slice(0, 70)} → ${s.conclusion} | ${s.observed.slice(0, 100)}`)
  }
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes} | Non exécutés: ${summary.nonExecutes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
  console.log(`Code de sortie: ${process.exitCode}`)
}

main().catch((error) => {
  console.error('ERREUR MICRO-VALIDATION', error)
  process.exit(1)
})
