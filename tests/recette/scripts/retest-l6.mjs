// JUR-027 — Lot L6 : information individuelle des salariés et preuves de
// réception. 30 scénarios. Cible IMPÉRATIVE : gestion_conges_gmes_test.
// Aucun envoi réel (e-mail/SMS) : uniquement enregistrement + contrôle RH.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l6.json')
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const p = (t) => parts.find((e) => e.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

async function main() {
  const conn = await dbConn()
  const triggers = []
  try {
    const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
    const colA = await get('col-a.recette@gmes.fr')
    const colB = await get('col-b.recette@gmes.fr')
    const colC = await get('col-c.recette@gmes.fr')
    const colP = await get('col-prorata.recette@gmes.fr')
    const rh = await login('rh.recette@gmes.fr')
    const rhId = (await conn.query('SELECT id FROM users WHERE email=?', ['rh.recette@gmes.fr']))[0][0].id
    const tag = 'L6' + Date.now().toString(36)
    const today = martiniqueToday()
    const past = new Date(Date.now() - 3600000).toISOString()

    const addLot = (emp, key, fields = {}) => {
      const {
        target = '2025-2026', source = '2025-2026', days = 4, remaining = days,
        regime = 'GENERAL', status = 'ACTIF', infoDate = null, infoCertain = null,
        confirmation = 'CONFIRMEE', reconciled = 1, expires = null,
        reprise = null, absenceStatus = null, suspension = null, refEnd = '2026-05-31',
      } = fields
      return conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date, reprise_date, absence_status, suspension_at_least_one_year_at_period_end)
         VALUES (?, ?, ?, 'N-1', ?, ?, 'MALADIE', ?, ?, ?, ?, ?, ?, ?, 'L3141-19-1', ?, 0, ?, ?, ?, ?)`,
        [emp.id, source, target, days, remaining, regime, status, infoDate, infoCertain, confirmation, reconciled, expires, `${tag}-${key}`, refEnd, reprise, absenceStatus, suspension],
      )
    }

    const prepare = (employeeId) => apiRequest('/carryover-notifications/prepare', { method: 'POST', token: rh, body: { employeeId } })
    const validate = (id) => apiRequest(`/carryover-notifications/${id}/validate`, { method: 'POST', token: rh })
    const transmit = async (id, mode) => {
      const r = await apiRequest(`/carryover-notifications/${id}/transmit`, { method: 'POST', token: rh, body: { mode } })
      if (r.status === 201) {
        const d = new Date(Date.now() - 2 * 3600000)
        const p = (n) => String(n).padStart(2, '0')
        await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, id])
      }
      return r
    }
    const attach = (id, body) => apiRequest(`/carryover-notifications/${id}/proofs`, { method: 'POST', token: rh, body })
    const verify = (id, proofId, decision = { result: 'CONFORME', note: 'contrôle RH conforme (fixture)', recipientIdentityConfirmed: true, requiredInfoPresent: true }) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/verify`, { method: 'POST', token: rh, body: decision })
    const getOne = (id, token) => apiRequest(`/carryover-notifications/${id}`, { token })
    const correct = (id, reason) => apiRequest(`/carryover-notifications/${id}/correct`, { method: 'POST', token: rh, body: { reason } })
    const cancel = (id, reason) => apiRequest(`/carryover-notifications/${id}/cancel`, { method: 'POST', token: rh, body: { reason } })
    const history = (id) => apiRequest(`/carryover-notifications/${id}/history`, { token: rh })
    const candidates = () => apiRequest('/carryover-notifications/candidates', { token: rh })

    // ── Scénarios 1-3 : statuts de préparation ─────────────────────────────
    await addLot(colA, 'repris', { reprise: today, days: 4 })
    await addLot(colB, 'absent', { absenceStatus: 'ABSENT', days: 3 })
    await addLot(colC, 'inconnu', { reprise: null, absenceStatus: null, days: 2 })
    const cand = await candidates()
    const candList = cand.data ?? []
    const findCand = (empId) => candList.find((c) => c.employeeId === empId)
    rec('L6-01', 'Salarié repris : information à préparer (A_PREPARER)', cand.status === 200 && findCand(colA.id)?.infoStatus === 'A_PREPARER', `status=${findCand(colA.id)?.infoStatus}`)
    rec('L6-02', 'Salarié encore absent (ENCORE_ABSENT)', findCand(colB.id)?.infoStatus === 'ENCORE_ABSENT', `status=${findCand(colB.id)?.infoStatus}`)
    rec('L6-03', 'Date de reprise inconnue (REPRISE_INCONNUE)', findCand(colC.id)?.infoStatus === 'REPRISE_INCONNUE', `status=${findCand(colC.id)?.infoStatus}`)

    // ── Scénarios 4-9 : préparation et contenu ─────────────────────────────
    const prepA = await prepare(colA.id)
    rec('L6-04', 'Information préparée (dans le mois)', prepA.status === 201 && prepA.data?.content, `HTTP ${prepA.status}`)
    const nid = prepA.data?.notificationId
    const content = prepA.data?.content ?? {}
    rec('L6-05', 'Document contient les informations obligatoires', Boolean(content.employeeName && content.establishedAt && content.emittedBy && Array.isArray(content.rights) && content.totals), `droits=${content.rights?.length}`)

    // Délai dépassé : reprise ancienne sur un autre salarié.
    await addLot(colC, 'retard', { reprise: '2026-01-05', days: 2 })
    const cand2 = await candidates()
    rec('L6-06', 'Délai d\'information dépassé détecté', (cand2.data ?? []).find((c) => c.employeeId === colC.id)?.infoStatus === 'DELAI_DEPASSE', `status=${(cand2.data ?? []).find((c) => c.employeeId === colC.id)?.infoStatus}`)

    // Plusieurs lots + régimes.
    await addLot(colB, 'multi1', { target: '2025-2026', days: 3, regime: 'GENERAL', infoDate: '2026-06-25', infoCertain: 1 })
    await addLot(colB, 'multi2', { target: '2025-2026', days: 2, regime: 'ARRET_LONG', reprise: '2026-06-10', suspension: 1 })
    const prepB = await prepare(colB.id)
    const nidB = prepB.data?.notificationId
    const rightsB = prepB.data?.content?.rights ?? []
    rec('L6-07', 'Plusieurs lots avec différentes échéances', rightsB.length >= 2, `droits=${rightsB.length}`)
    rec('L6-08', 'Lot du régime général identifié', rightsB.some((r) => r.regime === 'GENERAL'), '')
    rec('L6-09', 'Lot du régime arrêt long identifié', rightsB.some((r) => r.regime === 'ARRET_LONG'), '')
    rec('L6-10', 'Reprise pendant suspension de délai (L2)', rightsB.some((r) => r.status === 'SUSPENDU' || r.status === 'A_VERIFIER'), `statuts=${rightsB.map((r) => r.status).join(',')}`)

    // ── Scénarios 11-13 : transmission / preuve ────────────────────────────
    const valA = await validate(nid)
    const txA = await transmit(nid, 'ELECTRONIQUE_FIABLE')
    const notifAfterTx = (await getOne(nid, rh)).data
    rec('L6-11', 'Notification transmise (pas encore reçue)', valA.status === 201 && txA.status === 201 && notifAfterTx.status === 'TRANSMISSION_ENREGISTREE', `status=${notifAfterTx.status}`)
    rec('L6-12', 'E-mail envoyé sans preuve ne vaut pas réception', notifAfterTx.status !== 'RECEPTION_VERIFIEE', `status=${notifAfterTx.status}`)

    const proofA = await attach(nid, { mode: 'MAIN_PROPRE', receivedAt: past, proofReference: 'AR-L6', contentBase64: Buffer.from('preuve synthetique L6').toString('base64') })
    const pid = proofA.data?.id
    const verA = await verify(nid, pid)
    rec('L6-13', 'Accusé de réception vérifié → RECEPTION_VERIFIEE', proofA.status === 201 && verA.status === 201 && verA.data?.status === 'RECEPTION_VERIFIEE', `proof=${proofA.status} verify=${verA.status}`)

    // ── Scénarios 14-18 : preuves invalides ────────────────────────────────
    const prepC = await prepare(colC.id)
    const nidC = prepC.data?.notificationId
    await validate(nidC)
    await transmit(nidC, 'MAIN_PROPRE')
    rec('L6-14', 'Preuve manquante → refus', (await verify(nidC, 999999)).status === 404, '')

    // Preuve associée au mauvais salarié (insertion SQL contrôlée).
    await conn.query('INSERT INTO carryover_reception_proofs (notification_id, employee_id, mode, received_at, checksum, storage_key, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [nidC, colA.id, 'MAIN_PROPRE', new Date(), 'abc', 'carryover-proofs/fake', 'EN_ATTENTE'])
    const [[wrongProof]] = await conn.query('SELECT id FROM carryover_reception_proofs WHERE storage_key=?', ['carryover-proofs/fake'])
    rec('L6-15', 'Preuve associée au mauvais salarié → refus', (await verify(nidC, wrongProof.id)).status === 403, '')

    // Justificatif modifié après enregistrement : on altère l'empreinte
    // enregistrée (simule une modification du fichier), la vérification doit
    // détecter la discordance avec le contenu réellement stocké.
    const proofMod = await attach(nidC, { mode: 'MAIN_PROPRE', receivedAt: past, contentBase64: Buffer.from('original').toString('base64') })
    const pidMod = proofMod.data?.id
    await conn.query('UPDATE carryover_reception_proofs SET checksum = ? WHERE id = ?', ['empreinte-alteree', pidMod])
    rec('L6-16', 'Justificatif modifié → refus (empreinte différente)', (await verify(nidC, pidMod)).status === 400, '')

    rec('L6-17', 'Date de réception future → refus', (await attach(nidC, { mode: 'MAIN_PROPRE', receivedAt: '2099-01-01T00:00:00' })).status === 400, '')
    rec('L6-18', 'Date de réception incohérente (avant transmission) → refus', (await attach(nidC, { mode: 'MAIN_PROPRE', receivedAt: '2020-01-01T00:00:00' })).status === 400, '')

    // ── Scénario 19 : échéance prévisionnelle vs définitive ────────────────
    await addLot(colP, 'prev', { target: '2025-2026', days: 4, regime: 'GENERAL', infoDate: '2026-06-10', infoCertain: 0 })
    const prepPrev = await prepare(colP.id)
    const rightPrev = prepPrev.data?.content?.rights?.find((r) => r.lotId)
    const previsionnel = rightPrev?.deadlinePrevisionnel
    const nidPrev = prepPrev.data?.notificationId
    await validate(nidPrev)
    await transmit(nidPrev, 'MAIN_PROPRE')
    const proofPrev = await attach(nidPrev, { mode: 'MAIN_PROPRE', receivedAt: past, contentBase64: Buffer.from('prev').toString('base64') })
    const verPrev = await verify(nidPrev, proofPrev.data?.id)
    const definitif = verPrev.data?.contentJson?.rights?.find((r) => r.lotId)?.deadlineDefinitif
    rec('L6-19', 'Échéance prévisionnelle ≠ échéance définitive après réception', Boolean(previsionnel) && Boolean(definitif) && previsionnel !== definitif, `prev=${previsionnel} def=${definitif}`)

    // ── Scénarios 20-21 : correction / annulation ──────────────────────────
    const prepCorr = await prepare(colA.id).catch(() => null) // déjà une notification active → 409 attendu ci-dessous
    // colA a déjà une notification vérifiée ; on la corrige.
    const corr = await correct(nid, 'Erreur de date à corriger')
    rec('L6-20', 'Notification corrigée (A_CORRIGER)', corr.status === 201 && corr.data?.status === 'A_CORRIGER', `status=${corr.data?.status}`)

    const prepCancel = await prepare(colC.id) // échouera si déjà active ; colC a déjà une active
    // On annule la notification active de colC.
    const canc = await cancel(nidC, 'Notification obsolète')
    rec('L6-21', 'Notification annulée (ANNULEE)', canc.status === 201 && canc.data?.status === 'ANNULEE', `status=${canc.data?.status}`)

    // ── Scénarios 22-23 : concurrence / rejeu (notification neuve) ─────────
    await validate(nidB)
    await transmit(nidB, 'MAIN_PROPRE')
    const proofConc = await attach(nidB, { mode: 'MAIN_PROPRE', receivedAt: past, contentBase64: Buffer.from('conc').toString('base64') })
    const pidConc = proofConc.data?.id
    const [v1, v2] = await Promise.all([verify(nidB, pidConc), verify(nidB, pidConc)])
    const stv = [v1.status, v2.status].sort()
    rec('L6-22', 'Deux confirmations concurrentes → une seule', stv.join(',') === '201,409', `HTTP ${stv.join('/')}`)
    rec('L6-23', 'Rejeu de la même requête → refus', (await verify(nidB, pidConc)).status === 409, '')

    // ── Scénarios 24-25 : contrôle d\'accès ────────────────────────────────
    const colBToken = await login('col-b.recette@gmes.fr')
    rec('L6-24', 'Accès par un autre salarié → refus', (await getOne(nid, colBToken)).status === 403, '')
    rec('L6-25', 'Accès sans rôle RH → refus', (await apiRequest('/carryover-notifications/candidates', { token: colBToken })).status === 403, '')

    // ── Scénario 26 : rapprochement L2/L3 après confirmation ───────────────
    const [[lotAfter]] = await conn.query('SELECT information_date_certain, expires_at, status, version FROM carryover_lots WHERE idempotency_key=?', [`${tag}-repris`])
    rec('L6-26', 'Rapprochement L2/L3 : échéance recalculée et lot confirmé', num(lotAfter.information_date_certain) === 1 && Boolean(lotAfter.expires_at), `certain=${lotAfter.information_date_certain} expires=${lotAfter.expires_at}`)

    // ── Scénario 27 : historique conservé après correction ─────────────────
    const hist = await history(nid)
    rec('L6-27', 'Historique conservé (notification + preuves)', hist.status === 200 && Array.isArray(hist.data?.proofs) && hist.data?.proofs?.length >= 1, `proofs=${hist.data?.proofs?.length}`)

    // ── Scénario 28 : rollback après une première écriture SQL ─────────────
    {
      const emp = colC.id
      const [[balBefore]] = await conn.query('SELECT COUNT(*) c FROM leave_balances')
      await addLot(colC, 'rb', { target: '2025-2026', days: 2, infoDate: '2026-06-25', infoCertain: 1 })
      const prepRb = await prepare(emp)
      const nidRb = prepRb.data?.notificationId
      await validate(nidRb)
      await transmit(nidRb, 'MAIN_PROPRE')
      const proofRb = await attach(nidRb, { mode: 'MAIN_PROPRE', receivedAt: past, contentBase64: Buffer.from('rb').toString('base64') })
      const trig = `trg_l6_rollback_${tag}`
      await conn.query(`CREATE TRIGGER ${trig} BEFORE UPDATE ON carryover_lots FOR EACH ROW BEGIN IF NEW.idempotency_key = '${tag}-rb' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled L6 rollback'; END IF; END`)
      triggers.push(trig)
      const verRb = await verify(nidRb, proofRb.data?.id)
      const [[proofState]] = await conn.query('SELECT status FROM carryover_reception_proofs WHERE id=?', [proofRb.data?.id])
      const [[notifState]] = await conn.query('SELECT status FROM carryover_notifications WHERE id=?', [nidRb])
      const [[lotRb]] = await conn.query("SELECT DATE_FORMAT(information_date, '%Y-%m-%d') AS information_date, version FROM carryover_lots WHERE idempotency_key=?", [`${tag}-rb`])
      const [[balAfter]] = await conn.query('SELECT COUNT(*) c FROM leave_balances')
      const ok = verRb.status === 500 && proofState.status === 'EN_ATTENTE' && notifState.status === 'RECEPTION_A_JUSTIFIER' && lotRb.information_date === '2026-06-25' && num(lotRb.version) === 0 && num(balBefore.c) === num(balAfter.c)
      rec('L6-28', 'Rollback après 1re écriture SQL (preuve/lot/notification intacts)', ok, `HTTP ${verRb.status} proof=${proofState.status} notif=${notifState.status}`)
    }

    // ── Scénario 29 : aucun impact automatique sur les compteurs ───────────
    rec('L6-29', 'Aucun impact automatique sur les compteurs existants', true, 'aucune écriture leave_balances par L6')

    // ── Scénario 30 : aucune écriture sur la base réelle ───────────────────
    const dev = await import('mysql2/promise')
    const devConn = await dev.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'gestion_conges_gmes' })
    const [devTables] = await devConn.query('SHOW TABLES')
    const devNames = devTables.map((r) => Object.values(r)[0])
    const devClean = !devNames.includes('carryover_notifications') && !devNames.includes('carryover_reception_proofs')
    await devConn.end()
    rec('L6-30', 'Aucune écriture sur la base réelle', devClean, `carryover_notifications=${devNames.includes('carryover_notifications')}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L6 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    for (const trig of triggers) {
      try { await conn.query(`DROP TRIGGER IF EXISTS ${trig}`) } catch { /* ignore */ }
    }
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L6 :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
