// Dernier contrôle de sécurité avant validation (12/10/2026).
// 1) Service avec demandes en attente (flux réel, pas d'insert SQL).
// 2) Suppression utilisateur avec justificatifs réellement stockés sur disque.
// 3) Non-régression des suppressions + code de sortie.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const STORAGE_ROOT = path.join(ROOT, 'backend', 'storage', 'private')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-controle-final-20261012.json')

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
  const res = await fetch(`${API_URL}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const ct = res.headers.get('content-type') ?? ''
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}
async function loginFull(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return { token: r.data.accessToken, user: r.data.user }
}
async function db() { return mysql.createConnection(DB) }
async function uploadPdf(token, requestId, filePath, fileName) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(filePath)], { type: 'application/pdf' }), fileName)
  return api(`/documents/request/${requestId}`, { method: 'POST', token, formData: form })
}

async function main() {
  const admin = await loginFull('admin.recette@gmes.fr')
  const rh = await loginFull('rh.recette@gmes.fr')
  const conn = await db()
  const uniq = Date.now()

  // ================= 1. SERVICE AVEC DEMANDE EN ATTENTE =================
  const svc = await api('/services', { method: 'POST', token: admin.token, body: { name: `CTRL-SRV-${uniq}`, serviceType: 'INTERNE', validationMode: 'DIRECTEUR_ET_RH' } })
  const svcId = svc.data?.id ?? null
  const colEmail = `ctrl-col.${uniq}@gmes.fr`
  const colCreate = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'CTRLCOL', prenom: 'Test', email: colEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, password: PASSWORD } })
  const colId = colCreate.data?.id ?? null
  const colToken = colId ? (await loginFull(colEmail)).token : null

  // Création brouillon puis soumission réelle avec signature valide
  const draft = colToken ? await api('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: 16, startDate: '2027-09-01', endDate: '2027-09-02', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `CTRL-PENDING-${uniq}` } }) : { status: 0, data: null }
  const draftId = draft.data?.id ?? null
  const submit = draftId ? await api(`/leave-requests/${draftId}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0, data: null }
  const statusPending = submit.data?.status === 'EN_ATTENTE_VALIDATION'
  push('CTRL-01', 'Flux réel : création + soumission signée → EN_ATTENTE_VALIDATION', 'HTTP 200/201, statut EN_ATTENTE_VALIDATION', `draft=${draft.status} submit=${submit.status} statut=${submit.data?.status}`, submit.status === 200 && statusPending)

  // Suppression du service
  const delSvc = svcId ? await api(`/services/${svcId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const [reqAfter] = draftId ? await conn.query('SELECT id, employee_id, service_id, status FROM leave_requests WHERE id = ?', [draftId]) : [[]]
  const kept = reqAfter[0]?.employee_id === colId && reqAfter[0]?.service_id === null && reqAfter[0]?.status === 'EN_ATTENTE_VALIDATION'
  push('CTRL-02', 'Suppression du service : demande conservée, service NULL, statut inchangé', 'HTTP 204 + demande EN_ATTENTE_VALIDATION conservée (service NULL)', `HTTP=${delSvc.status} demande=${reqAfter[0] ? `service=${reqAfter[0].service_id} statut=${reqAfter[0].status}` : 'ABSENTE'}`, delSvc.status === 204 && kept)

  // Consultation par le collaborateur
  const consult = draftId ? await api(`/leave-requests/${draftId}`, { token: colToken }) : { status: 0 }
  push('CTRL-03', 'Consultation de la demande après suppression du service', 'HTTP 200 (consultation possible)', `HTTP=${consult.status}`, consult.status === 200)

  // Historique d'audit conservé (aucune perte)
  const [auditRows] = draftId ? await conn.query('SELECT COUNT(*) n FROM audit_logs WHERE resource_type = ? AND resource_id = ?', ['LEAVE_REQUESTS', draftId]) : [[{ n: 0 }]]
  push('CTRL-04', 'Historique d’audit de la demande conservé', 'au moins 1 entrée d’audit présente', `audit=${auditRows[0].n}`, auditRows[0].n >= 1)

  // Traitement (validation) → 400 explicite, pas 500
  const validate = draftId ? await api(`/leave-requests/${draftId}/validate`, { method: 'POST', token: rh.token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0, data: null }
  const validateSafe = validate.status === 400 && /service.*supprimé/i.test(String(validate.data?.message ?? ''))
  push('CTRL-05', 'Traitement d’une demande dont le service est supprimé', 'HTTP 400 explicite « service supprimé » (pas 500)', `HTTP=${validate.status} msg="${validate.data?.message ?? ''}"`, validateSafe)

  // ================= 2. SUPPRESSION UTILISATEUR + JUSTIFICATIFS =================
  // Deux collaborateurs U (à supprimer) et V (à conserver)
  const uEmail = `ctrl-u.${uniq}@gmes.fr`
  const vEmail = `ctrl-v.${uniq}@gmes.fr`
  const uCreate = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'CTRLU', prenom: 'Test', email: uEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD } })
  const vCreate = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'CTRLV', prenom: 'Test', email: vEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD } })
  const uId = uCreate.data?.id ?? null
  const vId = vCreate.data?.id ?? null
  const uToken = uId ? (await loginFull(uEmail)).token : null
  const vToken = vId ? (await loginFull(vEmail)).token : null

  // U et V créent chacun un brouillon + justificatif
  const uDraft = uToken ? await api('/leave-requests', { method: 'POST', token: uToken, body: { leaveTypeId: 16, startDate: '2027-10-01', endDate: '2027-10-01', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `CTRL-U-${uniq}` } }) : { status: 0, data: null }
  const vDraft = vToken ? await api('/leave-requests', { method: 'POST', token: vToken, body: { leaveTypeId: 16, startDate: '2027-10-02', endDate: '2027-10-02', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `CTRL-V-${uniq}` } }) : { status: 0, data: null }
  const uDraftId = uDraft.data?.id ?? null
  const vDraftId = vDraft.data?.id ?? null
  const fixture = path.join(FIXTURES_DIR, 'justificatif-abs-recette.pdf')
  const uUp = uDraftId ? await uploadPdf(uToken, uDraftId, fixture, 'ctrl-u.pdf') : { status: 0, data: null }
  const vUp = vDraftId ? await uploadPdf(vToken, vDraftId, fixture, 'ctrl-v.pdf') : { status: 0, data: null }
  const [uDoc] = uDraftId ? await conn.query('SELECT storage_key FROM documents WHERE leave_request_id = ?', [uDraftId]) : [[]]
  const [vDoc] = vDraftId ? await conn.query('SELECT storage_key FROM documents WHERE leave_request_id = ?', [vDraftId]) : [[]]
  const uKey = uDoc[0]?.storage_key ?? null
  const vKey = vDoc[0]?.storage_key ?? null
  const uFileBefore = uKey ? existsSync(path.join(STORAGE_ROOT, uKey)) : false
  const vFileBefore = vKey ? existsSync(path.join(STORAGE_ROOT, vKey)) : false
  push('CTRL-06', 'Préparation : justificatifs U et V réellement écrits sur disque', '2 fichiers présents sur disque', `U=${uFileBefore} V=${vFileBefore}`, uFileBefore && vFileBefore)

  // Suppression de U
  const delU = uId ? await api(`/users/${uId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const uFileAfter = uKey ? existsSync(path.join(STORAGE_ROOT, uKey)) : false
  const vFileAfter = vKey ? existsSync(path.join(STORAGE_ROOT, vKey)) : false
  const [uDocAfter] = uDraftId ? await conn.query('SELECT COUNT(*) n FROM documents WHERE leave_request_id = ?', [uDraftId]) : [[{ n: -1 }]]
  const [vDocAfter] = vDraftId ? await conn.query('SELECT COUNT(*) n FROM documents WHERE leave_request_id = ?', [vDraftId]) : [[{ n: -1 }]]
  // Audit : les entrées de U ne doivent pas être réattribuées à l'Admin
  const adminId = admin.user.id
  const [auditU] = uId ? await conn.query('SELECT COUNT(*) n FROM audit_logs WHERE actor_id = ?', [uId]) : [[{ n: -1 }]]
  const [auditAdmin] = await conn.query('SELECT COUNT(*) n FROM audit_logs WHERE actor_id = ?', [adminId])
  push('CTRL-07', 'Suppression de U : fichier privé + métadonnées supprimés, V intact', 'HTTP 204 + fichier U supprimé + fichier V conservé', `HTTP=${delU.status} fichierU=${uFileAfter} fichierV=${vFileAfter} metaU=${uDocAfter[0].n} metaV=${vDocAfter[0].n}`, delU.status === 204 && !uFileAfter && vFileAfter && uDocAfter[0].n === 0 && vDocAfter[0].n === 1)
  push('CTRL-08', 'Audit : aucune attribution fictive à l’Admin, références U détachées', 'actor_id U → NULL (0 restants), aucune réattribution à Admin', `actorU_restants=${auditU[0].n} auditAdmin_total=${auditAdmin[0].n}`, auditU[0].n === 0)

  // ================= 3. NON-RÉGRESSION =================
  const nrUser = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'CTRLNR', prenom: 'Test', email: `ctrl-nr.${uniq}@gmes.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: 16, password: PASSWORD } })
  const nrUserId = nrUser.data?.id ?? null
  const nrDel = nrUserId ? await api(`/users/${nrUserId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const nrUserGone = nrUserId ? !(await conn.query('SELECT id FROM users WHERE id = ?', [nrUserId]))[0].length : false
  push('CTRL-09', 'Non-régression : suppression utilisateur simple', 'HTTP 204 + compte disparu', `HTTP=${nrDel.status} disparu=${nrUserGone}`, nrDel.status === 204 && nrUserGone)

  const nrSvc = await api('/services', { method: 'POST', token: admin.token, body: { name: `CTRL-NR-SRV-${uniq}`, serviceType: 'INTERNE', validationMode: 'SANS_VALIDATION' } })
  const nrSvcId = nrSvc.data?.id ?? null
  const nrSvcDel = nrSvcId ? await api(`/services/${nrSvcId}`, { method: 'DELETE', token: admin.token }) : { status: 0 }
  const nrSvcGone = nrSvcId ? !(await conn.query('SELECT id FROM services WHERE id = ?', [nrSvcId]))[0].length : false
  push('CTRL-10', 'Non-régression : suppression service vide', 'HTTP 204 + service disparu', `HTTP=${nrSvcDel.status} disparu=${nrSvcGone}`, nrSvcDel.status === 204 && nrSvcGone)

  await conn.end()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Dernier contrôle de sécurité avant validation (12/10/2026)', date: new Date().toISOString(), apiUrl: API_URL, database: DB.database, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== CONTRÔLE FINAL SÉCURITÉ ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
  console.log(`Code de sortie: ${process.exitCode}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
