// Confidentialité des notifications — vérification complète :
//  - profil mixte Responsable/Collaborateur (même compte) ;
//  - compte Collaborateur pur : le scope est FACULTATIF mais le périmètre
//    personnel est TOUJOURS appliqué côté backend (aucune fuite d'un type
//    professionnel même sans `scope=COLLABORATOR`) ;
//  - deux comptes distincts ne se voient jamais mutuellement ;
//  - protections sur liste, compteur non lus, marquage individuel et global.
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const conn = await dbConn()
  const TAG = 'N2' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const type = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Congé-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  // Profil mixte : Responsable de service (possède ses propres congés + traite ceux de l'équipe).
  const resp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `RESP-${TAG}`, prenom: 'Resp', email: `resp-${TAG.toLowerCase()}@recette.fr`, role: 'RESPONSABLE_SERVICE', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  await apiRequest(`/users/${resp.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'Resp2026!Pass' } })
  const respToken = await login(`resp-${TAG.toLowerCase()}@recette.fr`, 'Resp2026!Pass')

  // Un collaborateur de son équipe.
  const member = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `MEM-${TAG}`, prenom: 'Memb', email: `mem-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data

  // Un collaborateur pur (sans rôle d'acteur).
  const collab = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `COL-${TAG}`, prenom: 'Coll', email: `col-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  await apiRequest(`/users/${collab.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'Col2026!Pass' } })
  const collabToken = await login(`col-${TAG.toLowerCase()}@recette.fr`, 'Col2026!Pass')

  // Un second compte collaborateur (isolation inter-comptes).
  const other = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `OTH-${TAG}`, prenom: 'Othe', email: `oth-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmes[0].id } })).data
  await apiRequest(`/users/${other.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'Oth2026!Pass' } })
  const otherToken = await login(`oth-${TAG.toLowerCase()}@recette.fr`, 'Oth2026!Pass')

  // Demandes : celle du membre (à traiter) et celle du responsable (personnelle).
  const [memberLr] = await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-09-01','2026-09-02', 2, 2, 'EN_ATTENTE_VALIDATION')",
    [member.id, type.id],
  )
  const [respLr] = await conn.query(
    "INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status) VALUES (?, ?, '2026-09-10','2026-09-11', 2, 2, 'VALIDEE')",
    [resp.id, type.id],
  )

  // Notifications du RESPONSABLE (profil mixte).
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message, leave_request_id) VALUES (?, 'APPLICATION', 'LEAVE_REQUEST_SUBMITTED', 'À traiter', 'Le membre a soumis une demande.', ?)", [resp.id, memberLr.insertId])
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message, leave_request_id) VALUES (?, 'APPLICATION', 'LEAVE_REQUEST_VALIDEE', 'Votre demande', 'Votre demande a été validée.', ?)", [resp.id, respLr.insertId])
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'ACCRUAL_REGULARIZATION_FAILED', 'Régularisation', 'Relance RH.')", [resp.id])
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'REFERENCE_PERIOD_CLOSED', 'Période', 'Votre période est clôturée.')", [resp.id])

  // Notification professionnelle (sans entité) injectée à tort sur le COLLABORATEUR pur.
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'BALANCE_CORRECTION_INFO', 'Correction', 'Correction de solde (acteur).')", [collab.id])
  // Notification personnelle (sans entité) du COLLABORATEUR pur.
  await conn.query("INSERT INTO notifications (user_id, channel, type, title, message) VALUES (?, 'APPLICATION', 'REFERENCE_PERIOD_CLOSED', 'Période', 'Votre période est clôturée.')", [collab.id])

  // Identifiants utiles.
  const [respRows] = await conn.query('SELECT id, type, leave_request_id FROM notifications WHERE user_id=? ORDER BY id', [resp.id])
  const respMgmt = respRows.find((n) => n.type === 'LEAVE_REQUEST_SUBMITTED')
  const respPersonal = respRows.find((n) => n.type === 'LEAVE_REQUEST_VALIDEE')
  const respMgmtNull = respRows.find((n) => n.type === 'ACCRUAL_REGULARIZATION_FAILED')
  const respPersonalNull = respRows.find((n) => n.type === 'REFERENCE_PERIOD_CLOSED')

  const [collabRows] = await conn.query('SELECT id, type FROM notifications WHERE user_id=? ORDER BY id', [collab.id])
  const collabMgmt = collabRows.find((n) => n.type === 'BALANCE_CORRECTION_INFO')
  const collabPersonal = collabRows.find((n) => n.type === 'REFERENCE_PERIOD_CLOSED')

  // ---- Profil mixte Responsable ----
  const respAll = await apiRequest('/notifications/my', { method: 'GET', token: respToken })
  const respAllIds = (respAll.data ?? []).map((n) => n.id)
  rec('N2-RESP-ALL', 'Responsable (sans scope) : voit ses 4 notifications', [respMgmt, respPersonal, respMgmtNull, respPersonalNull].every((n) => respAllIds.includes(n.id)), `count=${respAllIds.length}`)

  const respScoped = await apiRequest('/notifications/my?scope=COLLABORATOR', { method: 'GET', token: respToken })
  const respScopedIds = (respScoped.data ?? []).map((n) => n.id)
  rec('N2-RESP-SCOPE', 'Responsable (scope COLLABORATOR) : uniquement les 2 personnelles', respScopedIds.includes(respPersonal.id) && respScopedIds.includes(respPersonalNull.id) && !respScopedIds.includes(respMgmt.id) && !respScopedIds.includes(respMgmtNull.id), `ids=${respScopedIds.join(',')}`)

  const respCountFull = await apiRequest('/notifications/my/unread-count', { method: 'GET', token: respToken })
  const respCountScoped = await apiRequest('/notifications/my/unread-count?scope=COLLABORATOR', { method: 'GET', token: respToken })
  rec('N2-RESP-COUNT', 'Responsable : compteur non lus 4 (tout) / 2 (personnel)', Number(respCountFull.data?.unreadCount) === 4 && Number(respCountScoped.data?.unreadCount) === 2, `full=${respCountFull.data?.unreadCount} scoped=${respCountScoped.data?.unreadCount}`)

  const respReadMgmt = await apiRequest(`/notifications/${respMgmt.id}/read?scope=COLLABORATOR`, { method: 'PATCH', token: respToken, body: {} })
  const respReadPersonal = await apiRequest(`/notifications/${respPersonal.id}/read?scope=COLLABORATOR`, { method: 'PATCH', token: respToken, body: {} })
  rec('N2-RESP-MARKREAD', 'Responsable : marquage scopé (pro refusé 404, personnel autorisé 200)', respReadMgmt.status === 404 && respReadPersonal.status === 200, `mgmt=${respReadMgmt.status} personal=${respReadPersonal.status}`)

  // ---- Collaborateur pur : le scope est facultatif, le backend applique toujours le périmètre personnel ----
  const collabNoScope = await apiRequest('/notifications/my', { method: 'GET', token: collabToken })
  const collabNoScopeIds = (collabNoScope.data ?? []).map((n) => n.id)
  rec('N2-COL-NOSCOPE-LIST', 'Collaborateur SANS scope : la notif professionnelle injectée est exclue', collabNoScopeIds.includes(collabPersonal.id) && !collabNoScopeIds.includes(collabMgmt.id), `ids=${collabNoScopeIds.join(',')}`)

  const collabCountNoScope = await apiRequest('/notifications/my/unread-count', { method: 'GET', token: collabToken })
  rec('N2-COL-NOSCOPE-COUNT', 'Collaborateur SANS scope : compteur ne compte pas la professionnelle', Number(collabCountNoScope.data?.unreadCount) === 1, `count=${collabCountNoScope.data?.unreadCount}`)

  const collabReadMgmt = await apiRequest(`/notifications/${collabMgmt.id}/read`, { method: 'PATCH', token: collabToken, body: {} })
  rec('N2-COL-NOSCOPE-MARKREAD', 'Collaborateur SANS scope : marquage de la professionnelle refusé (404)', collabReadMgmt.status === 404, `status=${collabReadMgmt.status}`)

  // Marquage global : ne doit pas marquer lue la notification professionnelle.
  const collabReadAll = await apiRequest('/notifications/my/read-all', { method: 'PATCH', token: collabToken, body: {} })
  const [collabMgmtAfter] = await conn.query('SELECT read_at FROM notifications WHERE id=?', [collabMgmt.id])
  const [collabPersonalAfter] = await conn.query('SELECT read_at FROM notifications WHERE id=?', [collabPersonal.id])
  rec('N2-COL-NOSCOPE-READALL', 'Collaborateur SANS scope : read-all marque la personnelle mais PAS la professionnelle', Boolean(collabPersonalAfter[0]?.read_at) && !collabMgmtAfter[0]?.read_at, `updated=${collabReadAll.data?.updated} mgmtRead=${Boolean(collabMgmtAfter[0]?.read_at)} personalRead=${Boolean(collabPersonalAfter[0]?.read_at)}`)

  // ---- Deux comptes distincts ----
  const otherList = await apiRequest('/notifications/my', { method: 'GET', token: otherToken })
  const otherHas = (otherList.data ?? []).some((n) => n.id === collabPersonal.id || n.id === collabMgmt.id)
  rec('N2-OTHER-COMPTE', 'Autre compte : aucune notification du collaborateur', !otherHas, `count=${(otherList.data ?? []).length}`)

  const otherReadCollab = await apiRequest(`/notifications/${collabPersonal.id}/read`, { method: 'PATCH', token: otherToken, body: {} })
  rec('N2-OTHER-MARKREAD', 'Autre compte : marquage de la notif du collaborateur refusé (404)', otherReadCollab.status === 404, `status=${otherReadCollab.status}`)

  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nNOTIFICATIONS V2 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR NOTIFICATIONS V2 :', e); process.exit(1) })
