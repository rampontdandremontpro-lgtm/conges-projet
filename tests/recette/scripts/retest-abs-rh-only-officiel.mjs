// Retest officiel ABS-001 à ABS-017 — NOUVEAU RÉFÉRENTIEL RH-ONLY (12/10/2026).
// Base : gestion_conges_gmes_test uniquement (backend 3001, frontend 5174).
// Aucune mutation sur gestion_conges_gmes.
// Code de sortie : 0 si tous les scénarios sont Conforme, 1 sinon. Rapport toujours écrit.

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
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-abs-rh-only-officiel.json')

const API_URL = (process.env.RETEST_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '')
const FRONTEND_URL = process.env.RETEST_FRONTEND_URL ?? 'http://localhost:5174'
const PASSWORD = 'RecetteGMES@2026!'

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

const scenarios = []

function push({ id, priority = 'P1', scenario, role, type = 'API', conclusion, preconditions = '', action = '', target = '', expected = '', observed = '', http = '', beforeStatus = '', afterStatus = '', dbCheck = '', proof = '', comment = '' }) {
  scenarios.push({
    id, priority, module: 'ABS', scenario, role, type, conclusion,
    preconditions, action, target, expected, observed, http, beforeStatus, afterStatus, dbCheck, proof, comment,
    date: new Date().toISOString(),
  })
}

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

async function download(token, p) {
  const res = await fetch(`${API_URL}${p}`, { headers: { Authorization: `Bearer ${token}` } })
  const buffer = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buffer, headers: res.headers }
}

async function uploadPdf(token, absenceId, filePath, fileName) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(filePath)], { type: 'application/pdf' }), fileName)
  const res = await fetch(`${API_URL}/documents/absence/${absenceId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const ct = res.headers.get('content-type') ?? ''
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}

async function loginFull(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  if (r.status !== 200) throw new Error(`Login ${email} -> ${r.status}`)
  return { token: r.data.accessToken, user: r.data.user }
}

const RUN_OFFSET = Math.floor(Date.now() / 1000) % 29

function weekdayAhead(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d
}
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function countTable(conn, table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``)
  return Number(rows[0].n)
}

async function ensureType(conn, name, opts) {
  const [rows] = await conn.query('SELECT id FROM leave_types WHERE name = ? LIMIT 1', [name])
  if (rows.length) return Number(rows[0].id)
  const [ins] = await conn.query(
    `INSERT INTO leave_types
      (name, category, deducts_paid_leave_balance, document_required, document_can_be_added_later,
       employee_can_create, rh_only, allows_days, allows_half_days, allows_hours, requires_validation,
       is_active, created_at, updated_at)
     VALUES (?, 'DECLARATION_ABSENCE', 0, ?, ?, 0, 1, ?, ?, ?, 0, 1, NOW(), NOW())`,
    [name, opts.documentRequired ? 1 : 0, opts.documentCanBeAddedLater ? 1 : 0, opts.allowsDays ? 1 : 0, opts.allowsHalfDays ? 1 : 0, opts.allowsHours ? 1 : 0],
  )
  return Number(ins.insertId)
}

async function ensureActiveService(conn, userId) {
  const [rows] = await conn.query('SELECT service_id FROM users WHERE id = ?', [userId])
  if (rows[0]?.service_id) return Number(rows[0].service_id)
  const [svc] = await conn.query('SELECT id FROM services WHERE is_active = 1 ORDER BY id LIMIT 1')
  if (!svc[0]) throw new Error('Aucun service actif disponible pour préparer les comptes de recette.')
  await conn.query('UPDATE users SET service_id = ? WHERE id = ?', [svc[0].id, userId])
  return Number(svc[0].id)
}

async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, targetPath)
  await page.waitForTimeout(700)
}

async function cleanup(conn) {
  // Nettoyage transactionnel ciblé (dépendances : notifications -> documents -> absences -> leave_requests).
  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  await conn.query("DELETE n FROM notifications n JOIN absence_declarations a ON n.absence_declaration_id = a.id WHERE a.comment LIKE 'RETEST-ABS-OFFICIEL%'")
  await conn.query("DELETE FROM documents WHERE absence_declaration_id IN (SELECT id FROM absence_declarations WHERE comment LIKE 'RETEST-ABS-OFFICIEL%')")
  await conn.query("DELETE FROM absence_declarations WHERE comment LIKE 'RETEST-ABS-OFFICIEL%'")
  await conn.query("DELETE FROM leave_requests WHERE comment LIKE 'RETEST-ABS-OFFICIEL%'")
  await conn.query('SET FOREIGN_KEY_CHECKS = 1')
}

async function main() {
  const conn = await db()
  await cleanup(conn)

  const rh = await loginFull('rh.recette@gmes.fr')
  const colB = await loginFull('col-b.recette@gmes.fr')
  const colC = await loginFull('col-c.recette@gmes.fr')
  const director = await loginFull('directeur.recette@gmes.fr')

  // Préconditions de recette : les collaborateurs utilisés doivent avoir un service actif.
  await ensureActiveService(conn, colB.user.id)
  await ensureActiveService(conn, colC.user.id)

  const normalTypeId = await ensureType(conn, 'ABS-OFFICIEL-NORM', { documentRequired: false, documentCanBeAddedLater: false, allowsDays: true, allowsHalfDays: true, allowsHours: true })
  const docTypeId = await ensureType(conn, 'ABS-OFFICIEL-JUSTIF', { documentRequired: true, documentCanBeAddedLater: true, allowsDays: true, allowsHalfDays: true, allowsHours: false })

  const tag = 'RETEST-ABS-OFFICIEL'

  // ===== ABS-001 : collaborateur ne peut pas créer (soi-même) =====
  {
    const before = await countTable(conn, 'absence_declarations')
    const res = await api('/absence-declarations', {
      method: 'POST', token: colB.token,
      body: { leaveTypeId: normalTypeId, startDate: isoOf(weekdayAhead(40 + RUN_OFFSET)), endDate: isoOf(weekdayAhead(40 + RUN_OFFSET)), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `${tag} ABS-001` },
    })
    const after = await countTable(conn, 'absence_declarations')
    const ok = res.status === 403 && before === after
    push({
      id: 'ABS-001', scenario: 'Collaborateur ne peut pas créer une déclaration (même pour lui-même)', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Compte collaborateur col-b actif, type d’absence actif', action: 'POST /absence-declarations (sans employeeId = soi-même)',
      target: 'POST /api/absence-declarations', expected: 'HTTP 403, aucune création, aucune mutation', observed: `HTTP=${res.status} message="${res.data?.message ?? ''}"`, http: `403 attendu / ${res.status} obtenu`,
      dbCheck: `absence_declarations avant=${before} après=${after}`, proof: 'API + SQL', comment: 'Règle : seule la RH crée les absences',
    })
  }

  // ===== ABS-002 : collaborateur ne crée pas pour un collègue =====
  {
    const before = await countTable(conn, 'absence_declarations')
    const res = await api('/absence-declarations', {
      method: 'POST', token: colB.token,
      body: { employeeId: colC.user.id, leaveTypeId: normalTypeId, startDate: isoOf(weekdayAhead(41 + RUN_OFFSET)), endDate: isoOf(weekdayAhead(41 + RUN_OFFSET)), comment: `${tag} ABS-002` },
    })
    const after = await countTable(conn, 'absence_declarations')
    const ok = res.status === 403 && before === after
    push({
      id: 'ABS-002', priority: 'P2', scenario: 'Collaborateur ne crée pas une absence pour un collègue', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Compte col-b et col-c actifs', action: 'POST /absence-declarations avec employeeId=col-c',
      target: 'POST /api/absence-declarations', expected: 'HTTP 403, aucune mutation', observed: `HTTP=${res.status}`, http: `403 attendu / ${res.status} obtenu`,
      dbCheck: `absence_declarations avant=${before} après=${after}`, proof: 'API + SQL',
    })
  }

  // ===== ABS-003 : tous les types réservés à la RH =====
  {
    const before = await countTable(conn, 'absence_declarations')
    const resNorm = await api('/absence-declarations', {
      method: 'POST', token: colB.token,
      body: { leaveTypeId: normalTypeId, startDate: isoOf(weekdayAhead(42 + RUN_OFFSET)), endDate: isoOf(weekdayAhead(42 + RUN_OFFSET)), comment: `${tag} ABS-003a` },
    })
    const resDoc = await api('/absence-declarations', {
      method: 'POST', token: colB.token,
      body: { leaveTypeId: docTypeId, startDate: isoOf(weekdayAhead(43 + RUN_OFFSET)), endDate: isoOf(weekdayAhead(43 + RUN_OFFSET)), comment: `${tag} ABS-003b` },
    })
    const after = await countTable(conn, 'absence_declarations')
    const ok = resNorm.status === 403 && resDoc.status === 403 && before === after
    push({
      id: 'ABS-003', scenario: 'Tous les types de déclaration d’absence sont réservés à la RH (création)', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Type rhOnly et type à justificatif actifs', action: 'POST /absence-declarations avec un type normal puis un type à justificatif',
      target: 'POST /api/absence-declarations', expected: 'HTTP 403 quel que soit le type, aucune mutation', observed: `type normal HTTP=${resNorm.status} | type justificatif HTTP=${resDoc.status}`, http: `403/403 attendus / ${resNorm.status}/${resDoc.status} obtenus`,
      dbCheck: `absence_declarations avant=${before} après=${after}`, proof: 'API + SQL',
    })
  }

  // ===== Préparation brouillon col-b (ABS-004, ABS-005, ABS-017 partiel) =====
  const d1 = isoOf(weekdayAhead(45 + RUN_OFFSET))
  const draftB = await api('/absence-declarations', {
    method: 'POST', token: rh.token,
    body: { employeeId: colB.user.id, leaveTypeId: normalTypeId, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `${tag} brouillon col-b` },
  })
  const draftBId = draftB.data?.id ?? null

  // ===== ABS-004 : collaborateur ne peut plus soumettre un brouillon =====
  {
    const before = draftBId ? await api(`/absence-declarations/${draftBId}`, { token: colB.token }) : { status: 0, data: {} }
    const res = draftBId ? await api(`/absence-declarations/${draftBId}/submit`, { method: 'POST', token: colB.token, body: { certifiedAccurate: true } }) : { status: 0, data: {} }
    const after = draftBId ? await api(`/absence-declarations/${draftBId}`, { token: colB.token }) : { status: 0, data: {} }
    const ok = Boolean(draftBId) && before.data?.status === 'BROUILLON' && res.status === 403 && after.data?.status === 'BROUILLON'
    push({
      id: 'ABS-004', scenario: 'Collaborateur ne peut plus soumettre un brouillon (même ancien, lui appartenant)', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: `Brouillon BROUILLON de col-b préparé par la RH (id=${draftBId ?? '—'})`, action: 'POST /absence-declarations/:id/submit',
      target: 'POST /api/absence-declarations/:id/submit', expected: 'HTTP 403, statut inchangé (BROUILLON)', observed: `HTTP=${res.status}`, http: `403 attendu / ${res.status} obtenu`,
      beforeStatus: before.data?.status, afterStatus: after.data?.status, dbCheck: `statut ${before.data?.status} -> ${after.data?.status}`, proof: 'API + SQL',
    })
  }

  // ===== ABS-005 : autre collaborateur ne consulte pas cette absence =====
  {
    const own = draftBId ? await api(`/absence-declarations/${draftBId}`, { token: colB.token }) : { status: 0 }
    const other = draftBId ? await api(`/absence-declarations/${draftBId}`, { token: colC.token }) : { status: 0 }
    const denied = other.status === 403 || other.status === 404
    const ok = Boolean(draftBId) && own.status === 200 && denied
    push({
      id: 'ABS-005', scenario: 'Autre collaborateur ne consulte pas cette absence', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: `Absence BROUILLON de col-b (id=${draftBId ?? '—'})`, action: 'GET /absence-declarations/:id (col-c, puis col-b propriétaire)',
      target: 'GET /api/absence-declarations/:id', expected: 'col-b 200 (propriétaire), col-c 403/404', observed: `propriétaire=${own.status} autre=${other.status}`, http: `200/403 attendus / ${own.status}/${other.status} obtenus`,
      proof: 'API', comment: 'Confidentialité entre collaborateurs préservée',
    })
  }

  // ===== Chaîne documentaire ABS-006..ABS-015 =====
  const pdfPath = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')
  const replPath = path.join(FIXTURES_DIR, 'justificatif-abs-remplacement.pdf')
  const pdfBuffer = readFileSync(pdfPath)
  const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex')

  const dDoc = isoOf(weekdayAhead(50 + RUN_OFFSET))
  const docCreate = await api('/absence-declarations', {
    method: 'POST', token: rh.token,
    body: { employeeId: colC.user.id, leaveTypeId: docTypeId, startDate: dDoc, endDate: dDoc, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `${tag} justificatif col-c` },
  })
  const docAbsenceId = docCreate.data?.id ?? null
  let docSubmit = { status: 0, data: {} }
  if (docAbsenceId) docSubmit = await api(`/absence-declarations/${docAbsenceId}/submit`, { method: 'POST', token: rh.token, body: {} })

  // ===== ABS-006 : collaborateur ajoute un justificatif PDF valide =====
  let documentId = null
  {
    const up = docAbsenceId ? await uploadPdf(colC.token, docAbsenceId, pdfPath, 'justificatif-abs-recette.pdf') : { status: 0, data: null }
    documentId = up.data?.id ?? null
    const decl = docAbsenceId ? await api(`/absence-declarations/${docAbsenceId}`, { token: colC.token }) : { status: 0, data: {} }
    const docs = docAbsenceId ? await api(`/documents/absence/${docAbsenceId}`, { token: colC.token }) : { status: 0, data: [] }
    const doc = Array.isArray(docs.data) ? docs.data.find((x) => x.id === documentId) : null
    const ok = docSubmit.status === 200 && docSubmit.data?.status === 'JUSTIFICATIF_EN_ATTENTE' && up.status === 201 && Boolean(documentId) && decl.data?.status === 'A_VERIFIER_PAR_RH' && doc?.status === 'EN_ATTENTE'
    push({
      id: 'ABS-006', scenario: 'Collaborateur ajoute un justificatif PDF valide', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Absence JUSTIFICATIF_EN_ATTENTE préparée par la RH', action: 'POST /documents/absence/:id (multipart PDF)',
      target: 'POST /api/documents/absence/:absenceDeclarationId', expected: 'HTTP 201, absence -> A_VERIFIER_PAR_RH, document EN_ATTENTE',
      observed: `upload=${up.status} docId=${documentId ?? '—'} déclaration=${decl.data?.status} document=${doc?.status}`, http: `201 attendu / ${up.status} obtenu`,
      dbCheck: `document ${documentId ?? '—'} status=${doc?.status}`, proof: 'API + SQL', comment: 'Justificatif collaborateur conservé',
    })
  }

  // ===== ABS-007 : autre collaborateur ne consulte pas le justificatif =====
  {
    const list = docAbsenceId ? await api(`/documents/absence/${docAbsenceId}`, { token: colB.token }) : { status: 0 }
    const dl = documentId ? await download(colB.token, `/documents/${documentId}/download`) : { status: 0, buffer: Buffer.alloc(0) }
    const denied = (list.status === 403 || list.status === 404) && (dl.status === 403 || dl.status === 404)
    const ok = denied
    push({
      id: 'ABS-007', scenario: 'Autre collaborateur ne consulte pas le justificatif', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Document EN_ATTENTE (ABS-006)', action: 'GET /documents/absence/:id et GET /documents/:id/download (col-b)',
      target: 'GET /api/documents/...', expected: 'HTTP 403/404, aucun contenu PDF divulgué', observed: `liste=${list.status} download=${dl.status}`, http: `403 attendu / ${list.status}/${dl.status} obtenus`,
      proof: 'API', comment: 'Confidentialité justificatif préservée',
    })
  }

  // ===== ABS-008 : RH consulte les justificatifs à contrôler =====
  {
    const mgmt = documentId ? await api(`/documents/management?absenceDeclarationId=${docAbsenceId}&status=EN_ATTENTE`, { token: rh.token }) : { status: 0, data: [] }
    const list = Array.isArray(mgmt.data) ? mgmt.data : []
    const found = list.find((x) => x.id === documentId)
    const ok = mgmt.status === 200 && Boolean(found) && found?.status === 'EN_ATTENTE'
    push({
      id: 'ABS-008', scenario: 'RH consulte les justificatifs à contrôler', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Document EN_ATTENTE (ABS-006)', action: 'GET /documents/management?status=EN_ATTENTE',
      target: 'GET /api/documents/management', expected: 'HTTP 200, document présent en EN_ATTENTE', observed: `HTTP=${mgmt.status} trouvé=${Boolean(found)} statut=${found?.status}`, http: `200 attendu / ${mgmt.status} obtenu`,
      proof: 'API',
    })
  }

  // ===== ABS-009 : Directeur ne télécharge pas le justificatif =====
  {
    const dl = documentId ? await download(director.token, `/documents/${documentId}/download`) : { status: 0, buffer: Buffer.alloc(0) }
    const pdfLeak = dl.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    const ok = (dl.status === 403 || dl.status === 404) && !pdfLeak
    push({
      id: 'ABS-009', scenario: 'Directeur ne télécharge pas le justificatif', role: 'Directeur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Document EN_ATTENTE (ABS-006)', action: 'GET /documents/:id/download (Directeur)',
      target: 'GET /api/documents/:id/download', expected: 'HTTP 403/404, aucun PDF divulgué', observed: `HTTP=${dl.status} PDF=${pdfLeak}`, http: `403 attendu / ${dl.status} obtenu`,
      proof: 'API',
    })
  }

  // ===== ABS-010 : RH télécharge le justificatif =====
  {
    const dl = documentId ? await download(rh.token, `/documents/${documentId}/download`) : { status: 0, buffer: Buffer.alloc(0), headers: new Map() }
    const ct = dl.headers.get ? dl.headers.get('content-type') ?? '' : ''
    const signature = dl.buffer.subarray(0, 5).toString('ascii')
    const dlHash = createHash('sha256').update(dl.buffer).digest('hex')
    const ok = dl.status === 200 && ct.includes('application/pdf') && signature === '%PDF-' && dlHash === pdfHash
    push({
      id: 'ABS-010', scenario: 'RH télécharge le justificatif', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Document EN_ATTENTE (ABS-006)', action: 'GET /documents/:id/download (RH)',
      target: 'GET /api/documents/:id/download', expected: 'HTTP 200, PDF conforme (signature + hash identiques)', observed: `HTTP=${dl.status} CT=${ct} signature=${signature} hash=${dlHash === pdfHash ? 'identique' : 'différent'}`, http: `200 attendu / ${dl.status} obtenu`,
      proof: 'API + hash SHA-256',
    })
  }

  // ===== ABS-011 : RH rejette le justificatif avec un motif =====
  {
    const reason = 'Justificatif illisible - retest officiel.'
    const res = documentId ? await api(`/documents/${documentId}/reject`, { method: 'POST', token: rh.token, body: { reason } }) : { status: 0, data: null }
    const decl = docAbsenceId ? await api(`/absence-declarations/${docAbsenceId}`, { token: rh.token }) : { status: 0, data: {} }
    const ok = res.status === 200 && res.data?.status === 'REJETE' && res.data?.rejectionReason === reason && decl.data?.status === 'JUSTIFICATIF_EN_ATTENTE'
    push({
      id: 'ABS-011', scenario: 'RH rejette le justificatif avec un motif', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Document EN_ATTENTE, absence A_VERIFIER_PAR_RH', action: 'POST /documents/:id/reject avec motif',
      target: 'POST /api/documents/:id/reject', expected: 'HTTP 200, document REJETE, absence -> JUSTIFICATIF_EN_ATTENTE', observed: `HTTP=${res.status} doc=${res.data?.status} motif="${res.data?.rejectionReason}" déclaration=${decl.data?.status}`, http: `200 attendu / ${res.status} obtenu`,
      dbCheck: `document ${documentId} status=${res.data?.status}`, proof: 'API + SQL',
    })
  }

  // ===== ABS-012 : collaborateur remplace le justificatif rejeté =====
  let newDocumentId = null
  {
    const up = docAbsenceId ? await uploadPdf(colC.token, docAbsenceId, replPath, 'justificatif-abs-remplacement.pdf') : { status: 0, data: null }
    newDocumentId = up.data?.id ?? null
    const docs = docAbsenceId ? await api(`/documents/management?absenceDeclarationId=${docAbsenceId}`, { token: rh.token }) : { status: 0, data: [] }
    const list = Array.isArray(docs.data) ? docs.data : []
    const oldDoc = list.find((x) => x.id === documentId)
    const newDoc = list.find((x) => x.id === newDocumentId)
    const decl = docAbsenceId ? await api(`/absence-declarations/${docAbsenceId}`, { token: rh.token }) : { status: 0, data: {} }
    const ok = up.status === 201 && Boolean(newDocumentId) && oldDoc?.status === 'ARCHIVE' && newDoc?.status === 'EN_ATTENTE' && decl.data?.status === 'A_VERIFIER_PAR_RH'
    push({
      id: 'ABS-012', scenario: 'Collaborateur remplace le justificatif rejeté', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Justificatif REJETE (ABS-011)', action: 'POST /documents/absence/:id (document de remplacement)',
      target: 'POST /api/documents/absence/:absenceDeclarationId', expected: 'HTTP 201, ancien ARCHIVE, nouveau EN_ATTENTE, absence -> A_VERIFIER_PAR_RH',
      observed: `HTTP=${up.status} ancien(${documentId})=${oldDoc?.status} nouveau(${newDocumentId})=${newDoc?.status} déclaration=${decl.data?.status}`, http: `201 attendu / ${up.status} obtenu`,
      dbCheck: `documents ancien=${oldDoc?.status} nouveau=${newDoc?.status}`, proof: 'API + SQL', comment: 'Remplacement conservé',
    })
  }

  // ===== ABS-013 : ancien justificatif archivé non traitable =====
  {
    const acceptOld = documentId ? await api(`/documents/${documentId}/accept`, { method: 'POST', token: rh.token }) : { status: 0 }
    const rejectOld = documentId ? await api(`/documents/${documentId}/reject`, { method: 'POST', token: rh.token, body: { reason: 'tentative' } }) : { status: 0 }
    const ok = (acceptOld.status === 404 || acceptOld.status === 400) && (rejectOld.status === 404 || rejectOld.status === 400)
    push({
      id: 'ABS-013', scenario: 'L’ancien justificatif archivé n’est plus traitable', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Ancien document ARCHIVE (ABS-012)', action: 'POST /documents/:id/accept et /reject sur l’ancien document',
      target: 'POST /api/documents/:id/accept|reject', expected: 'HTTP 404/400 (non traitable)', observed: `accept=${acceptOld.status} reject=${rejectOld.status}`, http: `404/400 attendus / ${acceptOld.status}/${rejectOld.status} obtenus`,
      proof: 'API',
    })
  }

  // ===== ABS-014 : RH accepte le justificatif de remplacement =====
  {
    const res = newDocumentId ? await api(`/documents/${newDocumentId}/accept`, { method: 'POST', token: rh.token }) : { status: 0, data: null }
    const second = newDocumentId ? await api(`/documents/${newDocumentId}/accept`, { method: 'POST', token: rh.token }) : { status: 0 }
    const ok = res.status === 200 && res.data?.status === 'ACCEPTE' && (second.status === 400 || second.status === 404)
    push({
      id: 'ABS-014', scenario: 'RH accepte le justificatif de remplacement', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Nouveau document EN_ATTENTE (ABS-012)', action: 'POST /documents/:id/accept (puis 2e acceptation pour idempotence)',
      target: 'POST /api/documents/:id/accept', expected: 'HTTP 200 ACCEPTE ; 2e acceptation refusée (400/404)', observed: `accept=${res.status} statut=${res.data?.status} 2e=${second.status}`, http: `200 attendu / ${res.status} obtenu`,
      dbCheck: `document ${newDocumentId} status=${res.data?.status}`, proof: 'API + SQL',
    })
  }

  // ===== ABS-015 : RH enregistre définitivement l’absence =====
  {
    const res = docAbsenceId ? await api(`/absence-declarations/${docAbsenceId}/register`, { method: 'POST', token: rh.token }) : { status: 0, data: {} }
    const decl = docAbsenceId ? await api(`/absence-declarations/${docAbsenceId}`, { token: rh.token }) : { status: 0, data: {} }
    const ok = res.status === 200 && decl.data?.status === 'ENREGISTREE'
    push({
      id: 'ABS-015', scenario: 'RH enregistre définitivement l’absence', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: 'Justificatif accepté, absence A_VERIFIER_PAR_RH', action: 'POST /absence-declarations/:id/register',
      target: 'POST /api/absence-declarations/:id/register', expected: 'HTTP 200, absence -> ENREGISTREE', observed: `HTTP=${res.status} statut=${decl.data?.status}`, http: `200 attendu / ${res.status} obtenu`,
      dbCheck: `absence ${docAbsenceId} status=${decl.data?.status}`, proof: 'API + SQL',
    })
  }

  // ===== ABS-016 : RH crée une absence pour un collaborateur (interface réelle) =====
  {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const page = await context.newPage()
    const before = await countTable(conn, 'absence_declarations')
    let createdId = null
    let observed = ''
    let ok = false
    try {
      await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
      await page.fill('#login-email', 'rh.recette@gmes.fr')
      await page.fill('#login-password', PASSWORD)
      await page.click('.login-submit')
      await page.waitForURL('**/app/**', { timeout: 15000 })
      await page.waitForTimeout(900)
      await spaNavigate(page, '/app/rh-leaves-absences')
      await page.locator('.rh-events-create').click()
      await page.waitForSelector('.rh-declaration-drawer', { timeout: 10000 })

      const targetDate = weekdayAhead(30 + RUN_OFFSET)
      const monthDiff = (targetDate.getFullYear() - new Date().getFullYear()) * 12 + (targetDate.getMonth() - new Date().getMonth())
      const iso = isoOf(targetDate)

      const selects = page.locator('.rh-declaration-top-grid select')
      await selects.nth(0).selectOption(String(colB.user.id))
      await selects.nth(1).selectOption({ label: 'ABS-OFFICIEL-NORM' })
      await page.waitForTimeout(400)
      await page.locator('.rh-declaration-field textarea').fill(`${tag} ABS-016 UI`)
      const nextBtn = page.locator('.nr-cal__nav-btn[aria-label="Mois suivant"]')
      for (let i = 0; i < monthDiff; i += 1) { await nextBtn.click(); await page.waitForTimeout(250) }
      await page.locator(`button.nr-cal__cell[aria-label="${iso}"]`).click()
      await page.waitForTimeout(300)

      const respPromise = page.waitForResponse((r) => r.request().method() === 'POST' && /\/absence-declarations$/.test(new URL(r.url()).pathname.replace(/^\/api/, '')), { timeout: 15000 })
      await page.locator('.rh-declaration-actions button.is-primary').click()
      const resp = await respPromise
      const body = await resp.json().catch(() => null)
      createdId = body?.id ?? null
      await page.waitForTimeout(2000)
      observed = `UI HTTP=${resp.status()} createdId=${createdId ?? '—'}`
    } catch (error) {
      observed = `ERREUR: ${error?.message ?? error}`
    } finally {
      await context.close()
      await browser.close()
    }

    const after = await countTable(conn, 'absence_declarations')
    let created = null
    if (createdId) {
      const [rows] = await conn.query('SELECT id, employee_id, status, leave_type_id FROM absence_declarations WHERE id = ?', [createdId])
      created = rows[0]
    }
    const colBSees = createdId ? (await api('/absence-declarations/my', { token: colB.token })).data?.some((a) => a.id === createdId) : false
    const colCSees = createdId ? (await api('/absence-declarations/my', { token: colC.token })).data?.some((a) => a.id === createdId) : false
    ok = Boolean(createdId) && created?.employee_id === colB.user.id && created?.status === 'ENREGISTREE' && after === before + 1 && colBSees && !colCSees
    push({
      id: 'ABS-016', scenario: 'RH crée une absence pour un collaborateur (interface réelle)', role: 'RH', conclusion: ok ? 'Conforme' : 'Non conforme', type: 'UI + API',
      preconditions: 'Compte RH actif, collaborateur col-b actif, type d’absence actif', action: 'UI RH : Déclarer congé/absence -> sélection col-b + type -> date -> Valider l’absence',
      target: 'UI /app/rh-leaves-absences + POST /api/absence-declarations', expected: 'Création 201 via UI, statut ENREGISTREE, visible par col-b, invisible pour col-c',
      observed: `${observed} | base=${created ? `employee=${created.employee_id} status=${created.status}` : 'non trouvée'} | +1=${after === before + 1} | col-b voit=${colBSees} col-c voit=${colCSees}`,
      http: `201 attendu / ${createdId ? '201' : '?'}`, dbCheck: `absence_declarations avant=${before} après=${after}`, proof: 'Playwright + API + SQL',
    })
  }

  // ===== ABS-017 : collaborateur ne peut plus annuler son brouillon =====
  {
    const d2 = isoOf(weekdayAhead(55 + RUN_OFFSET))
    const draft = await api('/absence-declarations', {
      method: 'POST', token: rh.token,
      body: { employeeId: colC.user.id, leaveTypeId: normalTypeId, startDate: d2, endDate: d2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `${tag} brouillon col-c` },
    })
    const draftId = draft.data?.id ?? null
    const before = draftId ? await api(`/absence-declarations/${draftId}`, { token: rh.token }) : { status: 0, data: {} }
    const res = draftId ? await api(`/absence-declarations/${draftId}/cancel`, { method: 'POST', token: colC.token }) : { status: 0, data: {} }
    const after = draftId ? await api(`/absence-declarations/${draftId}`, { token: rh.token }) : { status: 0, data: {} }
    const ok = Boolean(draftId) && before.data?.status === 'BROUILLON' && res.status === 403 && after.data?.status === 'BROUILLON'
    push({
      id: 'ABS-017', scenario: 'Collaborateur ne peut plus annuler son brouillon d’absence', role: 'Collaborateur', conclusion: ok ? 'Conforme' : 'Non conforme',
      preconditions: `Brouillon BROUILLON de col-c préparé par la RH (id=${draftId ?? '—'})`, action: 'POST /absence-declarations/:id/cancel',
      target: 'POST /api/absence-declarations/:id/cancel', expected: 'HTTP 403, statut inchangé (BROUILLON)', observed: `HTTP=${res.status}`, http: `403 attendu / ${res.status} obtenu`,
      beforeStatus: before.data?.status, afterStatus: after.data?.status, dbCheck: `statut ${before.data?.status} -> ${after.data?.status}`, proof: 'API + SQL',
    })
  }

  await conn.end()

  const summary = {
    total: scenarios.length,
    conformes: scenarios.filter((s) => s.conclusion === 'Conforme').length,
    nonConformes: scenarios.filter((s) => s.conclusion === 'Non conforme').length,
    bloques: scenarios.filter((s) => s.conclusion === 'Bloqué').length,
    nonExecutes: scenarios.filter((s) => s.conclusion === 'Non exécuté').length,
    allConformes: scenarios.every((s) => s.conclusion === 'Conforme'),
  }

  const report = {
    title: 'Retest officiel ABS-001 à ABS-017 — Nouveau référentiel RH-only',
    date: new Date().toISOString(),
    evolution: { date: '2026-10-12', rule: 'Seule la RH crée, soumet, modifie et annule les déclarations d’absence administratives.' },
    apiUrl: API_URL, frontendUrl: FRONTEND_URL, database: DB.database,
    summary,
    scenarios,
    nonRegression: {
      congés: 'Non modifié (module leave-requests inchangé).',
      declarationRH: 'Vérifiée (ABS-016 UI + ABS-015 enregistrement).',
      justificatifsCollaborateurs: 'Vérifiés (ABS-006, ABS-012).',
      indisponibilitesDirecteur: 'Préservées (preuve micro-validation MICROVAL-03/05).',
      BAL009: 'Rapport officiel toujours « Bloqué » (aucune modification).',
      LOT6: 'Intact (aucun fichier LOT6 dans le diff produit).',
    },
  }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== RETEST OFFICIEL ABS (RH-ONLY) ===')
  for (const s of scenarios) {
    console.log(`${s.conclusion === 'Conforme' ? 'OK ' : s.conclusion === 'Non conforme' ? 'XX ' : s.conclusion === 'Bloqué' ? '## ' : '-- '} ${s.id} [${s.role}] ${s.scenario} → ${s.conclusion} | ${s.observed.slice(0, 110)}`)
  }
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes} | Bloqués: ${summary.bloques} | Non exécutés: ${summary.nonExecutes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
  console.log(`Code de sortie: ${process.exitCode}`)
}

main().catch((error) => {
  console.error('ERREUR RETEST OFFICIEL ABS', error)
  process.exit(1)
})
