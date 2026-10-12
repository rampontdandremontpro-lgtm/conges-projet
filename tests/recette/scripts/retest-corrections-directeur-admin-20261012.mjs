// Retest des corrections Directeur / Admin (2026-10-12).
// - Directeur : parité exports RH.
// - Admin : suppression définitive utilisateurs et services.
// Base : gestion_conges_gmes_test uniquement.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-corrections-directeur-admin-20261012.json')

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
function push(id, area, action, expected, observed, pass, comment = '') {
  results.push({ id, area, action, expected, observed, pass: pass ? 'Conforme' : 'Non conforme', comment, date: new Date().toISOString() })
}

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const ct = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  let data = null
  if (res.status !== 204) {
    data = ct.includes('application/json') ? JSON.parse(buf.toString('utf8')) : buf.toString('utf8')
  }
  return { status: res.status, data, buffer: buf, headers: res.headers }
}

async function loginFull(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  if (r.status !== 200) throw new Error(`Login ${email} -> ${r.status}`)
  return { token: r.data.accessToken, user: r.data.user }
}
async function db() { return mysql.createConnection(DB) }

async function main() {
  const admin = await loginFull('admin.recette@gmes.fr')
  const rh = await loginFull('rh.recette@gmes.fr')
  const director = await loginFull('directeur.recette@gmes.fr')
  const colA = await loginFull('col-a.recette@gmes.fr')
  const conn = await db()

  // ===== 1. EXPORTS — parité Directeur / RH =====
  const rhOverview = await api('/exports/overview', { token: rh.token })
  const dirOverview = await api('/exports/overview', { token: director.token })
  push('EXP-01', 'Exports', 'RH GET /exports/overview', 'HTTP 200', `HTTP=${rhOverview.status}`, rhOverview.status === 200)
  push('EXP-02', 'Exports', 'Directeur GET /exports/overview', 'HTTP 200 (anciennement 403)', `HTTP=${dirOverview.status}`, dirOverview.status === 200)

  const rhCsv = await api('/exports/leave-requests?format=csv', { token: rh.token })
  const dirCsv = await api('/exports/leave-requests?format=csv', { token: director.token })
  const rhXlsx = await api('/exports/leave-requests?format=xlsx', { token: rh.token })
  const dirXlsx = await api('/exports/leave-requests?format=xlsx', { token: director.token })
  const csvIdentical = rhCsv.buffer.equals(dirCsv.buffer)
  const xlsxMagic = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b
  push('EXP-03', 'Exports', 'RH export CSV', 'HTTP 200 + contenu CSV', `HTTP=${rhCsv.status} bytes=${rhCsv.buffer.length}`, rhCsv.status === 200 && rhCsv.buffer.length > 0)
  push('EXP-04', 'Exports', 'Directeur export CSV (identique RH)', 'HTTP 200 + contenu identique', `HTTP=${dirCsv.status} identique=${csvIdentical}`, dirCsv.status === 200 && csvIdentical)
  push('EXP-05', 'Exports', 'RH export XLSX', 'HTTP 200 + signature PK', `HTTP=${rhXlsx.status} PK=${xlsxMagic(rhXlsx.buffer)}`, rhXlsx.status === 200 && xlsxMagic(rhXlsx.buffer))
  push('EXP-06', 'Exports', 'Directeur export XLSX', 'HTTP 200 + signature PK', `HTTP=${dirXlsx.status} PK=${xlsxMagic(dirXlsx.buffer)}`, dirXlsx.status === 200 && xlsxMagic(dirXlsx.buffer))
  const colOverview = await api('/exports/overview', { token: colA.token })
  push('EXP-07', 'Exports', 'Collaborateur GET /exports/overview', 'HTTP 403', `HTTP=${colOverview.status}`, colOverview.status === 403)

  // ===== 2. SUPPRESSION UTILISATEUR =====
  const mkUser = async (tag, extra = {}) => {
    const r = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'DEL', prenom: tag, email: `${tag.toLowerCase()}.del.recette@gmes.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD, ...extra } })
    return r.data?.id ?? null
  }

  // U1 : actif sans relation
  const u1 = await mkUser('U1')
  const delU1 = u1 ? await api(`/users/${u1}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const u1Gone = u1 ? !(await conn.query('SELECT id FROM users WHERE id=?', [u1]))[0].length : false
  push('USR-01', 'Admin utilisateurs', 'Supprimer un utilisateur actif sans relation', 'HTTP 204 + compte disparu', `HTTP=${delU1.status} disparu=${u1Gone}`, delU1.status === 204 && u1Gone)

  // U2 : inactif
  const u2 = await mkUser('U2')
  if (u2) await api(`/users/${u2}/disable`, { method: 'PATCH', token: admin.token })
  const delU2 = u2 ? await api(`/users/${u2}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const u2Gone = u2 ? !(await conn.query('SELECT id FROM users WHERE id=?', [u2]))[0].length : false
  push('USR-02', 'Admin utilisateurs', 'Supprimer un utilisateur inactif', 'HTTP 204 + compte disparu', `HTTP=${delU2.status} disparu=${u2Gone}`, delU2.status === 204 && u2Gone)

  // U3 : avec demandes + soldes + mouvement + justificatif
  const u3 = await mkUser('U3')
  if (u3) {
    await conn.query(`INSERT INTO leave_requests (employee_id, created_by_id, leave_type_id, service_id, start_date, end_date, start_period, end_period, calendar_duration, deducted_days, status, balance_processing_status, is_anticipated_leave, version, is_urgent, rh_confirmed_director_agreement, created_at, updated_at) VALUES (?, ?, 16, 16, '2027-02-10', '2027-02-10', 'MATIN', 'APRES_MIDI', 1, 1, 'BROUILLON', 'DEMANDE_ACTUELLE', 0, 1, 0, 0, NOW(), NOW())`, [u3, u3])
    const [bal] = await conn.query(`INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days, updated_at) VALUES (?, '2026-2027', 'N', 2.5, 0, 0, 2.5, NOW())`, [u3])
    await conn.query(`INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after, created_at) VALUES (?, ?, 'ACQUISITION', 2.5, 0, 2.5, NOW())`, [u3, bal.insertId])
    await conn.query(`INSERT INTO documents (uploaded_by_id, document_kind, original_name, storage_key, mime_type, file_size, status, uploaded_at) VALUES (?, 'JUSTIFICATIF', 'justif-u3.pdf', 'test-u3-${u3}.pdf', 'application/pdf', 100, 'EN_ATTENTE', NOW())`, [u3])
  }
  const delU3 = u3 ? await api(`/users/${u3}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const u3Gone = u3 ? !(await conn.query('SELECT id FROM users WHERE id=?', [u3]))[0].length : false
  const u3RelGone = u3 ? {
    leave_requests: (await conn.query('SELECT COUNT(*) n FROM leave_requests WHERE employee_id=?', [u3]))[0][0].n,
    leave_balances: (await conn.query('SELECT COUNT(*) n FROM leave_balances WHERE employee_id=?', [u3]))[0][0].n,
    balance_movements: (await conn.query('SELECT COUNT(*) n FROM balance_movements WHERE employee_id=?', [u3]))[0][0].n,
    documents: (await conn.query('SELECT COUNT(*) n FROM documents WHERE uploaded_by_id=?', [u3]))[0][0].n,
  } : {}
  push('USR-03', 'Admin utilisateurs', 'Supprimer un utilisateur avec demandes + soldes + mouvement + justificatif', 'HTTP 204 + données associées effacées', `HTTP=${delU3.status} disparu=${u3Gone} reliques=${JSON.stringify(u3RelGone)}`, delU3.status === 204 && u3Gone && Object.values(u3RelGone).every((n) => n === 0))

  // U4 : lien de validation (valideur de secours)
  const u4 = await mkUser('U4')
  if (u4) await conn.query('INSERT INTO service_backup_validators (service_id, validator_id, is_active, created_at, updated_at) VALUES (16, ?, 1, NOW(), NOW())', [u4])
  const delU4 = u4 ? await api(`/users/${u4}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const u4Gone = u4 ? !(await conn.query('SELECT id FROM users WHERE id=?', [u4]))[0].length : false
  const u4SvGone = u4 ? (await conn.query('SELECT COUNT(*) n FROM service_backup_validators WHERE validator_id=?', [u4]))[0][0].n : 0
  push('USR-04', 'Admin utilisateurs', 'Supprimer un utilisateur avec lien de validation', 'HTTP 204 + affectation valideur supprimée', `HTTP=${delU4.status} disparu=${u4Gone} validations=${u4SvGone}`, delU4.status === 204 && u4Gone && u4SvGone === 0)

  // Non-Admin → 403
  const delForbidden = await api(`/users/${u2 ?? 9999}`, { method: 'DELETE', token: rh.token })
  push('USR-05', 'Admin utilisateurs', 'RH DELETE /users/:id', 'HTTP 403', `HTTP=${delForbidden.status}`, delForbidden.status === 403)

  // ===== 3. SUPPRESSION SERVICE =====
  const mkService = async (name) => {
    const r = await api('/services', { method: 'POST', token: admin.token, body: { name, serviceType: 'INTERNE', validationMode: 'SANS_VALIDATION' } })
    return r.data?.id ?? null
  }

  // S1 : service vide
  const s1 = await mkService('DEL-S1-VIDE')
  const delS1 = s1 ? await api(`/services/${s1}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const s1Gone = s1 ? !(await conn.query('SELECT id FROM services WHERE id=?', [s1]))[0].length : false
  push('SRV-01', 'Admin services', 'Supprimer un service vide', 'HTTP 204 + service disparu', `HTTP=${delS1.status} disparu=${s1Gone}`, delS1.status === 204 && s1Gone)

  // S2 : service avec collaborateurs (les utilisateurs doivent être conservés)
  const s2 = await mkService('DEL-S2-COLLAB')
  const u5 = await mkUser('U5', { serviceId: s2 })
  const u6 = await mkUser('U6', { serviceId: s2 })
  const delS2 = s2 ? await api(`/services/${s2}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const s2Gone = s2 ? !(await conn.query('SELECT id FROM services WHERE id=?', [s2]))[0].length : false
  const u5Kept = u5 ? (await conn.query('SELECT id, service_id FROM users WHERE id=?', [u5]))[0] : []
  const u6Kept = u6 ? (await conn.query('SELECT id, service_id FROM users WHERE id=?', [u6]))[0] : []
  push('SRV-02', 'Admin services', 'Supprimer un service avec collaborateurs (comptes conservés)', 'HTTP 204 + collaborateurs conservés avec service_id NULL', `HTTP=${delS2.status} disparu=${s2Gone} U5=${JSON.stringify(u5Kept)} U6=${JSON.stringify(u6Kept)}`, delS2.status === 204 && s2Gone && u5Kept[0]?.service_id === null && u6Kept[0]?.service_id === null)

  // S3 : service avec responsable + valideur de secours
  const s3 = await mkService('DEL-S3-MGR')
  const mgr = await mkUser('MGR', { role: 'RESPONSABLE_SERVICE', serviceId: s3 })
  if (s3 && mgr) {
    await api(`/services/${s3}`, { method: 'PATCH', token: admin.token, body: { primaryManagerId: mgr } })
    await conn.query('INSERT INTO service_backup_validators (service_id, validator_id, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', [s3, mgr])
  }
  const delS3 = s3 ? await api(`/services/${s3}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const s3Gone = s3 ? !(await conn.query('SELECT id FROM services WHERE id=?', [s3]))[0].length : false
  const mgrKept = mgr ? (await conn.query('SELECT id, service_id FROM users WHERE id=?', [mgr]))[0] : []
  const s3SvGone = s3 ? (await conn.query('SELECT COUNT(*) n FROM service_backup_validators WHERE service_id=?', [s3]))[0][0].n : 0
  push('SRV-03', 'Admin services', 'Supprimer un service avec responsable et valideur', 'HTTP 204 + responsable conservé + valideur supprimé', `HTTP=${delS3.status} disparu=${s3Gone} manager=${JSON.stringify(mgrKept)} validations=${s3SvGone}`, delS3.status === 204 && s3Gone && mgrKept[0]?.service_id === null && s3SvGone === 0)

  // Non-Admin → 403
  const delSrvForbidden = await api(`/services/${s1 ?? 9999}`, { method: 'DELETE', token: rh.token })
  push('SRV-04', 'Admin services', 'RH DELETE /services/:id', 'HTTP 403', `HTTP=${delSrvForbidden.status}`, delSrvForbidden.status === 403)

  await conn.end()

  const summary = {
    total: results.length,
    conformes: results.filter((r) => r.pass === 'Conforme').length,
    nonConformes: results.filter((r) => r.pass === 'Non conforme').length,
    allConformes: results.every((r) => r.pass === 'Conforme'),
  }
  const report = {
    title: 'Retest corrections Directeur / Admin — 12/10/2026',
    date: new Date().toISOString(),
    apiUrl: API_URL,
    database: DB.database,
    summary,
    results,
  }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== RETEST CORRECTIONS DIRECTEUR/ADMIN ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} [${r.area}] ${r.action} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
  console.log(`Code de sortie: ${process.exitCode}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
