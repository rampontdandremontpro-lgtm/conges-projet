import { writeReport } from '../../helpers/report.mjs'
import {
  apiRequest, STATUS, makeResult, login, loginPage, capture,
  dbConn, launch, isoAddDays, todayIso, navigateViaSidebar, ensurePreuves,
} from '../../helpers/runner-utils.mjs'

const result = makeResult('NOT')

async function backdateRequest(id, startDate, endDate) {
  const conn = await dbConn()
  try {
    await conn.execute('UPDATE leave_requests SET start_date = ?, end_date = ? WHERE id = ?', [startDate, endDate, id])
  } finally {
    await conn.end()
  }
}

async function countReminderNotifications(requestId) {
  const conn = await dbConn()
  try {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS c FROM notifications WHERE leave_request_id = ? AND type LIKE 'LEAVE_REQUEST_REMINDER_J%'`,
      [requestId],
    )
    return Number(rows[0].c)
  } finally {
    await conn.end()
  }
}

async function run() {
  ensurePreuves()
  const results = []

  const [colAToken, colBToken, rhToken, adminToken, respToken] = await Promise.all([
    login('col-a.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('admin.recette@gmes.fr'),
    login('responsable.recette@gmes.fr'),
  ])

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const resp = users.find((u) => u.email === 'responsable.recette@gmes.fr')

  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: {
    name: 'Congés payés NOT', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true,
    documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true,
    rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
  }})
  const leaveTypeId = lt.data?.id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: {
    name: 'Service NOT', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false,
  }})
  const serviceId = svc.data?.id
  await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${resp.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/services/${serviceId}`, { method: 'PATCH', token: adminToken, body: { primaryManagerId: resp.id, validationMode: 'RESPONSABLE_PUIS_RELAIS' } })

  const submitReq = (id, token) => apiRequest(`/leave-requests/${id}/submit`, { method: 'POST', token, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

  const browser = await launch()
  const today = todayIso()

  // Fixture expiration : demande soumise avec une date conforme (hors été), puis backdatée à aujourd'hui.
  const expStart = isoAddDays(today, 40)
  const expDraft = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: {
    leaveTypeId, startDate: expStart, endDate: isoAddDays(expStart, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
  }})
  const expId = expDraft.data?.id
  await submitReq(expId, colAToken)

  // ===== NOT-001 — RH exécute la maintenance =====
  {
    const start = Date.now()
    try {
      const run = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
      const ok = run.status === 200 && typeof run.data === 'object' && Array.isArray(run.data?.errors)
      results.push(result({ id: 'NOT-001', priority: 'P2', scenario: 'RH exécute la maintenance automatique', type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `POST maintenance/run HTTP=${run.status} | expirées=${run.data?.expiredRequests} | rappels=${run.data?.remindersCreated}`,
        error: ok ? '' : 'Maintenance non exécutable.',
        comment: `expiredRequestId=${expId}`,
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-001', priority: 'P2', scenario: 'RH exécute la maintenance automatique', type: 'B - API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    }
  }
  console.log(`NOT-001 ${results[results.length-1].status}`)

  // ===== NOT-002 — demande échue → EXPIREE_NON_VALIDEE =====
  {
    const start = Date.now()
    let page
    try {
      await backdateRequest(expId, today, isoAddDays(today, 1))
      await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
      const after = await apiRequest(`/leave-requests/${expId}`, { token: colAToken })
      const expired = after.data?.status === 'EXPIREE_NON_VALIDEE'

      page = await loginPage(browser, 'col-a.recette@gmes.fr')
      await navigateViaSidebar(page, '/app/my-requests')
      await page.waitForSelector('.my-request-card', { timeout: 10000 })
      await page.waitForTimeout(300)
      await capture(page, 'CAP-NOT-002.png')

      results.push(result({ id: 'NOT-002', priority: 'P1', scenario: 'La demande arrivée à échéance passe à EXPIREE_NON_VALIDEE', type: 'C - UI + API',
        status: expired ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `statut=${after.data?.status} (attendu EXPIREE_NON_VALIDEE)`,
        proof: 'CAP-NOT-002.png',
        error: expired ? '' : 'La demande échue n’est pas passée EXPIREE_NON_VALIDEE.',
        comment: `expiredRequestId=${expId}`,
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-002', priority: 'P1', scenario: 'La demande arrivée à échéance passe à EXPIREE_NON_VALIDEE', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    } finally { if (page) await page.close().catch(() => {}) }
  }
  console.log(`NOT-002 ${results[results.length-1].status}`)

  // ===== NOT-003 — idempotence dans la journée =====
  {
    const start = Date.now()
    try {
      const secondRun = await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
      const ok = secondRun.status === 200 && Number(secondRun.data?.expiredRequests) === 0
      results.push(result({ id: 'NOT-003', priority: 'P2', scenario: 'La maintenance est idempotente dans la journée', type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `2e run HTTP=${secondRun.status} | expirées=${secondRun.data?.expiredRequests}`,
        error: ok ? '' : 'Second passage non idempotent.',
        comment: 'secondRun',
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-003', priority: 'P2', scenario: 'La maintenance est idempotente dans la journée', type: 'B - API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    }
  }
  console.log(`NOT-003 ${results[results.length-1].status}`)

  // ===== NOT-004 — pas de rappel quotidien dupliqué =====
  let reminderRequestId
  {
    const start = Date.now()
    try {
      const remStart = isoAddDays(today, 42)
      const draft = await apiRequest('/leave-requests', { method: 'POST', token: colAToken, body: {
        leaveTypeId, startDate: remStart, endDate: isoAddDays(remStart, 1), startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
      }})
      reminderRequestId = draft.data?.id
      await submitReq(reminderRequestId, colAToken)
      await backdateRequest(reminderRequestId, isoAddDays(today, 5), isoAddDays(today, 6))
      await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
      const before = await countReminderNotifications(reminderRequestId)
      await apiRequest('/leave-requests/maintenance/run', { method: 'POST', token: rhToken })
      const after = await countReminderNotifications(reminderRequestId)
      const ok = before > 0 && before === after
      results.push(result({ id: 'NOT-004', priority: 'P2', scenario: 'Pas de rappel quotidien dupliqué', type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `rappels avant=${before} après=${after}`,
        error: ok ? '' : 'Rappel dupliqué ou absent.',
        comment: `reminderRequestId=${reminderRequestId}`,
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-004', priority: 'P2', scenario: 'Pas de rappel quotidien dupliqué', type: 'B - API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    }
  }
  console.log(`NOT-004 ${results[results.length-1].status}`)

  // Notification COL-A (créée par l'expiration NOT-002).
  let notifId
  let unreadBefore
  {
    const my = await apiRequest('/notifications/my', { token: colAToken })
    const list = Array.isArray(my.data) ? my.data : []
    notifId = list[0]?.id
    const unread = await apiRequest('/notifications/my/unread-count', { token: colAToken })
    unreadBefore = Number(unread.data?.unreadCount ?? 0)
  }

  // ===== NOT-005 — collaborateur consulte ses notifications (UI) =====
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'col-a.recette@gmes.fr')
      await navigateViaSidebar(page, '/app/notifications')
      await page.waitForSelector('.notifications-page-card, .notifications-page__empty', { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(300)
      const count = await page.locator('.notifications-page-card').count()
      const ok = count > 0
      results.push(result({ id: 'NOT-005', priority: 'P2', scenario: 'Collaborateur consulte ses notifications', type: 'A - UI',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `notifications visibles=${count}`,
        error: ok ? '' : 'Aucune notification visible.',
        comment: 'route=/app/notifications',
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-005', priority: 'P2', scenario: 'Collaborateur consulte ses notifications', type: 'A - UI', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    } finally { if (page) await page.close().catch(() => {}) }
  }
  console.log(`NOT-005 ${results[results.length-1].status}`)

  // ===== NOT-006 — autre utilisateur ne marque pas la notification lue =====
  {
    const start = Date.now()
    try {
      const before = await apiRequest('/notifications/my/unread-count', { token: colAToken })
      const attempt = await apiRequest(`/notifications/${notifId}/read`, { method: 'PATCH', token: colBToken })
      const after = await apiRequest('/notifications/my/unread-count', { token: colAToken })
      const ok = attempt.status === 404 && Number(before.data?.unreadCount) === Number(after.data?.unreadCount)
      results.push(result({ id: 'NOT-006', priority: 'P2', scenario: 'Autre utilisateur ne marque pas la notification comme lue', type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PATCH read HTTP=${attempt.status} | unread ${before.data?.unreadCount}→${after.data?.unreadCount}`,
        error: ok ? '' : 'Un tiers a pu modifier la notification.',
        comment: `notificationId=${notifId}, acteur=COL-B`,
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-006', priority: 'P2', scenario: 'Autre utilisateur ne marque pas la notification comme lue', type: 'B - API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    }
  }
  console.log(`NOT-006 ${results[results.length-1].status}`)

  // ===== NOT-007 — propriétaire marque une notification lue (UI) =====
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'col-a.recette@gmes.fr')
      await navigateViaSidebar(page, '/app/notifications')
      const btn = page.locator('.notifications-page-card__action button', { hasText: 'Ouvrir' }).first()
      await btn.waitFor({ state: 'visible', timeout: 10000 })
      const patchPromise = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/notifications\/\d+\/read$/.test(new URL(r.url()).pathname), { timeout: 10000 })
      await btn.click()
      const patchResp = await patchPromise
      await page.waitForTimeout(300)
      const ok = patchResp.status() === 200
      results.push(result({ id: 'NOT-007', priority: 'P2', scenario: 'Propriétaire marque une notification comme lue', type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `PATCH read UI HTTP=${patchResp.status()}`,
        error: ok ? '' : 'Marquage lu impossible.',
        comment: 'route=/app/notifications',
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-007', priority: 'P2', scenario: 'Propriétaire marque une notification comme lue', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    } finally { if (page) await page.close().catch(() => {}) }
  }
  console.log(`NOT-007 ${results[results.length-1].status}`)

  // ===== NOT-008 — compteur non lues =====
  {
    const start = Date.now()
    try {
      const c = await apiRequest('/notifications/my/unread-count', { token: colAToken })
      const after = Number(c.data?.unreadCount ?? 0)
      const ok = c.status === 200 && after < unreadBefore
      results.push(result({ id: 'NOT-008', priority: 'P2', scenario: 'Compteur des notifications non lues', type: 'B - API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `unreadCount avant=${unreadBefore} après=${after}`,
        error: ok ? '' : 'Compteur non lues incohérent.',
        comment: 'unread-count',
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-008', priority: 'P2', scenario: 'Compteur des notifications non lues', type: 'B - API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    }
  }
  console.log(`NOT-008 ${results[results.length-1].status}`)

  // ===== NOT-009 — marquer toutes lues (UI) =====
  {
    const start = Date.now()
    let page
    try {
      page = await loginPage(browser, 'col-a.recette@gmes.fr')
      await navigateViaSidebar(page, '/app/notifications')
      const btn = page.locator('.notifications-page__read-all')
      await btn.waitFor({ state: 'visible', timeout: 10000 })
      const patchPromise = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/notifications\/my\/read-all$/.test(new URL(r.url()).pathname), { timeout: 10000 })
      await btn.click()
      const patchResp = await patchPromise
      await page.waitForTimeout(300)
      const c = await apiRequest('/notifications/my/unread-count', { token: colAToken })
      const ok = patchResp.status() === 200 && Number(c.data?.unreadCount ?? 1) === 0
      results.push(result({ id: 'NOT-009', priority: 'P2', scenario: 'Utilisateur marque toutes ses notifications comme lues', type: 'C - UI + API',
        status: ok ? STATUS.CONFORME : STATUS.NON_CONFORME,
        resultText: `read-all UI HTTP=${patchResp.status()} | unreadCount=${c.data?.unreadCount}`,
        error: ok ? '' : 'Marquage global impossible.',
        comment: 'route=/app/notifications',
        duration: Date.now() - start }))
    } catch (e) {
      results.push(result({ id: 'NOT-009', priority: 'P2', scenario: 'Utilisateur marque toutes ses notifications comme lues', type: 'C - UI + API', status: STATUS.BLOQUE, resultText: e.message, error: e.message, duration: Date.now() - start }))
    } finally { if (page) await page.close().catch(() => {}) }
  }
  console.log(`NOT-009 ${results[results.length-1].status}`)

  await browser.close()
  results.sort((a, b) => a.id.localeCompare(b.id))
  writeReport(results, { label: 'recette-results-not' })
  console.log('NOT terminé')
}

run().catch((e) => { console.error(e); process.exit(1) })
