// Confidentialité des notifications entre profils : le profil Collaborateur
// (mode COLLABORATOR d'un compte RH/Responsable) ne voit que ses notifications
// PERSONNELLES ; un autre compte ne voit jamais les notifications d'un tiers.
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'NOTIF' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const collab = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `COL-${TAG}`, prenom: 'Recette', email: `col-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  await apiRequest(`/users/${collab.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'Notif2026!Pass' } })
  const collabToken = await login(`col-${TAG.toLowerCase()}@recette.fr`, 'Notif2026!Pass')

  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  // Le compte RH (id 2) pose aussi ses propres congés → une demande PERSONNELLE.
  const rhUserId = 2
  // Réinitialise les non-lues pour un comptage déterministe.
  await apiRequest('/notifications/my/read-all', { method: 'PATCH', token: rhToken, body: {} })

  const [collabLr] = await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-09-01','2026-09-03', 3, 3, 'EN_ATTENTE_VALIDATION')",
    [collab.id, type.id],
  )
  const [rhLr] = await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-09-10','2026-09-12', 3, 3, 'EN_ATTENTE_VALIDATION')",
    [rhUserId, type.id],
  )

  await conn.query(
    "INSERT INTO notifications (user_id, channel, type, title, message, leave_request_id) VALUES (?, 'APPLICATION', 'LEAVE_REQUEST_SUBMITTED', 'Demande à traiter', 'Un collaborateur a soumis une demande.', ?)",
    [rhUserId, collabLr.insertId],
  )
  await conn.query(
    "INSERT INTO notifications (user_id, channel, type, title, message, leave_request_id) VALUES (?, 'APPLICATION', 'LEAVE_REQUEST_SUBMITTED_SELF', 'Votre demande', 'Votre demande a été soumise.', ?)",
    [rhUserId, rhLr.insertId],
  )
  // Notifications SANS entité liée : l'une professionnelle (RH), l'autre personnelle.
  await conn.query(
    "INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'ACCRUAL_REGULARIZATION_FAILED', 'Régularisation à relancer', 'Relancez la régularisation.')",
    [rhUserId],
  )
  await conn.query(
    "INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'REFERENCE_PERIOD_CLOSED', 'Période clôturée', 'Votre période a été clôturée.')",
    [rhUserId],
  )

  const [notifIds] = await conn.query(
    "SELECT id, type FROM notifications WHERE user_id=? AND leave_request_id IN (?, ?) OR (user_id=? AND type IN ('ACCRUAL_REGULARIZATION_FAILED','REFERENCE_PERIOD_CLOSED'))",
    [rhUserId, collabLr.insertId, rhLr.insertId, rhUserId],
  )
  const mgmtNotifId = notifIds.find((n) => n.type === 'LEAVE_REQUEST_SUBMITTED')?.id
  const personalNotifId = notifIds.find((n) => n.type === 'LEAVE_REQUEST_SUBMITTED_SELF')?.id
  const mgmtNullLinkId = notifIds.find((n) => n.type === 'ACCRUAL_REGULARIZATION_FAILED')?.id
  const personalNullLinkId = notifIds.find((n) => n.type === 'REFERENCE_PERIOD_CLOSED')?.id

  // 1. Profil management (RH) : voit ses deux notifications.
  const all = await apiRequest('/notifications/my', { method: 'GET', token: rhToken })
  const allIds = (all.data ?? []).map((n) => n.id)
  rec('NOTIF-RH-ALL', 'Profil RH : voit ses notifications (gestion + personnelle)', allIds.includes(mgmtNotifId) && allIds.includes(personalNotifId), `ids=${allIds.join(',')}`)

  // 2. Profil Collaborateur (même compte) : uniquement les notifications
  //    personnelles, y compris les types sans entité liée professionnels exclus.
  const scoped = await apiRequest('/notifications/my?scope=COLLABORATOR', { method: 'GET', token: rhToken })
  const scopedIds = (scoped.data ?? []).map((n) => n.id)
  rec('NOTIF-COLLAB-SCOPE', 'Profil Collaborateur : uniquement les notifications personnelles', scopedIds.includes(personalNotifId) && !scopedIds.includes(mgmtNotifId) && !scopedIds.includes(mgmtNullLinkId) && scopedIds.includes(personalNullLinkId), `ids=${scopedIds.join(',')}`)

  // 3. Compteur non lus scopé : 2 personnelles non lues, les 2 professionnelles exclues.
  const scopedCount = await apiRequest('/notifications/my/unread-count?scope=COLLABORATOR', { method: 'GET', token: rhToken })
  const fullCount = await apiRequest('/notifications/my/unread-count', { method: 'GET', token: rhToken })
  rec('NOTIF-COLLAB-COUNT', 'Compteur non lus scopé : uniquement les personnelles (2/4)', Number(scopedCount.data?.unreadCount) === 2 && Number(fullCount.data?.unreadCount) === 4, `scoped=${scopedCount.data?.unreadCount} full=${fullCount.data?.unreadCount}`)

  // 4. Un AUTRE compte (collaborateur) ne voit aucune notification du RH.
  const other = await apiRequest('/notifications/my', { method: 'GET', token: collabToken })
  const otherHasRh = (other.data ?? []).some((n) => n.id === mgmtNotifId || n.id === personalNotifId)
  rec('NOTIF-AUTRE-COMPTE', 'Un autre compte ne voit aucune notification du RH', !otherHasRh, `count=${(other.data ?? []).length}`)

  // 5. Accès direct refusé : l'autre compte ne peut pas marquer lue la notif du RH.
  const crossRead = await apiRequest(`/notifications/${mgmtNotifId}/read`, { method: 'PATCH', token: collabToken, body: {} })
  rec('NOTIF-CROSS-READ-REFUSE', 'Accès direct à la notification d’un autre compte refusé (404)', crossRead.status === 404, `status=${crossRead.status}`)

  // 6. Marquage individuel scopé : une notification professionnelle (même sans
  //    entité liée) ne peut pas être marquée lue via le profil Collaborateur.
  const scopedReadMgmt = await apiRequest(`/notifications/${mgmtNullLinkId}/read?scope=COLLABORATOR`, { method: 'PATCH', token: rhToken, body: {} })
  const scopedReadPersonal = await apiRequest(`/notifications/${personalNullLinkId}/read?scope=COLLABORATOR`, { method: 'PATCH', token: rhToken, body: {} })
  rec('NOTIF-MARKREAD-SCOPE', 'Marquage individuel scopé : professionnel refusé (404), personnel autorisé (200)', scopedReadMgmt.status === 404 && scopedReadPersonal.status === 200, `mgmt=${scopedReadMgmt.status} personal=${scopedReadPersonal.status}`)

  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nCONFIDENTIALITÉ NOTIFICATIONS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR NOTIFICATIONS :', e); process.exit(1) })
