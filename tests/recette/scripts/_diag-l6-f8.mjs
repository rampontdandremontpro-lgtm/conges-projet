// Diagnostic JUR-027 E2-bis — instabilité L6-final F8.
// Reproduit la séquence "transmit (raw) puis attach receivedAt=now" et capture
// les horodatages réellement comparés + le corps d'erreur HTTP.
// Cible : gestion_conges_gmes_test uniquement.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

async function main() {
  const conn = await dbConn()
  const rh = await login('rh.recette@gmes.fr')
  const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
  const colB = await get('col-b.recette@gmes.fr')
  const tag = 'DF8' + Date.now().toString(36)

  await conn.query(
    `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
     VALUES (?, '2024-2025', '2024-2025', 'N-1', 3, 3, 'MALADIE', 'GENERAL', 'ACTIF', NULL, 0, 'CONFIRMEE', 1, NULL, 'L3141-19-1', ?, 0, '2025-05-31')`,
    [colB.id, `${tag}-lot`],
  )

  for (let i = 1; i <= 12; i++) {
    const prep = await apiRequest('/carryover-notifications/prepare', { method: 'POST', token: rh, body: { employeeId: colB.id } })
    const nid = prep.data?.notificationId
    await apiRequest(`/carryover-notifications/${nid}/validate`, { method: 'POST', token: rh })
    const tx = await apiRequest(`/carryover-notifications/${nid}/transmit`, { method: 'POST', token: rh, body: { mode: 'SIMULATION' } })
    const receivedIso = new Date().toISOString()
    const attach = await apiRequest(`/carryover-notifications/${nid}/proofs`, { method: 'POST', token: rh, body: { mode: 'SIMULATION', receivedAt: receivedIso, contentBase64: Buffer.from('x').toString('base64'), mimeType: 'text/plain' } })
    const [[row]] = await conn.query('SELECT transmitted_at, DATE_FORMAT(transmitted_at, "%Y-%m-%d %H:%i:%s.%f") AS tx_precise FROM carryover_notifications WHERE id=?', [nid])
    const txMs = new Date(row.transmitted_at).getTime()
    const rxMs = new Date(receivedIso).getTime()
    console.log(
      `#${i} tx_http=${tx.status} attach_http=${attach.status} ` +
      `tx_precise=${row.tx_precise} tx_ms=${txMs} rx_ms=${rxMs} delta_ms=${rxMs - txMs} ` +
      `err=${JSON.stringify(attach.data?.message ?? attach.data ?? null)}`,
    )
    await apiRequest(`/carryover-notifications/${nid}/cancel`, { method: 'POST', token: rh, body: { reason: 'diag' } })
  }
  await conn.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
