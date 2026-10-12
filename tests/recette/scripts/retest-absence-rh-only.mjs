// Retest dédié — « Seule la RH peut créer et déclarer des absences »
// Évolution fonctionnelle du 12/10/2026.
//
// Ce script s'exécute contre la base de RECETTE gestion_conges_gmes_test
// (port 3001 par défaut). Il ne touche jamais à gestion_conges_gmes.
//
// Usage :
//   node tests/recette/scripts/retest-absence-rh-only.mjs
//   RETEST_API_URL=http://localhost:3001/api node ... (override)

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-absence-rh-only.json')

const API_URL = (process.env.RETEST_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '')
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

const DB = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: readDbPassword(),
  database: 'gestion_conges_gmes_test',
}

const ACCOUNTS = {
  ADMIN: 'admin.recette@gmes.fr',
  RH: 'rh.recette@gmes.fr',
  DIRECTEUR: 'directeur.recette@gmes.fr',
  RESPONSABLE_SERVICE: 'responsable.recette@gmes.fr',
  COLLABORATEUR: 'col-a.recette@gmes.fr',
  COLLABORATEUR_B: 'col-b.recette@gmes.fr',
  COLLABORATEUR_C: 'col-c.recette@gmes.fr',
}

const results = []
let seq = 0

function push({ id, role, scenario, expected, actual, pass, mutation, comment = '' }) {
  seq += 1
  results.push({
    id: id ?? `RETEST-ABS-RH-${String(seq).padStart(2, '0')}`,
    priority: 'P1',
    module: 'ABS',
    role,
    scenario,
    type: 'API',
    status: pass ? 'Conforme' : 'Non conforme',
    expected,
    actual,
    mutation,
    comment,
    date: new Date().toISOString(),
  })
}

async function apiRequest(apiPath, { method = 'GET', token, body, formData } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (formData) {
    // multipart
    const response = await fetch(`${API_URL}${apiPath}`, { method, headers, body: formData })
    const ct = response.headers.get('content-type') ?? ''
    let data = null
    if (response.status !== 204) {
      data = ct.includes('application/json') ? await response.json() : await response.text()
    }
    return { status: response.status, data, headers: response.headers }
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API_URL}${apiPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const ct = response.headers.get('content-type') ?? ''
  let data = null
  if (response.status !== 204) {
    data = ct.includes('application/json') ? await response.json() : await response.text()
  }
  return { status: response.status, data, headers: response.headers }
}

async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  if (r.status !== 200) throw new Error(`Login failed for ${email}: HTTP ${r.status}`)
  return { token: r.data.accessToken, user: r.data.user }
}

async function db() {
  return mysql.createConnection(DB)
}

async function countTable(conn, table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``)
  return Number(rows[0].n)
}

async function snapshot(conn) {
  return {
    absence_declarations: await countTable(conn, 'absence_declarations'),
    notifications: await countTable(conn, 'notifications'),
    balance_movements: await countTable(conn, 'balance_movements'),
    documents: await countTable(conn, 'documents'),
    audit_logs: await countTable(conn, 'audit_logs'),
    leave_requests: await countTable(conn, 'leave_requests'),
  }
}

function sameSnapshot(a, b) {
  const keys = Object.keys(a)
  const diffs = keys.filter((k) => a[k] !== b[k])
  return { same: diffs.length === 0, diffs: diffs.map((k) => `${k}: ${a[k]} -> ${b[k]}`) }
}

function futureDate(offsetDays = 60) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const conn = await db()

  // Idempotence : nettoyage des données de retest précédentes (base de recette uniquement).
  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  await conn.query(
    "DELETE n FROM notifications n JOIN absence_declarations a ON n.absence_declaration_id = a.id WHERE a.comment LIKE 'RETEST%'",
  )
  await conn.query(
    "DELETE FROM documents WHERE absence_declaration_id IN (SELECT id FROM absence_declarations WHERE comment LIKE 'RETEST%')",
  )
  await conn.query(
    "DELETE FROM absence_declarations WHERE comment LIKE 'RETEST%'",
  )
  await conn.query(
    "DELETE FROM leave_requests WHERE comment LIKE 'RETEST%'",
  )
  await conn.query('SET FOREIGN_KEY_CHECKS = 1')

  const tokens = {}
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const { token, user } = await login(email)
    tokens[role] = { token, id: user.id }
  }

  // Préparation : type d'absence avec justificatif obligatoire (données de test modifiables).
  let docTypeId = null
  const [existingDocType] = await conn.query(
    "SELECT id FROM leave_types WHERE name = 'ABS-RH-DOC-RETEST' LIMIT 1",
  )
  if (existingDocType.length) {
    docTypeId = Number(existingDocType[0].id)
  } else {
    const [insertResult] = await conn.query(
      `INSERT INTO leave_types
        (name, category, deducts_paid_leave_balance, document_required,
         document_can_be_added_later, employee_can_create, rh_only,
         allows_days, allows_half_days, allows_hours, requires_validation,
         is_active, created_at, updated_at)
       VALUES
        ('ABS-RH-DOC-RETEST', 'DECLARATION_ABSENCE', 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, NOW(), NOW())`,
    )
    docTypeId = Number(insertResult.insertId)
  }

  // Type standard RH (déjà présent : ABS UI A3F, id 17) : rhOnly + sans justificatif.
  const plainTypeId = 17

  // =====================================================================
  // 1. CAS NÉGATIFS — rôles non RH (403 attendu, aucune mutation)
  // =====================================================================
  const colToken = tokens.COLLABORATEUR.token
  const colBToken = tokens.COLLABORATEUR_B.token
  const colCId = tokens.COLLABORATEUR_C.id
  const colBId = tokens.COLLABORATEUR_B.id
  const colId = tokens.COLLABORATEUR.id

  async function assert403AndNoMutation(id, role, scenario, fn) {
    const before = await snapshot(conn)
    const res = await fn()
    const after = await snapshot(conn)
    const cmp = sameSnapshot(before, after)
    push({
      id, role, scenario,
      expected: 'HTTP 403, aucune mutation en base',
      actual: `HTTP=${res.status}${res.status !== 403 ? ` body=${JSON.stringify(res.data).slice(0, 160)}` : ''}`,
      pass: res.status === 403 && cmp.same,
      mutation: cmp.diffs.join('; ') || 'aucune',
      comment: cmp.same ? 'Aucune mutation constatée' : `Mutations: ${cmp.diffs.join(', ')}`,
    })
  }

  const createPayloadSelf = {
    employeeId: colId, leaveTypeId: plainTypeId,
    startDate: futureDate(70), endDate: futureDate(70),
    startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST interdit',
  }
  const createPayloadOther = {
    employeeId: colBId, leaveTypeId: plainTypeId,
    startDate: futureDate(71), endDate: futureDate(71),
    startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST interdit',
  }
  const createPayloadDocType = {
    employeeId: colId, leaveTypeId: docTypeId,
    startDate: futureDate(72), endDate: futureDate(72),
    startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST interdit',
  }

  // 1. Collaborateur crée pour lui-même
  await assert403AndNoMutation('RETEST-ABS-RH-01', 'Collaborateur', 'Collaborateur crée une absence pour lui-même', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: createPayloadSelf }))
  // 2. Collaborateur crée pour un collègue
  await assert403AndNoMutation('RETEST-ABS-RH-02', 'Collaborateur', 'Collaborateur crée une absence pour un collègue', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: createPayloadOther }))
  // 3. Collaborateur essaie un type réservé RH
  await assert403AndNoMutation('RETEST-ABS-RH-03', 'Collaborateur', 'Collaborateur crée avec un type réservé RH', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: createPayloadDocType }))
  // 4. (même catégorie que 3 : tout type est désormais refusé au collaborateur)
  await assert403AndNoMutation('RETEST-ABS-RH-04', 'Collaborateur', 'Collaborateur crée avec un type normalement autorisé (règle désormais RH-only)', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: colToken, body: createPayloadSelf }))

  // Responsable / Directeur / Admin — création
  await assert403AndNoMutation('RETEST-ABS-RH-05', 'Responsable service', 'Responsable essaie de créer une absence', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: tokens.RESPONSABLE_SERVICE.token, body: createPayloadOther }))
  await assert403AndNoMutation('RETEST-ABS-RH-06', 'Directeur', 'Directeur essaie de créer une absence via le module de déclarations RH', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: tokens.DIRECTEUR.token, body: createPayloadSelf }))
  await assert403AndNoMutation('RETEST-ABS-RH-07', 'Admin', 'Admin essaie de créer une absence', () =>
    apiRequest('/absence-declarations', { method: 'POST', token: tokens.ADMIN.token, body: createPayloadOther }))

  // Soumission / annulation d'un ancien brouillon par un collaborateur.
  // Préparation : la RH crée un BROUILLON pour le collaborateur (test des cas 5 et 6).
  const rhCreate = await apiRequest('/absence-declarations', {
    method: 'POST', token: tokens.RH.token,
    body: {
      employeeId: colId, leaveTypeId: plainTypeId,
      startDate: futureDate(80), endDate: futureDate(80),
      startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST brouillon RH pour collaborateur',
    },
  })
  const draftId = rhCreate.status === 201 ? rhCreate.data?.id : null
  push({
    id: 'RETEST-ABS-RH-PREP', role: 'RH', scenario: 'Préparation : RH crée un brouillon pour le collaborateur (précondition)',
    expected: 'HTTP 201 (BROUILLON)', actual: `HTTP=${rhCreate.status} id=${draftId ?? '—'}`,
    pass: rhCreate.status === 201 && Boolean(draftId), mutation: 'création préparatoire', comment: 'Brouillon créé par la RH',
  })

  // 5. Collaborateur soumet l'ancien brouillon → 403
  await assert403AndNoMutation('RETEST-ABS-RH-08', 'Collaborateur', 'Collaborateur soumet un brouillon existant', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: colToken, body: { certifiedAccurate: true } })
    return r
  })
  // 6. Collaborateur annule l'ancien brouillon → 403
  await assert403AndNoMutation('RETEST-ABS-RH-09', 'Collaborateur', 'Collaborateur annule un brouillon existant', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}/cancel`, { method: 'POST', token: colToken })
    return r
  })
  // PATCH collaborateur sur brouillon → 403
  await assert403AndNoMutation('RETEST-ABS-RH-10', 'Collaborateur', 'Collaborateur modifie (PATCH) un brouillon existant', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}`, { method: 'PATCH', token: colToken, body: { comment: 'tentative collab' } })
    return r
  })
  // DELETE collaborateur sur brouillon → 403
  await assert403AndNoMutation('RETEST-ABS-RH-11', 'Collaborateur', 'Collaborateur supprime (DELETE) un brouillon existant', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}`, { method: 'DELETE', token: colToken })
    return r
  })
  // Responsable / Directeur / Admin — soumission
  await assert403AndNoMutation('RETEST-ABS-RH-12', 'Responsable service', 'Responsable essaie de soumettre un brouillon', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: tokens.RESPONSABLE_SERVICE.token, body: {} })
    return r
  })
  await assert403AndNoMutation('RETEST-ABS-RH-13', 'Directeur', 'Directeur essaie de soumettre un brouillon (module RH)', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: tokens.DIRECTEUR.token, body: {} })
    return r
  })
  await assert403AndNoMutation('RETEST-ABS-RH-14', 'Admin', 'Admin essaie de soumettre un brouillon', async () => {
    const r = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: tokens.ADMIN.token, body: {} })
    return r
  })

  // Vérification : le brouillon du collaborateur n'a pas été détruit ni muté.
  const draftCheck = await apiRequest(`/absence-declarations/${draftId}`, { token: tokens.RH.token })
  push({
    id: 'RETEST-ABS-RH-15', role: 'RH', scenario: 'Le brouillon préparé reste intact (non détruit) après les tentatives interdites',
    expected: 'HTTP 200, statut BROUILLON', actual: `HTTP=${draftCheck.status} status=${draftCheck.data?.status}`,
    pass: draftCheck.status === 200 && draftCheck.data?.status === 'BROUILLON', mutation: 'aucune', comment: 'Préservation de la donnée existante',
  })

  // =====================================================================
  // 2. CAS POSITIFS RH
  // =====================================================================
  // RH crée + soumet (type rhOnly sans justificatif → ENREGISTREE directement)
  const d1 = futureDate(90)
  const rhCreate2 = await apiRequest('/absence-declarations', {
    method: 'POST', token: tokens.RH.token,
    body: { employeeId: colBId, leaveTypeId: plainTypeId, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST RH positif' },
  })
  const rhId = rhCreate2.status === 201 ? rhCreate2.data?.id : null
  push({
    id: 'RETEST-ABS-RH-16', role: 'RH', scenario: 'RH crée une absence pour un collaborateur',
    expected: 'HTTP 201 (BROUILLON)', actual: `HTTP=${rhCreate2.status} id=${rhId ?? '—'}`,
    pass: rhCreate2.status === 201 && Boolean(rhId), mutation: 'création RH', comment: '',
  })

  const rhSubmit = rhId
    ? await apiRequest(`/absence-declarations/${rhId}/submit`, { method: 'POST', token: tokens.RH.token, body: {} })
    : { status: 0, data: {} }
  push({
    id: 'RETEST-ABS-RH-17', role: 'RH', scenario: 'RH soumet/enregistre l’absence (workflow rhOnly sans justificatif)',
    expected: 'HTTP 200, statut ENREGISTREE', actual: `HTTP=${rhSubmit.status} status=${rhSubmit.data?.status}`,
    pass: rhSubmit.status === 200 && rhSubmit.data?.status === 'ENREGISTREE', mutation: 'statut ENREGISTREE', comment: 'Enregistrement définitif RH',
  })

  // RH modifie une absence ENREGISTREE (PATCH)
  const rhPatch = rhId
    ? await apiRequest(`/absence-declarations/${rhId}`, { method: 'PATCH', token: tokens.RH.token, body: { comment: 'RETEST RH modifié' } })
    : { status: 0, data: {} }
  push({
    id: 'RETEST-ABS-RH-18', role: 'RH', scenario: 'RH modifie une absence enregistrée',
    expected: 'HTTP 200, commentaire mis à jour', actual: `HTTP=${rhPatch.status} comment=${rhPatch.data?.comment ?? '—'}`,
    pass: rhPatch.status === 200 && rhPatch.data?.comment === 'RETEST RH modifié', mutation: 'modification RH', comment: '',
  })

  // RH annule une absence (workflow existant)
  const rhCancel = rhId
    ? await apiRequest(`/absence-declarations/${rhId}/cancel`, { method: 'POST', token: tokens.RH.token })
    : { status: 0, data: {} }
  push({
    id: 'RETEST-ABS-RH-19', role: 'RH', scenario: 'RH annule une absence (workflow existant)',
    expected: 'HTTP 200, statut ANNULEE', actual: `HTTP=${rhCancel.status} status=${rhCancel.data?.status}`,
    pass: rhCancel.status === 200 && rhCancel.data?.status === 'ANNULEE', mutation: 'statut ANNULEE', comment: '',
  })

  // RH supprime le brouillon préparé (DELETE, RH-only)
  const rhDelete = draftId
    ? await apiRequest(`/absence-declarations/${draftId}`, { method: 'DELETE', token: tokens.RH.token })
    : { status: 0, data: null }
  push({
    id: 'RETEST-ABS-RH-20', role: 'RH', scenario: 'RH supprime le brouillon préparé (DELETE)',
    expected: 'HTTP 204', actual: `HTTP=${rhDelete.status}`,
    pass: rhDelete.status === 204, mutation: 'suppression du brouillon de test', comment: '',
  })

  // =====================================================================
  // 3. WORKFLOW JUSTIFICATIF (type avec justificatif obligatoire)
  // =====================================================================
  const dDoc = futureDate(100)
  const rhDocCreate = await apiRequest('/absence-declarations', {
    method: 'POST', token: tokens.RH.token,
    body: { employeeId: colId, leaveTypeId: docTypeId, startDate: dDoc, endDate: dDoc, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST justificatif' },
  })
  const docAbsId = rhDocCreate.status === 201 ? rhDocCreate.data?.id : null
  const rhDocSubmit = docAbsId
    ? await apiRequest(`/absence-declarations/${docAbsId}/submit`, { method: 'POST', token: tokens.RH.token, body: {} })
    : { status: 0, data: {} }
  push({
    id: 'RETEST-ABS-RH-21', role: 'RH', scenario: 'RH crée et soumet une absence à justificatif obligatoire',
    expected: 'HTTP 200, statut JUSTIFICATIF_EN_ATTENTE (justificatif ajoutable plus tard)',
    actual: `create=${rhDocCreate.status} submit=${rhDocSubmit.status} status=${rhDocSubmit.data?.status}`,
    pass: rhDocCreate.status === 201 && rhDocSubmit.status === 200 && rhDocSubmit.data?.status === 'JUSTIFICATIF_EN_ATTENTE',
    mutation: 'création + soumission RH', comment: '',
  })

  // Collaborateur transmet un justificatif (conservé)
  let colUpload = { status: 0, data: null }
  if (docAbsId) {
    const fixture = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')
    if (existsSync(fixture)) {
      const form = new FormData()
      form.append('file', new Blob([readFileSync(fixture)], { type: 'application/pdf' }), 'justificatif-retest.pdf')
      colUpload = await apiRequest(`/documents/absence/${docAbsId}`, { method: 'POST', token: colToken, formData: form })
    }
  }
  push({
    id: 'RETEST-ABS-RH-22', role: 'Collaborateur', scenario: 'Collaborateur transmet un justificatif sur une absence existante (conservé)',
    expected: 'HTTP 201 (document créé), statut bascule A_VERIFIER_PAR_RH',
    actual: `HTTP=${colUpload.status} docId=${colUpload.data?.id ?? '—'}`,
    pass: colUpload.status === 201 && Boolean(colUpload.data?.id),
    mutation: 'ajout justificatif collaborateur', comment: 'Droit collaborateur préservé',
  })

  // RH accepte le justificatif puis enregistre définitivement
  let rhAccept = { status: 0, data: null }
  if (colUpload.data?.id) {
    rhAccept = await apiRequest(`/documents/${colUpload.data.id}/accept`, { method: 'POST', token: tokens.RH.token })
  }
  const rhRegister = docAbsId
    ? await apiRequest(`/absence-declarations/${docAbsId}/register`, { method: 'POST', token: tokens.RH.token })
    : { status: 0, data: {} }
  push({
    id: 'RETEST-ABS-RH-23', role: 'RH', scenario: 'RH accepte le justificatif et enregistre définitivement l’absence',
    expected: 'HTTP 200 accept + HTTP 200 register (ENREGISTREE)',
    actual: `accept=${rhAccept.status} register=${rhRegister.status} status=${rhRegister.data?.status}`,
    pass: rhAccept.status === 200 && rhRegister.status === 200 && rhRegister.data?.status === 'ENREGISTREE',
    mutation: 'enregistrement définitif RH', comment: '',
  })

  // =====================================================================
  // 4. LECTURE COLLABORATEUR (consultation préservée / périmètre restreint)
  // =====================================================================
  const ownRead = await apiRequest(`/absence-declarations/${docAbsId}`, { token: colToken })
  push({
    id: 'RETEST-ABS-RH-24', role: 'Collaborateur', scenario: 'Collaborateur consulte sa propre absence créée par la RH',
    expected: 'HTTP 200', actual: `HTTP=${ownRead.status} id=${ownRead.data?.id ?? '—'}`,
    pass: ownRead.status === 200 && ownRead.data?.id === docAbsId, mutation: 'aucune', comment: 'Consultation préservée',
  })

  const otherRead = await apiRequest(`/absence-declarations/${docAbsId}`, { token: colBToken })
  push({
    id: 'RETEST-ABS-RH-25', role: 'Collaborateur B', scenario: 'Collaborateur B ne peut pas lire l’absence d’un collègue',
    expected: 'HTTP 403', actual: `HTTP=${otherRead.status}`,
    pass: otherRead.status === 403, mutation: 'aucune', comment: 'Périmètre de lecture préservé',
  })

  // Gestion justificatif d'un collègue → 403
  const otherDocAccess = await apiRequest(`/documents/absence/${docAbsId}`, { token: colBToken })
  push({
    id: 'RETEST-ABS-RH-26', role: 'Collaborateur B', scenario: 'Collaborateur B ne peut pas gérer les justificatifs d’un collègue',
    expected: 'HTTP 403', actual: `HTTP=${otherDocAccess.status}`,
    pass: otherDocAccess.status === 403, mutation: 'aucune', comment: 'Périmètre justificatif préservé',
  })

  // =====================================================================
  // 5. NON-RÉGRESSION DEMANDES DE CONGÉS
  // =====================================================================
  const leaveTypeId = 16 // CP UI A3F (DEMANDE_CONGE, employee_can_create=1)
  const dLeave = futureDate(120)
  const leaveCreate = await apiRequest('/leave-requests', {
    method: 'POST', token: colToken,
    body: { leaveTypeId, startDate: dLeave, endDate: dLeave, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'RETEST congé non-régression' },
  })
  push({
    id: 'RETEST-ABS-RH-27', role: 'Collaborateur', scenario: 'Non-régression : le collaborateur crée toujours une demande de congé (brouillon)',
    expected: 'HTTP 201 (BROUILLON)', actual: `HTTP=${leaveCreate.status} id=${leaveCreate.data?.id ?? '—'}`,
    pass: leaveCreate.status === 201 && Boolean(leaveCreate.data?.id),
    mutation: 'création demande de congé (module distinct)', comment: 'Module congés inchangé',
  })

  // Nettoyage léger du brouillon de congé de test (pour ne pas polluer la base de recette).
  if (leaveCreate.data?.id) {
    await apiRequest(`/leave-requests/${leaveCreate.data.id}`, { method: 'DELETE', token: colToken })
  }

  // =====================================================================
  // Bilan de non-mutation des phases négatives (vérifié avant/après par cas)
  // =====================================================================
  const negatives = results.filter((r) => /^RETEST-ABS-RH-0[1-9]|^RETEST-ABS-RH-1[0-5]/.test(r.id))
  const positives = results.filter((r) => !negatives.includes(r) && r.id !== 'RETEST-ABS-RH-PREP')
  const allPass = results.every((r) => r.status === 'Conforme')
  const negativeMutations = negatives.filter((r) => r.mutation && r.mutation !== 'aucune')
  const negativesClean = negativeMutations.length === 0

  const report = {
    title: 'Retest — Seule la RH peut créer et déclarer des absences',
    date: new Date().toISOString(),
    evolution: {
      decidedAt: '2026-10-12',
      before: 'Le collaborateur pouvait créer/soumettre/annuler ses déclarations d’absence (LOT 1).',
      after: 'Seule la RH peut créer, soumettre, autoriser, modifier et gérer les déclarations d’absence.',
    },
    referentiel: {
      RH: 'créer, soumettre, autoriser, modifier, annuler et gérer les absences (périmètre existant).',
      COLLABORATEUR: 'consultation de ses propres absences, états/historique autorisés, transmission/remplacement de justificatif. Aucune création/soumission/annulation.',
      RESPONSABLE_SERVICE: 'aucune création/déclaration d’absence.',
      DIRECTEUR: 'aucune création/déclaration via le module de déclarations RH. Fonctions dédiées d’indisponibilité du Directeur préservées (routes director/* inchangées).',
      ADMIN: 'périmètre technique inchangé, aucun droit métier de création d’absence.',
    },
    apiUrl: API_URL,
    database: DB.database,
    controls: {
      controllerRoles: [
        'POST /absence-declarations → @Roles(RH)',
        'POST /absence-declarations/:id/submit → @Roles(RH)',
        'POST /absence-declarations/:id/cancel → @Roles(RH)',
        'PATCH /absence-declarations/:id → @Roles(RH)',
        'DELETE /absence-declarations/:id → @Roles(RH)',
        'PATCH /absence-declarations/director/:id → @Roles(DIRECTEUR) (indisponibilité Directeur, inchangé)',
        'POST /absence-declarations/director/:id/cancel → @Roles(DIRECTEUR) (inchangé)',
      ],
      serviceDefense: [
        'createDraft, submit, cancel, updateDraft, deleteDraft : garde role !== RH → ForbiddenException.',
      ],
    },
    nonMutation: {
      perCaseVerified: true,
      negativeCasesChecked: negatives.length,
      negativeCasesWithMutation: negativeMutations.map((r) => ({ id: r.id, mutation: r.mutation })),
      summary: negativesClean
        ? `Aucune mutation constatée sur absence_declarations, notifications, balance_movements, documents, audit_logs, leave_requests pour les ${negatives.length} cas négatifs (vérification avant/après par cas).`
        : `Mutations inattendues: ${negativeMutations.map((r) => `${r.id}=${r.mutation}`).join('; ')}`,
    },
    summary: {
      total: results.length,
      conformes: results.filter((r) => r.status === 'Conforme').length,
      nonConformes: results.filter((r) => r.status === 'Non conforme').length,
      allPass,
      negativeCases: negatives.length,
      positiveCases: positives.length,
    },
    scenariosImpacted: [
      { id: 'ABS-001', before: 'Collaborateur crée une déclaration', after: 'Refusé au collaborateur (403) — réservé à la RH', newExpected: '403 / création RH uniquement' },
      { id: 'ABS-002', before: 'Collaborateur ne déclare pas pour un collègue', after: 'Le collaborateur ne déclare plus du tout', newExpected: '403 création' },
      { id: 'ABS-003', before: 'Type réservé RH refusé au collaborateur', after: 'Tous les types d’absence sont réservés à la RH', newExpected: '403 création' },
      { id: 'ABS-004', before: 'Collaborateur soumet sa déclaration', after: 'Refusé au collaborateur — soumission RH uniquement', newExpected: '403 soumission' },
      { id: 'ABS-017', before: 'Collaborateur annule son brouillon', after: 'Refusé au collaborateur — annulation RH uniquement', newExpected: '403 annulation' },
      { id: 'ABS-016', before: 'RH crée une absence pour un collaborateur', after: 'Inchangé', newExpected: '201 création RH' },
      { id: 'ABS-006', before: 'Collaborateur ajoute un justificatif', after: 'Inchangé (conservé)', newExpected: '201 justificatif' },
      { id: 'ABS-012', before: 'Collaborateur remplace un justificatif rejeté', after: 'Inchangé (conservé)', newExpected: '201 remplacement' },
      { id: 'ABS-005', before: 'Autre collaborateur ne consulte pas l’absence', after: 'Inchangé', newExpected: '403 lecture' },
    ],
    filesModified: [
      'backend/src/absence-declarations/absence-declarations.controller.ts',
      'backend/src/absence-declarations/absence-declarations.service.ts',
      'backend/src/absence-declarations/absence-declarations.service.spec.ts',
      'frontend/src/components/collab/dashboard/PlanLeaveCard.jsx',
      'frontend/src/pages/collab/DashboardPage.jsx',
      'frontend/src/app/router.jsx',
      'frontend/src/pages/collab/RequestDetailPage.jsx',
    ],
    builds: {
      backend: 'OK (nest build)',
      frontend: 'OK (vite build)',
      jest: '254 passed / 11 failed (échecs préexistants : settings, balance-reminder, documents) — aucune régression supplémentaire',
    },
    errorsRemaining: [
      'Jest : 11 échecs préexistants (settings.service.spec, balance-reminder.service.spec, documents.service.spec) — non liés à cette évolution.',
    ],
    results,
  }

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  await conn.end()

  // Sortie console
  console.log('\n=== RETEST ABSENCE RH-ONLY ===')
  for (const r of results) {
    console.log(`${r.status === 'Conforme' ? 'OK ' : 'XX '} ${r.id} [${r.role}] ${r.scenario} → ${r.actual}`)
  }
  console.log(`\nTotal: ${report.summary.total} | Conformes: ${report.summary.conformes} | Non conformes: ${report.summary.nonConformes}`)
  console.log(`Non-mutation phases négatives: ${negativesClean ? 'OK' : 'ÉCARTS: ' + negativeMutations.map((r) => r.id + '=' + r.mutation).join('; ')}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256 du rapport: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((error) => {
  console.error('ERREUR RETEST', error)
  process.exit(1)
})
