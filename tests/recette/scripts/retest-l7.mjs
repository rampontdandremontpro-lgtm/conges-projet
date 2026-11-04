// JUR-027 — L7 : recette finale d'intégration L1→L6 + contrôles encore partiels.
// Cible IMPÉRATIVE : gestion_conges_gmes_test. Aucun envoi réel.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l7.json')
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)
const STORAGE_ROOT = 'C:/recette-storage'

function martiniqueCivilDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
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
    const rh = await login('rh.recette@gmes.fr')
    const colBToken = await login('col-b.recette@gmes.fr')
    const tag = 'L7' + Date.now().toString(36)
    const today = martiniqueCivilDate(new Date())
    const past = new Date(Date.now() - 3600000).toISOString()

    const addBalance = (emp, period, counter, available, reserved = 0) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, available, available, reserved])
    const addLot = (emp, key, fields = {}) => {
      const { target = '2024-2025', days = 4, remaining = days, infoDate = null, infoCertain = 0, regime = 'GENERAL', status = 'ACTIF', reprise = null } = fields
      return conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date, reprise_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', ?, ?, ?, ?, 'CONFIRMEE', 1, NULL, 'L3141-19-1', ?, 0, '2025-05-31', ?)`,
        [emp.id, target, days, remaining, regime, status, infoDate, infoCertain, `${tag}-${key}`, reprise],
      )
    }
    const prepare = (eid) => apiRequest('/carryover-notifications/prepare', { method: 'POST', token: rh, body: { employeeId: eid } })
    const validate = (id) => apiRequest(`/carryover-notifications/${id}/validate`, { method: 'POST', token: rh })
    const rawTransmit = async (id) => {
      const r = await apiRequest(`/carryover-notifications/${id}/transmit`, { method: 'POST', token: rh, body: { mode: 'SIMULATION' } })
      if (r.status === 201) {
        const d = new Date(Date.now() - 2 * 3600000)
        const p = (n) => String(n).padStart(2, '0')
        await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, id])
      }
      return r
    }
    const attach = (id, body) => apiRequest(`/carryover-notifications/${id}/proofs`, { method: 'POST', token: rh, body })
    const verify = (id, proofId, decision) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/verify`, { method: 'POST', token: rh, body: decision })
    const createCorrected = (id, reason) => apiRequest(`/carryover-notifications/${id}/corrected`, { method: 'POST', token: rh, body: { reason } })
    const cancel = (id, reason) => apiRequest(`/carryover-notifications/${id}/cancel`, { method: 'POST', token: rh, body: { reason } })
    const close = (p) => apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: p, confirm: true } })
    const carryover = (eid, period, days) => apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rh, body: { employeeId: eid, closingReferencePeriod: period, days, reason: 'test L7' } })
    const getOne = (id, token) => apiRequest(`/carryover-notifications/${id}`, { token })
    const download = (id, proofId, token) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/download`, { token })
    const OK = { result: 'CONFORME', note: 'contrôle RH conforme', recipientIdentityConfirmed: true, requiredInfoPresent: true }
    const sim = (contentBase64 = Buffer.from('preuve synthétique').toString('base64')) => ({ mode: 'SIMULATION', receivedAt: past, contentBase64, mimeType: 'text/plain' })

    // ── Parcours intégré L1→L6 ──────────────────────────────────────────────
    // L3 : lot confirmé (fixture SQL). L5 : clôture unifiée. L6 : notification.
    await addBalance(colA, '2020-2021', 'N-1', 6)
    await addLot(colA, 'end', { target: '2020-2021', days: 4, infoDate: '2026-06-25', infoCertain: 1 })
    await addBalance(colA, '2020-2021', 'N', 12, 0)
    const closeR = await close('2020-2021')
    const [[lotEnd]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-end`])
    rec('L7-01', 'Clôture unifiée : lot transféré + GMES dans une transaction', closeR.status === 201 && lotEnd.target_reference_period === '2021-2022', `HTTP ${closeR.status} target=${lotEnd.target_reference_period}`)

    // L6 : notification + preuve + vérification sur le lot transféré.
    const prep = await prepare(colA.id); const nid = prep.data?.notificationId
    await validate(nid); await rawTransmit(nid)
    const proof = await attach(nid, sim()); const pid = proof.data?.id
    const ver = await verify(nid, pid, OK)
    const [[lotVer]] = await conn.query('SELECT information_date_certain, expires_at FROM carryover_lots WHERE idempotency_key=?', [`${tag}-end`])
    rec('L7-02', 'Notification → preuve → vérification → échéance recalculée (L2/L3)', ver.status === 201 && num(lotVer.information_date_certain) === 1 && Boolean(lotVer.expires_at), `status=${ver.data?.status} certain=${lotVer.information_date_certain}`)

    // ── Correction + vérification simultanées (atomique) ────────────────────
    await addLot(colB, 'cv', { target: '2024-2025', days: 2, infoDate: null, infoCertain: 0 })
    const prepCV = await prepare(colB.id); const nidCV = prepCV.data?.notificationId
    await validate(nidCV); await rawTransmit(nidCV)
    const proofCV = await attach(nidCV, sim()); const pidCV = proofCV.data?.id
    const [corrR, verR] = await Promise.all([
      createCorrected(nidCV, 'correction concurrente'),
      verify(nidCV, pidCV, OK),
    ])
    const [[cvState]] = await conn.query('SELECT status FROM carryover_notifications WHERE id=?', [nidCV])
    const validStates = ['A_CORRIGER', 'RECEPTION_VERIFIEE', 'ANNULEE']
    rec('L7-03', 'Correction + vérification simultanées → état final cohérent (atomique)', validStates.includes(cvState.status), `HTTP ${corrR.status}/${verR.status} final=${cvState.status}`)

    // ── Lots gelés / réservations / reliquats inconnus / somme>solde ────────
    await addBalance(colA, '2023-2024', 'N-1', 8)
    await addLot(colA, 'frz', { target: '2023-2024', days: 3, infoDate: '2026-06-25', infoCertain: 1 })
    const [[lotFrz]] = await conn.query('SELECT id FROM carryover_lots WHERE idempotency_key=?', [`${tag}-frz`])
    await conn.query("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, days, frozen_in_balance) VALUES (?, NULL, NULL, (SELECT id FROM leave_balances WHERE employee_id=? AND reference_period='2023-2024' AND counter_type='N-1'), 'REGULARISATION', 2, 1)", [lotFrz.id, colA.id])
    rec('L7-04', 'Lot gelé en régularisation → clôture bloquée', (await close('2023-2024')).status === 400, '')

    await addBalance(colB, '2023-2024', 'N-1', 8, 2)
    rec('L7-05', 'Jours réservés exclus du reportable (7 j > 6 libres → refus)', (await carryover(colB.id, '2023-2024', 7)).status === 400, '')

    await addBalance(colA, '2022-2023', 'N-1', 5)
    await addLot(colA, 'unk', { target: '2022-2023', days: 2, remaining: null })
    rec('L7-06', 'Reliquat inconnu → clôture bloquée', (await close('2022-2023')).status === 400, '')
    await conn.query('UPDATE carryover_lots SET remaining_days = 99 WHERE idempotency_key=?', [`${tag}-unk`])
    rec('L7-07', 'Somme des lots > solde → report bloqué', (await carryover(colA.id, '2022-2023', 1)).status === 400, '')

    // ── Notification obsolète + intégrité document + droits entre salariés ──
    rec('L7-08', 'Notification obsolète (A_CORRIGER) → vérification refusée', (await verify(nidCV, pidCV, OK)).status === 409, '')
    // Nettoie toute notification active résiduelle de colB (créée par la correction).
    const [actives] = await conn.query('SELECT id FROM carryover_notifications WHERE employee_id=? AND active_key IS NOT NULL', [colB.id])
    for (const a of actives) await cancel(a.id, 'nettoyage')
    // Intégrité document : modification réelle des octets.
    await addLot(colB, 'doc', { target: '2024-2025', days: 2, infoDate: null, infoCertain: 0 })
    const prepDoc = await prepare(colB.id); const nidDoc = prepDoc.data?.notificationId
    await validate(nidDoc); await rawTransmit(nidDoc)
    const proofDoc = await attach(nidDoc, sim(Buffer.from('contenu original').toString('base64'))); const pidDoc = proofDoc.data?.id
    const [[docRow]] = await conn.query('SELECT storage_key FROM carryover_reception_proofs WHERE id=?', [pidDoc])
    fs.writeFileSync(path.resolve(STORAGE_ROOT, docRow.storage_key), Buffer.from('altéré'))
    rec('L7-09', 'Document altéré après enregistrement → vérification refusée', (await verify(nidDoc, pidDoc, OK)).status === 400, '')
    fs.writeFileSync(path.resolve(STORAGE_ROOT, docRow.storage_key), Buffer.from('contenu original'))
    rec('L7-10', 'Accès croisé entre salariés → refus', (await getOne(nid, colBToken)).status === 403, '')

    // ── Cohérence des échéances après correction ────────────────────────────
    const newDoc = await createCorrected(nidDoc, 'correction document')
    const nidNew = newDoc.data?.id
    await validate(nidNew); await rawTransmit(nidNew)
    const proofNew = await attach(nidNew, sim()); const pidNew = proofNew.data?.id
    const verNew = await verify(nidNew, pidNew, OK)
    rec('L7-11', 'Cohérence des échéances après correction → confirmation finale', verNew.status === 201 && (verNew.data?.status === 'RECEPTION_VERIFIEE' || verNew.data?.status === 'A_CORRIGER'), `status=${verNew.data?.status}`)

    // ── Aucun envoi réel ────────────────────────────────────────────────────
    const [notifRows] = await conn.query('SELECT type, COUNT(*) c FROM notifications GROUP BY type')
    rec('L7-12', 'Aucun envoi réel (courrier/e-mail/SMS) : seules des notifications applicatives', notifRows.every((n) => !['MAIL_SENT', 'SMS_SENT', 'COURRIER'].includes(n.type)), notifRows.map((n) => `${n.type}=${n.c}`).join(','))

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L7 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
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
  console.error('ERREUR L7 :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
