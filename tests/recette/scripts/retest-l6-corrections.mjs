// JUR-027 — L6 corrections ciblées : preuve juridiquement contrôlée, dates,
// version transmise, sécurité des justificatifs, concurrence, reports.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l6-corrections.json')
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)
const STORAGE_ROOT = 'C:/recette-storage'

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const p = (t) => parts.find((e) => e.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}
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
function toMysqlLocal(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function main() {
  const conn = await dbConn()
  try {
    const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
    const colA = await get('col-a.recette@gmes.fr')
    const colB = await get('col-b.recette@gmes.fr')
    const rh = await login('rh.recette@gmes.fr')
    const tag = 'LC' + Date.now().toString(36)
    const today = martiniqueToday()

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
        await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [toMysqlLocal(new Date(Date.now() - 2 * 3600000)), id])
      }
      return r
    }
    const attach = (id, body) => apiRequest(`/carryover-notifications/${id}/proofs`, { method: 'POST', token: rh, body })
    const verify = (id, proofId, decision) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/verify`, { method: 'POST', token: rh, body: decision })
    const correct = (id, reason) => apiRequest(`/carryover-notifications/${id}/correct`, { method: 'POST', token: rh, body: { reason } })
    const cancel = (id, reason) => apiRequest(`/carryover-notifications/${id}/cancel`, { method: 'POST', token: rh, body: { reason } })
    const download = (id, proofId) => apiRequest(`/carryover-notifications/${id}/proofs/${proofId}/download`, { token: rh })
    const carryover = (eid, period, days) => apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rh, body: { employeeId: eid, closingReferencePeriod: period, days, reason: 'test corrections' } })
    const OK = { result: 'CONFORME', note: 'contrôle RH conforme', recipientIdentityConfirmed: true, requiredInfoPresent: true }
    const past = new Date(Date.now() - 3600000).toISOString()
    const sim = (contentBase64 = Buffer.from('preuve synthétique').toString('base64')) => ({ mode: 'SIMULATION', receivedAt: past, contentBase64, mimeType: 'text/plain' })

    // ── 1. Preuve : décision RH structurée ──────────────────────────────────
    await addLot(colA, 'p1', { days: 4, infoDate: null, infoCertain: 0 })
    const prep1 = await prepare(colA.id); const nid1 = prep1.data?.notificationId
    await validate(nid1); await transmit(nid1)
    const proof1 = await attach(nid1, sim()); const pid1 = proof1.data?.id
    const rej = await verify(nid1, pid1, { result: 'NON_CONFORME', note: 'identité non vérifiée', recipientIdentityConfirmed: false, requiredInfoPresent: false })
    const [[lotRej]] = await conn.query("SELECT information_date FROM carryover_lots WHERE idempotency_key=?", [`${tag}-p1`])
    rec('C1', 'Preuve NON_CONFORME → REJET motivé, échéance non confirmée', rej.status === 201 && rej.data?.status === 'A_CORRIGER' && lotRej.information_date === null, `status=${rej.data?.status} info=${lotRej.information_date}`)

    const prep1b = await prepare(colA.id); const nid1b = prep1b.data?.notificationId
    await validate(nid1b); await transmit(nid1b)
    const proof1b = await attach(nid1b, sim()); const pid1b = proof1b.data?.id
    const noId = await verify(nid1b, pid1b, { result: 'CONFORME', note: 'x', recipientIdentityConfirmed: false, requiredInfoPresent: true })
    rec('C2', 'CONFORME sans identité vérifiée → refus', noId.status === 400, `HTTP ${noId.status}`)
    const okV = await verify(nid1b, pid1b, OK)
    rec('C3', 'CONFORME complet → RECEPTION_VERIFIEE', okV.status === 201 && okV.data?.status === 'RECEPTION_VERIFIEE', `status=${okV.data?.status}`)

    // ── 2. Dates et fuseaux ─────────────────────────────────────────────────
    await addLot(colB, 'p2', { days: 3, infoDate: '2026-06-25', infoCertain: 1 })
    const prep2 = await prepare(colB.id); const nid2 = prep2.data?.notificationId
    await validate(nid2); await transmit(nid2)
    // transmission 16h aujourd'hui.
    await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [`${today} 16:00:00`, nid2])
    const before = await attach(nid2, { mode: 'SIMULATION', receivedAt: `${today}T09:00:00`, contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })
    rec('C4', 'Réception 09h pour transmission 16h le même jour → refus', before.status === 400, `HTTP ${before.status}`)
    const future = await attach(nid2, { mode: 'SIMULATION', receivedAt: new Date(Date.now() + 3600000).toISOString(), contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })
    rec('C5', 'Réception à une heure future → refus', future.status === 400, `HTTP ${future.status}`)
    await conn.query('UPDATE carryover_notifications SET transmitted_at = ? WHERE id = ?', [toMysqlLocal(new Date(Date.now() - 2 * 3600000)), nid2])
    const okAtt = await attach(nid2, { mode: 'SIMULATION', receivedAt: past, contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' })
    const pid2 = okAtt.data?.id
    rec('C6', 'Transmission puis réception successives → acceptation', okAtt.status === 201, `HTTP ${okAtt.status}`)
    const ver2 = await verify(nid2, pid2, OK)
    const [[lot2]] = await conn.query("SELECT DATE_FORMAT(information_date,'%Y-%m-%d') AS d, DATE_FORMAT(expires_at,'%Y-%m-%d') AS e FROM carryover_lots WHERE idempotency_key=?", [`${tag}-p2`])
    const expectedCivil = martiniqueCivilDate(new Date(Date.now() - 3600000))
    const expectedExpiry = addMonthsClamped(expectedCivil, 15)
    rec('C7', 'Date SQL relue sans changement de jour (Martinique)', ver2.status === 201 && lot2.d === expectedCivil, `info=${lot2.d} expected=${expectedCivil}`)
    rec('C8', 'Échéance exacte à 15 mois', lot2.e === expectedExpiry, `expires=${lot2.e} expected=${expectedExpiry}`)

    // ── 3. Version transmise figée + anomalie de cohérence ──────────────────
    await cancel(nid2, 'nettoyage')
    await addLot(colB, 'p3', { days: 4, infoDate: '2026-06-10', infoCertain: 0 })
    const prep3 = await prepare(colB.id); const nid3 = prep3.data?.notificationId
    await validate(nid3); await transmit(nid3)
    const [[doc3]] = await conn.query('SELECT document_reference, document_checksum, transmitted_content_json FROM carryover_notifications WHERE id=?', [nid3])
    rec('C9', 'Document transmis figé (référence + empreinte + copie)', Boolean(doc3.document_reference && doc3.document_checksum && doc3.transmitted_content_json), `ref=${doc3.document_reference}`)
    const proof3 = await attach(nid3, sim()); const pid3 = proof3.data?.id
    const ver3 = await verify(nid3, pid3, OK)
    const [[notif3]] = await conn.query('SELECT status, coherence_anomaly FROM carryover_notifications WHERE id=?', [nid3])
    rec('C10', 'Discordance échéance → anomalie + A_CORRIGER (pas RECEPTION_VERIFIEE)', ver3.status === 201 && notif3.status === 'A_CORRIGER' && num(notif3.coherence_anomaly) === 1, `status=${notif3.status} anomaly=${notif3.coherence_anomaly}`)

    // ── 4. Sécurité des justificatifs ───────────────────────────────────────
    await cancel(nid3, 'nettoyage')
    await addLot(colB, 'p4', { days: 3, infoDate: '2026-06-25', infoCertain: 1 })
    const prep4 = await prepare(colB.id); const nid4 = prep4.data?.notificationId
    await validate(nid4); await transmit(nid4)
    const badMime = await attach(nid4, { mode: 'SIMULATION', receivedAt: past, contentBase64: Buffer.from('%PDF-fake').toString('base64'), mimeType: 'application/pdf' })
    rec('C11', 'MIME PDF déclaré mais contenu non PDF → refus', badMime.status === 400, `HTTP ${badMime.status}`)
    const big = await attach(nid4, { mode: 'SIMULATION', receivedAt: past, contentBase64: Buffer.alloc(6 * 1024 * 1024, 1).toString('base64'), mimeType: 'application/octet-stream' })
    rec('C12', 'Taille maximale serveur → refus (HTTP ou service)', [400, 413].includes(big.status), `HTTP ${big.status}`)
    const okP4 = await attach(nid4, { mode: 'SIMULATION', receivedAt: past, contentBase64: Buffer.from('contenu réel').toString('base64'), mimeType: 'text/plain' })
    const pid4 = okP4.data?.id
    const [[p4row]] = await conn.query('SELECT storage_key FROM carryover_reception_proofs WHERE id=?', [pid4])
    fs.writeFileSync(path.resolve(STORAGE_ROOT, p4row.storage_key), Buffer.from('modifié réellement'))
    rec('C13', 'Modification réelle des octets → refus', (await verify(nid4, pid4, OK)).status === 400, '')
    fs.writeFileSync(path.resolve(STORAGE_ROOT, p4row.storage_key), Buffer.from('contenu réel'))
    const ver4 = await verify(nid4, pid4, OK)
    const dl = await download(nid4, pid4)
    const myData = (await apiRequest('/carryover-notifications/my', { token: rh })).data
    rec('C14', 'Téléchargement RH + réponse salarié sans chemin privé', ver4.status === 201 && dl.status === 200 && dl.data?.checksum && JSON.stringify(myData).includes('storage_key') === false, `dl=${dl.status}`)

    // ── 5. Concurrence (salarié frais avec un seul lot, échéance inconnue) ──
    await cancel(nid4, 'nettoyage')
    const colC = await get('col-c.recette@gmes.fr')
    await addLot(colC, 'p5', { days: 2, infoDate: null, infoCertain: 0 })
    const [pa, pb] = await Promise.all([prepare(colC.id), prepare(colC.id)])
    const stPrep = [pa.status, pb.status].sort()
    rec('C15', 'Deux préparations simultanées → une seule', stPrep.join(',') === '201,409', `HTTP ${stPrep.join('/')}`)
    const [[winN]] = await conn.query("SELECT id FROM carryover_notifications WHERE employee_id=? AND status='BROUILLON' ORDER BY id DESC LIMIT 1", [colC.id])
    const nidV = winN.id
    const [va, vb] = await Promise.all([validate(nidV), validate(nidV)])
    const stVal = [va.status, vb.status].sort()
    rec('C16', 'Deux validations simultanées → une seule', stVal.join(',') === '201,409', `HTTP ${stVal.join('/')}`)
    const [ta, tb] = await Promise.all([transmit(nidV), transmit(nidV)])
    const stTx = [ta.status, tb.status].sort()
    rec('C17', 'Deux transmissions simultanées → une seule', stTx.join(',') === '201,409', `HTTP ${stTx.join('/')}`)
    const proofV = await attach(nidV, sim()); const pidV = proofV.data?.id
    const [cancelR, verR] = await Promise.all([cancel(nidV, 'annulation'), verify(nidV, pidV, OK)])
    const okC18 = (cancelR.status === 201 && (verR.status === 409 || verR.status === 500)) || (verR.status === 201 && cancelR.status === 409)
    rec('C18', 'Annulation concurrente + vérification → un seul gagnant', okC18, `HTTP ${cancelR.status}/${verR.status}`)

    // ── 6. Reports exceptionnels (états particuliers) ──────────────────────
    const addBalance = (emp, period, counter, available) => conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, 0, 0)', [emp.id, period, counter, available, available])
    const Q = '2023-2024'
    await addBalance(colA, Q, 'N-1', 5)
    await conn.query(`INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, idempotency_key, version, reference_period_end_date) VALUES (?, '2023-2024', '2023-2024', 'N-1', 2, NULL, 'MALADIE', 'GENERAL', 'ACTIF', ?, 0, '2024-05-31')`, [colA.id, `${tag}-null`])
    rec('C19', 'Report exceptionnel : reliquat NULL → blocage', (await carryover(colA.id, Q, 1)).status === 400, '')

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L6-CORRECTIONS : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L6-CORRECTIONS :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
