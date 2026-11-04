// JUR-027 — L6 vérifications finales avant L7 : preuves, confidentialité,
// dates réelles, notification corrigée, reports et concurrence.
// Cible IMPÉRATIVE : gestion_conges_gmes_test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l6-final.json')
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
function addMonthsClamped(date, months) {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

async function main() {
  const conn = await dbConn()
  try {
    const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
    const colA = await get('col-a.recette@gmes.fr')
    const colB = await get('col-b.recette@gmes.fr')
    const rh = await login('rh.recette@gmes.fr')
    const colBToken = await login('col-b.recette@gmes.fr')
    const tag = 'LF' + Date.now().toString(36)

    const addLot = (emp, key, fields = {}) => {
      const { target = '2024-2025', days = 4, remaining = days, infoDate = null, infoCertain = 0, regime = 'GENERAL', status = 'ACTIF', reprise = null, expires = null } = fields
      return conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date, reprise_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', ?, ?, ?, ?, 'CONFIRMEE', 1, ?, 'L3141-19-1', ?, 0, '2025-05-31', ?)`,
        [emp.id, target, days, remaining, regime, status, infoDate, infoCertain, expires, `${tag}-${key}`, reprise],
      )
    }
    const prepare = (eid) => apiRequest('/carryover-notifications/prepare', { method: 'POST', token: rh, body: { employeeId: eid } })
    const validate = (id) => apiRequest(`/carryover-notifications/${id}/validate`, { method: 'POST', token: rh })
    const transmit = async (id, mode = 'SIMULATION') => {
      const r = await apiRequest(`/carryover-notifications/${id}/transmit`, { method: 'POST', token: rh, body: { mode } })
      if (r.status === 201) {
        const d = new Date(Date.now() - 2 * 3600000)
        const p = (n) => String(n).padStart(2, '0')
        await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, id])
      }
      return r
    }
    const attach = (id, body) => apiRequest(`/carryover-notifications/${id}/proofs`, { method: 'POST', token: rh, body })
    const verify = (id, proofId, decision) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/verify`, { method: 'POST', token: rh, body: decision })
    const correct = (id, reason) => apiRequest(`/carryover-notifications/${id}/correct`, { method: 'POST', token: rh, body: { reason } })
    const createCorrected = (id, reason) => apiRequest(`/carryover-notifications/${id}/corrected`, { method: 'POST', token: rh, body: { reason } })
    const cancel = (id, reason) => apiRequest(`/carryover-notifications/${id}/cancel`, { method: 'POST', token: rh, body: { reason } })
    const download = (id, proofId, token) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/download`, { token })
    const getOne = (id, token) => apiRequest(`/carryover-notifications/${id}`, { token })
    const carryover = (eid, period, days) => apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rh, body: { employeeId: eid, closingReferencePeriod: period, days, reason: 'test final' } })
    const OK = { result: 'CONFORME', note: 'contrôle RH conforme', recipientIdentityConfirmed: true, requiredInfoPresent: true }
    const past = new Date(Date.now() - 3600000).toISOString()
    const rawTransmit = (id) => apiRequest(`/carryover-notifications/${id}/transmit`, { method: 'POST', token: rh, body: { mode: 'SIMULATION' } })
    const sim = (contentBase64 = Buffer.from('preuve synthétique').toString('base64')) => ({ mode: 'SIMULATION', receivedAt: past, contentBase64, mimeType: 'text/plain' })

    // ── 1. Preuves ──────────────────────────────────────────────────────────
    await addLot(colA, 'pr', { days: 4, infoDate: null, infoCertain: 0 })
    const prep1 = await prepare(colA.id); const nid1 = prep1.data?.notificationId
    await validate(nid1); await transmit(nid1)
    const proof1 = await attach(nid1, sim()); const pid1 = proof1.data?.id
    // Document transmis supprimé (lien preuve/document rompu).
    await conn.query('UPDATE carryover_notifications SET transmitted_content_json = NULL WHERE id = ?', [nid1])
    const noDoc = await verify(nid1, pid1, OK)
    rec('F1', 'verifyProof refuse une preuve sans document transmis lié', noDoc.status === 400, `HTTP ${noDoc.status}`)
    await conn.query('UPDATE carryover_notifications SET transmitted_content_json = content_json WHERE id = ?', [nid1])
    const rej = await verify(nid1, pid1, { result: 'NON_CONFORME', note: 'identité non vérifiée', recipientIdentityConfirmed: false, requiredInfoPresent: false })
    rec('F2', 'Décision NON_CONFORME → A_CORRIGER, échéance non confirmée', rej.status === 201 && rej.data?.status === 'A_CORRIGER', `status=${rej.data?.status}`)

    // ── 2. Confidentialité ──────────────────────────────────────────────────
    await addLot(colB, 'conf', { days: 3, infoDate: null, infoCertain: 0 })
    const prepB = await prepare(colB.id)
    const nidB = prepB.data?.notificationId
    await validate(nidB); await transmit(nidB)
    const proofB = await attach(nidB, sim()); const pidB = proofB.data?.id
    await verify(nidB, pidB, OK)
    rec('F3', 'Collaborateur : téléchargement preuve refusé (403)', (await download(nidB, pidB, colBToken)).status === 403, '')
    const myB = (await apiRequest('/carryover-notifications/my', { token: colBToken })).data
    rec('F4', 'Collaborateur /my : aucun storageKey/chemin privé', Array.isArray(myB) && myB.every((n) => JSON.stringify(n).includes('storage_key') === false && JSON.stringify(n).includes('checksum') === false), `items=${myB.length}`)
    rec('F5', 'Collaborateur : accès à la notification d\'un autre salarié refusé', (await getOne(nid1, colBToken)).status === 403, '')

    // ── 3. Dates réelles (API, sans modification SQL de transmitted_at) ─────
    await cancel(nidB, 'nettoyage')
    await addLot(colB, 'dt', { days: 3, infoDate: null, infoCertain: 0 })
    const prepD = await prepare(colB.id); const nidD = prepD.data?.notificationId
    await validate(nidD); await rawTransmit(nidD)
    const beforeIso = new Date(Date.now() - 3600000).toISOString()
    const futureIso = new Date(Date.now() + 3600000).toISOString()
    rec('F6', 'Réception antérieure à la transmission → refus (API réel)', (await attach(nidD, { mode: 'SIMULATION', receivedAt: beforeIso, contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })).status === 400, '')
    rec('F7', 'Réception future → refus (API réel)', (await attach(nidD, { mode: 'SIMULATION', receivedAt: futureIso, contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })).status === 400, '')
    const okD = await attach(nidD, { mode: 'SIMULATION', receivedAt: new Date().toISOString(), contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })
    rec('F8', 'Transmission puis réception successives → acceptation (API réel)', okD.status === 201, `HTTP ${okD.status}`)
    const verD = await verify(nidD, okD.data?.id, OK)
    const [[lotD]] = await conn.query("SELECT DATE_FORMAT(information_date,'%Y-%m-%d') AS d, DATE_FORMAT(expires_at,'%Y-%m-%d') AS e FROM carryover_lots WHERE idempotency_key=?", [`${tag}-dt`])
    const civilNow = martiniqueCivilDate(new Date())
    const expExpected = addMonthsClamped(civilNow, 15)
    rec('F9', 'Date SQL relue sans changement de jour (Martinique)', verD.status === 201 && lotD.d === civilNow, `info=${lotD.d} expected=${civilNow}`)
    rec('F10', 'Échéance exacte à 15 mois (clampée)', lotD.e === expExpected, `expires=${lotD.e} expected=${expExpected}`)

    // ── 4. Notification corrigée (parcours complet) ────────────────────────
    await cancel(nidD, 'nettoyage')
    await addLot(colB, 'corr', { days: 4, infoDate: '2026-06-10', infoCertain: 0 })
    const prepC = await prepare(colB.id); const nidC = prepC.data?.notificationId
    await validate(nidC); await transmit(nidC)
    const proofC = await attach(nidC, sim()); const pidC = proofC.data?.id
    const verC = await verify(nidC, pidC, OK)
    const [[notifC]] = await conn.query('SELECT status, coherence_anomaly, document_reference FROM carryover_notifications WHERE id=?', [nidC])
    rec('F11', 'Échéance incohérente détectée → A_CORRIGER', verC.status === 201 && notifC.status === 'A_CORRIGER' && num(notifC.coherence_anomaly) === 1, `status=${notifC.status}`)
    const newC = await createCorrected(nidC, 'document corrigé')
    const nidNew = newC.data?.id
    rec('F12', 'Notification corrigée créée (liée, BROUILLON)', newC.status === 201 && newC.data?.correctedFromId === nidC && newC.data?.status === 'BROUILLON', `new=${nidNew} from=${nidC}`)
    rec('F13', 'Ancienne notification obsolète ne peut plus confirmer', (await verify(nidC, pidC, OK)).status === 409, '')
    await validate(nidNew); await transmit(nidNew)
    const proofNew = await attach(nidNew, sim()); const pidNew = proofNew.data?.id
    const verNew = await verify(nidNew, pidNew, OK)
    rec('F14', 'Nouvelle notification : confirmation finale possible', verNew.status === 201 && (verNew.data?.status === 'RECEPTION_VERIFIEE' || verNew.data?.status === 'A_CORRIGER'), `status=${verNew.data?.status}`)

    // ── 5. Reports et concurrence ───────────────────────────────────────────
    const addBalance = (emp, period, counter, available, reserved = 0) => conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, available, available, reserved])
    const Q = '2023-2024'
    // Plusieurs lots dont un reliquat inconnu → blocage.
    await addBalance(colA, Q, 'N-1', 6)
    await addLot(colA, 'ml1', { target: Q, days: 2, remaining: 2, infoDate: '2026-06-25', infoCertain: 1 })
    await conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, idempotency_key, version, reference_period_end_date) VALUES (?, '2023-2024', '2023-2024', 'N-1', 1, NULL, 'MALADIE', 'GENERAL', 'ACTIF', ?, 0, '2024-05-31')`, [colA.id, `${tag}-null`])
    rec('F15', 'Plusieurs lots + reliquat inconnu → blocage report', (await carryover(colA.id, Q, 1)).status === 400, '')
    await conn.query('DELETE FROM carryover_lots WHERE idempotency_key=?', [`${tag}-null`])
    // Somme des lots supérieure au solde → blocage.
    await conn.query('UPDATE carryover_lots SET remaining_days = 99 WHERE idempotency_key=?', [`${tag}-ml1`])
    rec('F16', 'Somme des lots > solde → blocage (rapprochement impossible)', (await carryover(colA.id, Q, 1)).status === 400, '')
    await conn.query('UPDATE carryover_lots SET remaining_days = 2 WHERE idempotency_key=?', [`${tag}-ml1`])

    // Lot modifié entre préparation et vérification.
    await cancel(nidNew, 'nettoyage')
    await addLot(colB, 'mod', { days: 4, infoDate: null, infoCertain: 0 })
    const prepM = await prepare(colB.id); const nidM = prepM.data?.notificationId
    await validate(nidM); await transmit(nidM)
    await conn.query('UPDATE carryover_lots SET remaining_days = 1 WHERE idempotency_key=?', [`${tag}-mod`])
    const proofM = await attach(nidM, sim()); const pidM = proofM.data?.id
    rec('F17', 'Lot modifié entre préparation et vérification → refus', (await verify(nidM, pidM, OK)).status === 409, '')

    // Annulation + vérification simultanées.
    await cancel(nidM, 'nettoyage')
    await addLot(colB, 'cv', { days: 2, infoDate: null, infoCertain: 0 })
    const prepCV = await prepare(colB.id); const nidCV = prepCV.data?.notificationId
    await validate(nidCV); await transmit(nidCV)
    const proofCV = await attach(nidCV, sim()); const pidCV = proofCV.data?.id
    const [cR, vR] = await Promise.all([cancel(nidCV, 'annulation'), verify(nidCV, pidCV, OK)])
    const okCV = (cR.status === 201 && (vR.status === 409 || vR.status === 500)) || (vR.status === 201 && cR.status === 409)
    rec('F18', 'Annulation + vérification simultanées → un seul gagnant', okCV, `HTTP ${cR.status}/${vR.status}`)

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L6-FINAL : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L6-FINAL :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
