// Correction finale : demandes en attente après suppression d'un service (12/10/2026).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const REPORT_PATH = path.join(REPORTS_DIR, 'retest-demandes-service-supprime-20261012.json')

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
  const data = res.status === 204 ? null : ct.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}
async function loginFull(email) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  return { token: r.data.accessToken, user: r.data.user }
}
async function db() { return mysql.createConnection(DB) }

function weekdayAhead(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d
}
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function setupPendingRequest(adminToken, uniq, suffix) {
  // Crée un service, un collaborateur, une demande soumise EN_ATTENTE_VALIDATION, puis supprime le service.
  const svc = await api('/services', { method: 'POST', token: adminToken, body: { name: `SV-SUPPR-${suffix}-${uniq}`, serviceType: 'INTERNE', validationMode: 'DIRECTEUR_ET_RH' } })
  const svcId = svc.data?.id ?? null
  const email = `suppr-${suffix.toLowerCase()}.${uniq}@gmes.fr`
  const col = await api('/users', { method: 'POST', token: adminToken, body: { nom: `SUPPR${suffix}`, prenom: 'Test', email, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, password: PASSWORD } })
  const colId = col.data?.id ?? null
  const colToken = colId ? (await loginFull(email)).token : null
  const d1 = '2027-03-15'
  const d2 = '2027-03-16'
  const draft = colToken ? await api('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: 16, startDate: d1, endDate: d2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `SUPPR-${suffix}-${uniq}` } }) : { status: 0, data: null }
  const draftId = draft.data?.id ?? null
  const submit = draftId ? await api(`/leave-requests/${draftId}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0, data: null }
  const del = svcId ? await api(`/services/${svcId}`, { method: 'DELETE', token: adminToken }) : { status: 0 }
  return { svcId, colId, colToken, draftId, submitStatus: submit.status, pending: submit.data?.status === 'EN_ATTENTE_VALIDATION', delStatus: del.status }
}

async function main() {
  const admin = await loginFull('admin.recette@gmes.fr')
  const rh = await loginFull('rh.recette@gmes.fr')
  const resp = await loginFull('responsable.recette@gmes.fr')
  const conn = await db()
  const uniq = Date.now()

  // ============ SCÉNARIO A — Acceptation RH ============
  const A = await setupPendingRequest(admin.token, uniq, 'A')
  push('A-01', 'Scénario A : création + soumission → EN_ATTENTE_VALIDATION', '201/200, statut EN_ATTENTE_VALIDATION', `submit=${A.submitStatus} pending=${A.pending}`, A.pending)
  push('A-02', 'Scénario A : suppression du service (demande conservée)', 'HTTP 204', `del=${A.delStatus}`, A.delStatus === 204)
  const [aReq] = A.draftId ? await conn.query('SELECT id, service_id, status FROM leave_requests WHERE id = ?', [A.draftId]) : [[]]
  push('A-03', 'Scénario A : demande conservée avec service NULL', 'service_id NULL, statut EN_ATTENTE_VALIDATION', `service=${aReq[0]?.service_id} statut=${aReq[0]?.status}`, aReq[0]?.service_id === null && aReq[0]?.status === 'EN_ATTENTE_VALIDATION')
  const rhList = await api('/leave-requests/management/all', { token: rh.token })
  const inRhList = Array.isArray(rhList.data) && rhList.data.some((r) => r.id === A.draftId)
  push('A-04', 'Scénario A : demande visible dans l’interface RH (management/all)', 'présente', `visible=${inRhList}`, inRhList)
  const validateA = A.draftId ? await api(`/leave-requests/${A.draftId}/validate`, { method: 'POST', token: rh.token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0, data: null }
  push('A-05', 'Scénario A : acceptation par la RH', 'HTTP 200, statut VALIDEE', `HTTP=${validateA.status} statut=${validateA.data?.status} msg=${validateA.data?.message ?? ''}`, validateA.status === 200 && validateA.data?.status === 'VALIDEE')
  const [aAudit] = A.draftId ? await conn.query("SELECT COUNT(*) n FROM audit_logs WHERE resource_id = ? AND action = 'DEMANDE_VALIDEE'", [A.draftId]) : [[{ n: 0 }]]
  const [aNotif] = A.draftId ? await conn.query('SELECT COUNT(*) n FROM notifications WHERE leave_request_id = ?', [A.draftId]) : [[{ n: 0 }]]
  push('A-06', 'Scénario A : audit + notifications produits', 'audit DEMANDE_VALIDEE + notification', `audit=${aAudit[0].n} notif=${aNotif[0].n}`, aAudit[0].n >= 1 && aNotif[0].n >= 1)

  // ============ SCÉNARIO B — Refus RH ============
  const B = await setupPendingRequest(admin.token, uniq, 'B')
  const refuseB = B.draftId ? await api(`/leave-requests/${B.draftId}/refuse`, { method: 'POST', token: rh.token, body: { comment: 'Refus de test après suppression du service.' } }) : { status: 0, data: null }
  push('B-01', 'Scénario B : refus par la RH après suppression du service', 'HTTP 200, statut REFUSEE', `HTTP=${refuseB.status} statut=${refuseB.data?.status} msg=${refuseB.data?.message ?? ''}`, refuseB.status === 200 && refuseB.data?.status === 'REFUSEE')
  const colSeesRefusal = B.colToken && B.draftId ? await api(`/leave-requests/${B.draftId}`, { token: B.colToken }) : { status: 0, data: null }
  push('B-02', 'Scénario B : collaborateur voit le résultat du refus', 'HTTP 200, statut REFUSEE visible', `HTTP=${colSeesRefusal.status} statut=${colSeesRefusal.data?.status}`, colSeesRefusal.status === 200 && colSeesRefusal.data?.status === 'REFUSEE')

  // ============ SCÉNARIO C — Sécurité ============
  const C = await setupPendingRequest(admin.token, uniq, 'C')
  const selfValidate = C.draftId ? await api(`/leave-requests/${C.draftId}/validate`, { method: 'POST', token: C.colToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  push('C-01', 'Collaborateur ne peut pas valider sa propre demande', 'HTTP 403', `HTTP=${selfValidate.status}`, selfValidate.status === 403)
  const respValidate = C.draftId ? await api(`/leave-requests/${C.draftId}/validate`, { method: 'POST', token: resp.token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  push('C-02', 'Responsable ne reçoit pas les droits RH (service supprimé)', 'HTTP 403', `HTTP=${respValidate.status}`, respValidate.status === 403)
  const colOtherValidate = C.draftId ? await api(`/leave-requests/${C.draftId}/validate`, { method: 'POST', token: (await loginFull('col-a.recette@gmes.fr')).token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  push('C-03', 'Utilisateur non autorisé → HTTP 403', 'HTTP 403', `HTTP=${colOtherValidate.status}`, colOtherValidate.status === 403)
  const validateC1 = C.draftId ? await api(`/leave-requests/${C.draftId}/validate`, { method: 'POST', token: rh.token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  const validateC2 = C.draftId ? await api(`/leave-requests/${C.draftId}/validate`, { method: 'POST', token: rh.token, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  push('C-04', 'Demande déjà traitée → pas de 2e décision', '2e validation refusée (400/409)', `v1=${validateC1.status} v2=${validateC2.status}`, validateC1.status === 200 && [400, 409].includes(validateC2.status))

  // ============ Non-régression : validation ordinaire (service existant) ============
  const nrSvc = await api('/services', { method: 'POST', token: admin.token, body: { name: `NR-SRV-${uniq}`, serviceType: 'INTERNE', validationMode: 'DIRECTEUR_ET_RH' } })
  const nrSvcId = nrSvc.data?.id ?? null
  const nrEmail = `nr-ord.${uniq}@gmes.fr`
  const nrCol = await api('/users', { method: 'POST', token: admin.token, body: { nom: 'NRORD', prenom: 'Test', email: nrEmail, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: nrSvcId, password: PASSWORD } })
  const nrColId = nrCol.data?.id ?? null
  const nrColToken = nrColId ? (await loginFull(nrEmail)).token : null
  const d1 = isoOf(weekdayAhead(460 + (uniq % 30)))
  const d2 = isoOf(weekdayAhead(461 + (uniq % 30)))
  const nrDraft = nrColToken ? await api('/leave-requests', { method: 'POST', token: nrColToken, body: { leaveTypeId: 16, startDate: d1, endDate: d2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR-ORDINAIRE-${uniq}` } }) : { status: 0, data: null }
  const nrDraftId = nrDraft.data?.id ?? null
  const nrSubmit = nrDraftId ? await api(`/leave-requests/${nrDraftId}/submit`, { method: 'POST', token: nrColToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } }) : { status: 0 }
  const nrValidate = nrDraftId ? await api(`/leave-requests/${nrDraftId}/validate`, { method: 'POST', token: rh.token, body: { signatureType: 'INITIALS', signatureData: 'DR', rhConfirmedDirectorAgreement: true } }) : { status: 0, data: null }
  push('NR-01', 'Non-régression : validation ordinaire (service existant)', 'HTTP 200, statut VALIDEE', `submit=${nrSubmit.status} validate=${nrValidate.status} statut=${nrValidate.data?.status}`, nrSubmit.status === 200 && nrValidate.status === 200 && nrValidate.data?.status === 'VALIDEE')

  await conn.end()

  const summary = { total: results.length, conformes: results.filter(r => r.pass === 'Conforme').length, nonConformes: results.filter(r => r.pass === 'Non conforme').length, allConformes: results.every(r => r.pass === 'Conforme') }
  const report = { title: 'Demandes en attente après suppression d’un service (12/10/2026)', date: new Date().toISOString(), apiUrl: API_URL, database: DB.database, summary, results }
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  process.exitCode = summary.allConformes ? 0 : 1

  console.log('\n=== DEMANDES EN ATTENTE APRÈS SUPPRESSION SERVICE ===')
  for (const r of results) console.log(`${r.pass === 'Conforme' ? 'OK ' : 'XX '} ${r.id} → ${r.observed}`)
  console.log(`\nTotal: ${summary.total} | Conformes: ${summary.conformes} | Non conformes: ${summary.nonConformes}`)
  console.log(`Rapport: ${REPORT_PATH}`)
  console.log(`SHA-256: ${createHash('sha256').update(readFileSync(REPORT_PATH)).digest('hex')}`)
  console.log(`Code de sortie: ${process.exitCode}`)
}

main().catch((e) => { console.error('ERREUR', e); process.exit(1) })
