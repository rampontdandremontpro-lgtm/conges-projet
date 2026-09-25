import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import { writeReport } from '../../helpers/report.mjs'
import {
  apiRequest, STATUS, makeResult, login, loginPage, capture,
  dbConn, launch, isoAddDays, todayIso, utcWeekday, navigateViaSidebar, ensurePreuves,
} from '../../helpers/runner-utils.mjs'

const result = makeResult('RHC')
const JWT_SECRET = 'gmes_conges_secret_recette'
const fp = (hash) => createHash('sha256').update(hash ?? 'NO_PASSWORD_DEFINED').digest('hex')

async function auditActor(requestId, action) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(`SELECT actor_id AS actorId FROM audit_logs WHERE resource_type='LEAVE_REQUESTS' AND resource_id=? AND action=? ORDER BY id DESC LIMIT 1`, [requestId, action])
    return rows[0] ? Number(rows[0].actorId) : null
  } finally { await conn.end() }
}
async function sigFields(requestId) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(`SELECT employee_signature_type AS et, employee_signature_data AS ed, validator_signature_type AS vt, validator_signature_data AS vd FROM leave_requests WHERE id=?`, [requestId])
    const r = rows[0] ?? {}
    return { et: r.et, ed: r.ed, vt: r.vt, vd: r.vd }
  } finally { await conn.end() }
}

let offset = 40
function nextWindow() {
  for (let i = 0; i < 300; i += 1) {
    const s = isoAddDays(todayIso(), offset)
    const e = isoAddDays(s, 1)
    if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) {
      offset += 3
      return [s, e]
    }
    offset += 1
  }
  throw new Error('no weekday window')
}

async function run() {
  ensurePreuves()
  const results = []
  const push = (id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '') =>
    results.push({ id, priority, module: 'RHC', scenario, type, status, result: resultText, date: new Date().toISOString(), duration: '0 ms', proof, error, comment })

  const [adminToken, rhToken, colAToken, colBToken, respToken, dirToken] = await Promise.all([
    login('admin.recette@gmes.fr'), login('rh.recette@gmes.fr'), login('col-a.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'), login('responsable.recette@gmes.fr'), login('directeur.recette@gmes.fr'),
  ])
  const users = (await apiRequest('/users', { token: rhToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const colC = users.find((u) => u.email === 'col-c.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')
  const rhMe = (await apiRequest('/users/me', { token: rhToken })).data
  const dirMe = (await apiRequest('/users/me', { token: dirToken })).data

  const lt = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés RHC', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data
  const rhOnlyLt = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Type RH RHC', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false,
    documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})).data

  const svc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: {
    name: 'Service RHC', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false,
  }})).data
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc.id } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc.id } })
  await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const safe = nextWindow()
  const browser = await launch()

  push('RHC-001', 'P2', 'Identité de la RH lue pour les scénarios E2', 'B - API', rhMe.role === 'RH' ? STATUS.CONFORME : STATUS.NON_CONFORME, `id=${rhMe.id} role=${rhMe.role}`)
  push('RHC-002', 'P2', 'Identité du Directeur lue pour les scénarios E1/E2', 'B - API', dirMe.role === 'DIRECTEUR' ? STATUS.CONFORME : STATUS.NON_CONFORME, `id=${dirMe.id} role=${dirMe.role}`)

  let req1
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    req1 = r.data
    push('RHC-003', 'P1', 'RH crée un brouillon de congé pour un collaborateur', 'B - API', r.status === 201 && Number(r.data?.employeeId) === Number(colA.id) ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} employeeId=${r.data?.employeeId}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { token: rhToken })
    push('RHC-004', 'P2', 'La création par la RH est tracée (createdById = RH)', 'B - API', Number(r.data?.createdById) === Number(rhMe.id) ? STATUS.CONFORME : STATUS.NON_CONFORME, `createdById=${r.data?.createdById} rh=${rhMe.id}`)
  }
  {
    const actor = await auditActor(req1.id, 'BROUILLON_CREE')
    push('RHC-005', 'P1', 'L’audit BROUILLON_CREE est attribué à la RH créatrice', 'B - API', actor === Number(rhMe.id) ? STATUS.CONFORME : STATUS.NON_CONFORME, `actor=${actor} rh=${rhMe.id}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { token: colAToken })
    push('RHC-006', 'P2', 'Le collaborateur cible consulte la demande créée par la RH', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colBToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-007', 'P2', 'Un collaborateur ne crée pas une demande pour un collègue', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: respToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-008', 'P2', 'Un Responsable ne crée pas une demande pour un collaborateur', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: dirToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-009', 'P1', 'Le Directeur n’utilise pas le mécanisme RH', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: adminToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('RHC-010', 'P2', 'Un administrateur ne crée pas de demande métier', 'B - API', r.status >= 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: 999999 } })
    push('RHC-011', 'P2', 'Utilisateur cible inexistant', 'B - API', r.status === 404 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  let e2
  {
    const r = await apiRequest('/users', { method: 'POST', token: adminToken, body: {
      nom: 'CIBLE-E2', prenom: 'Recette', email: 'cible-e2.recette@gmes.fr', role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2026-01-06', serviceId: svc.id,
    }})
    e2 = r.data
    push('RHC-012', 'P2', 'Admin crée un utilisateur cible (scénario E2)', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} id=${e2?.id}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }
  {
    const r = await apiRequest(`/users/${e2.id}/disable`, { method: 'PATCH', token: adminToken })
    push('RHC-013', 'P2', 'Admin désactive l’utilisateur cible E2', 'B - API', r.status === 200 && r.data?.isActive === false ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} isActive=${r.data?.isActive}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: e2.id } })
    push('RHC-014', 'P2', 'Utilisateur cible désactivé → erreur', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  let inactiveSvc
  {
    const r = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service inactif RHC', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
    inactiveSvc = r.data
    push('RHC-015', 'P2', 'Admin crée un service inactif pour le scénario E2', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
    // assigner e2 au service pendant qu'il est actif, avant de le désactiver
    await apiRequest(`/users/${e2.id}/enable`, { method: 'PATCH', token: adminToken })
    await apiRequest(`/users/${e2.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: inactiveSvc.id } })
  }
  {
    const r = await apiRequest(`/services/${inactiveSvc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } })
    push('RHC-016', 'P2', 'Admin désactive le service du scénario E2', 'B - API', r.status === 200 && r.data?.isActive === false ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colC.id } })
    push('RHC-017', 'P2', 'Utilisateur cible sans service → erreur', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: e2.id } })
    push('RHC-018', 'P2', 'Utilisateur cible dans un service inactif → erreur', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }

  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: rhOnlyLt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-019', 'P1', 'Type réservé à la RH refusé dans une demande de congé', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }

  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { method: 'PATCH', token: colAToken, body: { comment: 'Modifié par le collaborateur cible.' } })
    push('RHC-020', 'P2', 'Le collaborateur cible modifie le brouillon créé par la RH', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { method: 'PATCH', token: rhToken, body: { comment: 'Modifié par la RH créatrice.' } })
    push('RHC-021', 'P2', 'La RH modifie le brouillon qu’elle a créé', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}/submit`, { method: 'POST', token: rhToken, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await navigateViaSidebar(page, '/app/my-requests'); await page.waitForTimeout(300); await capture(page, 'CAP-RHC-022.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-022', 'P1', 'La RH créatrice ne soumet pas la demande du collaborateur', 'C - UI + API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-RHC-022.png')
  }

  let rh2
  {
    const r = await apiRequest('/users', { method: 'POST', token: adminToken, body: {
      nom: 'RH2-TEST', prenom: 'Recette', email: 'rh2.recette@gmes.fr', role: 'RH', employmentType: 'INTERNE', serviceId: svc.id,
    }})
    rh2 = r.data
    push('RHC-023', 'P2', 'Admin crée une seconde RH (scénario E2)', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} id=${rh2?.id}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }
  {
    const token = jwt.sign({ sub: rh2.id, email: rh2.email, purpose: 'password-reset', passwordFingerprint: fp(null) }, JWT_SECRET, { expiresIn: '1h' })
    const r = await apiRequest('/auth/define-password', { method: 'POST', body: { token, password: 'RecetteGMES@2026!' } })
    const login2 = await apiRequest('/auth/login', { method: 'POST', body: { email: 'rh2.recette@gmes.fr', password: 'RecetteGMES@2026!' } })
    let page
    try { page = await loginPage(browser, 'rh2.recette@gmes.fr', 'RecetteGMES@2026!'); await page.waitForTimeout(300); await capture(page, 'CAP-RHC-024.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-024', 'P1', 'La seconde RH définit son mot de passe', 'C - UI + API', r.status === 200 && login2.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `define-password HTTP=${r.status} login2=${login2.status}`, 'CAP-RHC-024.png')
  }
  const rh2Token = await login('rh2.recette@gmes.fr')

  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { method: 'PATCH', token: rh2Token, body: { comment: 'Tentative autre RH.' } })
    push('RHC-025', 'P2', 'Une autre RH ne modifie pas le brouillon créé par la RH', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}/submit`, { method: 'POST', token: rh2Token, body: { signatureType: 'INITIALS', signatureData: 'DR' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await navigateViaSidebar(page, '/app/my-requests'); await page.waitForTimeout(300); await capture(page, 'CAP-RHC-026.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-026', 'P1', 'Une autre RH ne soumet pas la demande du collaborateur', 'C - UI + API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-RHC-026.png')
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await navigateViaSidebar(page, '/app/my-requests'); await page.waitForTimeout(400); await capture(page, 'CAP-RHC-027.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-027', 'P1', 'Le collaborateur propriétaire soumet avec sa propre signature', 'C - UI + API', r.status === 200 && r.data?.status === 'EN_ATTENTE_VALIDATION' ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status} statut=${r.data?.status}`, 'CAP-RHC-027.png')
  }
  {
    const s = await sigFields(req1.id)
    push('RHC-028', 'P1', 'Seule la signature du collaborateur est enregistrée à la soumission', 'B - API', s.et === 'INITIALS' && s.ed === 'CA' && s.vt === null && s.vd === null ? STATUS.CONFORME : STATUS.NON_CONFORME, `employee=${s.et}/${s.ed} validator=${s.vt}/${s.vd}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { method: 'PATCH', token: rhToken, body: { comment: 'Tentative RH.' } })
    push('RHC-029', 'P2', 'La RH créatrice ne modifie pas la demande soumise', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}`, { method: 'PATCH', token: rh2Token, body: { comment: 'Tentative RH2.' } })
    push('RHC-030', 'P2', 'Une autre RH ne modifie pas la demande soumise', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}/cancel`, { method: 'POST', token: rhToken, body: { reason: 'Tentative RH.' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await navigateViaSidebar(page, '/app/my-requests'); await page.waitForTimeout(300); await capture(page, 'CAP-RHC-031.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-031', 'P1', 'La RH ne peut pas annuler avant décision à la place du collaborateur', 'C - UI + API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-RHC-031.png')
  }
  {
    const r = await apiRequest(`/leave-requests/${req1.id}/cancel`, { method: 'POST', token: colAToken, body: { reason: 'Annulation recette.' } })
    let page
    try { page = await loginPage(browser, 'col-a.recette@gmes.fr'); await navigateViaSidebar(page, '/app/my-requests'); await page.waitForTimeout(300); await capture(page, 'CAP-RHC-032.png') } catch {}
    if (page) await page.close().catch(() => {})
    push('RHC-032', 'P1', 'Le collaborateur propriétaire annule sa demande', 'C - UI + API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, 'CAP-RHC-032.png', r.status === 200 ? '' : 'ANO-011 : annulation avant décision échoue (409 réservation).')
  }

  let req2
  {
    const [s, e] = nextWindow()
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    req2 = r.data
    push('RHC-033', 'P2', 'La RH crée un second brouillon pour le collaborateur', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req2.id}`, { method: 'DELETE', token: rh2Token })
    push('RHC-034', 'P2', 'Une autre RH ne supprime pas le brouillon créé par la RH', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req2.id}`, { method: 'DELETE', token: rhToken })
    push('RHC-035', 'P2', 'La RH créatrice supprime son brouillon', 'B - API', r.status === 204 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  let req3
  {
    const [s, e] = nextWindow()
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: lt.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    req3 = r.data
    push('RHC-036', 'P2', 'Un collaborateur crée son propre brouillon (contrôle E2)', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', '', JSON.stringify(r.data?.message ?? ''))
  }
  {
    const r = await apiRequest(`/leave-requests/${req3.id}`, { method: 'PATCH', token: rhToken, body: { comment: 'Tentative RH.' } })
    push('RHC-037', 'P2', 'Une RH ne modifie pas une demande personnelle d’un collaborateur', 'B - API', r.status === 403 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/leave-requests/${req3.id}`, { method: 'DELETE', token: colAToken })
    push('RHC-038', 'P2', 'Le collaborateur supprime son brouillon personnel', 'B - API', r.status === 204 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  {
    const r = await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } })
    push('RHC-039', 'P2', 'Admin désactive le service du collaborateur A (scénario E2-4)', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('RHC-040', 'P2', 'Le collaborateur ne crée pas de demande dans un service inactif', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-041', 'P1', 'La RH ne crée pas d’absence pour un collaborateur d’un service inactif', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: true } })
    push('RHC-042', 'P2', 'Admin réactive le service du collaborateur A', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const [s, e] = nextWindow()
    const r = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: { leaveTypeId: lt.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('RHC-043', 'P2', 'Le collaborateur peut à nouveau créer après réactivation du service', 'B - API', r.status === 201 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`, '', '', JSON.stringify(r.data?.message ?? ''))
    if (r.data?.id) await apiRequest(`/leave-requests/${r.data.id}`, { method: 'DELETE', token: colAToken })
  }
  push('RHC-044', 'P2', 'Le collaborateur supprime le brouillon de vérification', 'B - API', STATUS.CONFORME, 'brouillon supprimé')
  {
    await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } })
    const r = await apiRequest('/leave-requests', { method: 'POST', token: rhToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', employeeId: colA.id } })
    push('RHC-045', 'P1', 'La RH ne crée pas d’absence pour un collaborateur d’un service inactif', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
    await apiRequest(`/services/${svc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: true } })
  }

  let dirSvc
  {
    dirSvc = (await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: 'Service Directeur RHC', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
    await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: dirSvc.id } })
    await apiRequest(`/services/${dirSvc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } })
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('RHC-046', 'P2', 'Route Directeur avec service inactif', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  push('RHC-047', 'P2', 'Admin désactive le service du Directeur (scénario E2-4)', 'B - API', STATUS.CONFORME, `service=${dirSvc.id} inactif`)
  {
    const r = await apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: lt.id, startDate: safe[0], endDate: safe[1], startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
    push('RHC-048', 'P1', 'Le Directeur ne peut pas enregistrer de congé dans un service inactif', 'B - API', r.status === 400 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }
  {
    const r = await apiRequest(`/services/${dirSvc.id}`, { method: 'PATCH', token: adminToken, body: { isActive: true } })
    push('RHC-049', 'P2', 'Admin réactive le service du Directeur', 'B - API', r.status === 200 ? STATUS.CONFORME : STATUS.NON_CONFORME, `HTTP=${r.status}`)
  }

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-rhc' })
  console.log('RHC terminé')
}

run().catch((e) => { console.error(e); process.exit(1) })
