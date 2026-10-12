// Corrections sécurité suppressions + préparation export (12/10/2026).
// Base : gestion_conges_gmes_test uniquement.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-corrections-securite-20261012.json')

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
const DB = { host: 'localhost', port: 3306, user: 'root', password: readDbPassword(), database: 'gestion_conges_gmes_test' }

const results = []
function push(id, action, expected, observed, pass) {
  results.push({ id, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', date: new Date().toISOString() })
}

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const ct = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  const data = res.status === 204 ? null : ct.includes('application/json') ? JSON.parse(buf.toString('utf8')) : buf.toString('utf8')
  return { status: res.status, data, buffer: buf }
}
async function loginFull(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return { token: r.data.accessToken, user: r.data.user }
}
async function db() { return mysql.createConnection(DB) }

async function main() {
  const admin = await loginFull('admin.recette@gmes.fr')
  const colA = await loginFull('col-a.recette@gmes.fr')
  const conn = await db()

  const uniq = Date.now()

  // ===== 1. Suppression utilisateur : auteur détaché (NULL), pas de faux auteur =====
  const rhEmail = `del-rh.${uniq}@gmes.fr`
  const rhCreate = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'DELRH', prenom: 'Test', email: rhEmail, role: 'RH', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD } })
  const rhId = rhCreate.data?.id ?? null
  const rhToken = rhId ? (await loginFull(rhEmail)).token : null
  // RH crée une demande pour col-a (created_by_id = rhId)
  let reqId = null
  if (rhToken) {
    const lr = await api('/leave-requests', { method: 'POST', token: rhToken, body: { employeeId: colA.user.id, leaveTypeId: 16, startDate: '2027-05-10', endDate: '2027-05-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `DEL-AUTEUR-${uniq}` } })
    reqId = lr.data?.id ?? null
  }
  const delRh = rhId ? await api(`/users/${rhId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const [reqAfter] = reqId ? await conn.query('SELECT id, employee_id, created_by_id FROM leave_requests WHERE id = ?', [reqId]) : [[]]
  const reqKept = reqAfter[0]?.employee_id === colA.user.id
  const authorDetached = reqAfter[0]?.created_by_id === null
  push('SEC-01', 'Suppression RH : demande créée pour autrui conservée, auteur détaché', 'HTTP 204, demande conservée, created_by_id = NULL', `HTTP=${delRh.status} req=${reqAfter[0] ? `employee=${reqAfter[0].employee_id} createdBy=${reqAfter[0].created_by_id}` : 'ABSENTE'}`, delRh.status === 204 && reqKept && authorDetached)

  // ===== 2. Suppression service + demande en attente =====
  const sname = `DEL-SRV-${uniq}`
  const svc = await api('/services', { method: 'POST', token: admin.token, body: { name: sname, serviceType: 'INTERNE', validationMode: 'SANS_VALIDATION' } })
  const svcId = svc.data?.id ?? null
  const colEmail = `del-col.${uniq}@gmes.fr`
  const colCreate = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'DELCOL', prenom: 'Test', email: colEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, password: PASSWORD } })
  const colId = colCreate.data?.id ?? null
  const colToken = colId ? (await loginFull(colEmail)).token : null
  // Demande BROUILLON pour ce collaborateur (service = svcId)
  let draftId = null
  if (colToken) {
    const lr = await api('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: 16, startDate: '2027-06-01', endDate: '2027-06-01', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `DEL-SRV-DRAFT-${uniq}` } })
    draftId = lr.data?.id ?? null
  }
  // Demande en attente (EN_ATTENTE_VALIDATION) avec service NULL, pour tester la garde 400
  let pendingId = null
  if (colId) {
    const [ins] = await conn.query(`INSERT INTO leave_requests (employee_id, created_by_id, leave_type_id, service_id, start_date, end_date, start_period, end_period, calendar_duration, deducted_days, status, balance_processing_status, is_anticipated_leave, version, is_urgent, rh_confirmed_director_agreement, submitted_at, comment, created_at, updated_at) VALUES (?, ?, 16, NULL, '2027-08-01', '2027-08-02', 'MATIN', 'APRES_MIDI', 2, 2, 'EN_ATTENTE_VALIDATION', 'DEMANDE_ACTUELLE', 0, 1, 0, 0, NOW(), ?, NOW(), NOW())`, [colId, colId, `DEL-SRV-PENDING-${uniq}`])
    pendingId = ins.insertId
  }
  // Supprimer le service
  const delSvc = svcId ? await api(`/services/${svcId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const [draftAfter] = draftId ? await conn.query('SELECT id, employee_id, service_id, status FROM leave_requests WHERE id = ?', [draftId]) : [[]]
  const draftKept = draftAfter[0]?.employee_id === colId
  const serviceDetached = draftAfter[0]?.service_id === null
  // Validation d'une demande dont le service a été supprimé → 400 explicite (pas 500)
  const rhFor = await loginFull('rh.recette@gmes.fr')
  const validate = pendingId ? await api(`/leave-requests/${pendingId}/validate`, { method: 'POST', token: rhFor.token, body: { signatureType: 'DRAWN', signatureData: 'ab' } }) : { status: 0, data: null }
  const validateSafe = validate.status === 400 && /service.*supprimé/i.test(String(validate.data?.message ?? ''))
  push('SEC-02', 'Suppression service : demande conservée (service NULL) + validation → 400 explicite', 'HTTP 204 + service_id=NULL + validate 400 "service supprimé" (pas 500)', `HTTP=${delSvc.status} draft=${draftAfter[0] ? `service=${draftAfter[0].service_id}` : 'ABSENTE'} validate=${validate.status} msg="${validate.data?.message ?? ''}"`, delSvc.status === 204 && draftKept && serviceDetached && validateSafe)

  // ===== 3. Préparer un jeu exportable (VALIDEE) =====
  const [exists] = await conn.query("SELECT COUNT(*) n FROM leave_requests WHERE status='VALIDEE' AND comment='EXPORT-DEL-"+uniq+"'")
  if (exists[0].n === 0) {
    await conn.query(`INSERT INTO leave_requests (employee_id, created_by_id, leave_type_id, service_id, start_date, end_date, start_period, end_period, calendar_duration, deducted_days, status, balance_processing_status, is_anticipated_leave, version, is_urgent, rh_confirmed_director_agreement, submitted_at, decision_at, comment, created_at, updated_at) VALUES (17, 17, 16, 16, '2027-07-01', '2027-07-02', 'MATIN', 'APRES_MIDI', 2, 2, 'VALIDEE', 'DEMANDE_ACTUELLE', 0, 1, 0, 0, NOW(), NOW(), 'EXPORT-DEL-${uniq}', NOW(), NOW())`)
  }
  const overview = await api('/exports/overview', { token: (await loginFull('directeur.recette@gmes.fr')).token })
  push('SEC-03', 'Préparation jeu exportable (VALIDEE)', 'overview 200 pour le Directeur', `overview=${overview.status}`, overview.status === 200)

  await conn.end()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Corrections sécurité suppressions + export (12/10/2026)', date: new Date().toISOString(), apiUrl: API_URL, database: DB.database, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== CORRECTIONS SÉCURITÉ ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
