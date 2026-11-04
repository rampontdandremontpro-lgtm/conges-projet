// JUR-027 — Lot L3 (corrections) : tests d'intégration en recette isolée.
// Couvre : création, doublons/idempotence, concurrence, confirmation RH
// sécurisée (preuve, chronologie, périmètre), gel de la période de référence,
// isolation, non-régression des compteurs/mouvements.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn, isoAddDays, todayIso } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l3.json')

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

function addMonthsClamp(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

async function snapshot(conn) {
  const [bal] = await conn.query(
    `SELECT COUNT(*) c,
            COALESCE(SUM(CAST(acquired_days AS DECIMAL(10,2))),0) acquired,
            COALESCE(SUM(CAST(reserved_days AS DECIMAL(10,2))),0) reserved,
            COALESCE(SUM(CAST(consumed_days AS DECIMAL(10,2))),0) consumed,
            COALESCE(SUM(CAST(available_days AS DECIMAL(10,2))),0) available
     FROM leave_balances`,
  )
  const [mv] = await conn.query(
    `SELECT COUNT(*) c, COALESCE(SUM(CAST(days AS DECIMAL(10,2))),0) d FROM balance_movements`,
  )
  const [rep] = await conn.query(
    `SELECT COUNT(*) c FROM balance_movements WHERE reason LIKE 'REPORT_EXCEPTIONNEL%'`,
  )
  return { bal: bal[0], mv: mv[0], reportCount: rep[0].c }
}

const sameNum = (a, b) => Number(a) === Number(b)

async function main() {
  const conn = await dbConn()
  try {
    const [[colA]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
    const [[colB]] = await conn.query("SELECT id FROM users WHERE email='col-b.recette@gmes.fr'")
    if (!colA || !colB) throw new Error('Comptes col-a/col-b introuvables.')

    const [pA] = await conn.query(
      "INSERT INTO documents (document_kind, storage_key, uploaded_by_id) VALUES ('JUSTIFICATIF','l3-proof-a',?)",
      [colA.id],
    )
    const [pB] = await conn.query(
      "INSERT INTO documents (document_kind, storage_key, uploaded_by_id) VALUES ('JUSTIFICATIF','l3-proof-b',?)",
      [colB.id],
    )
    const [pNull] = await conn.query(
      "INSERT INTO documents (document_kind, storage_key) VALUES ('JUSTIFICATIF','l3-proof-null')",
    )
    const proofA = pA.insertId
    const proofB = pB.insertId
    const today = todayIso()
    const info1 = isoAddDays(today, -100)
    const reprise1 = isoAddDays(info1, -5)
    const info2 = isoAddDays(today, -60)
    const infoFuture = isoAddDays(today, +20)
    const exp1 = addMonthsClamp(info1, 15)
    const exp2 = addMonthsClamp(info2, 15)

    const before = await snapshot(conn)
    const rh = await login('rh.recette@gmes.fr')
    const col = await login('col-a.recette@gmes.fr')

    // 1. Création (reliquat inconnu, échéance indicative).
    const c1 = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2025-2026',
        targetReferencePeriod: '2026-2027', days: 4,
        informationDate: info1, repriseDate: reprise1, informationMode: 'bulletin',
        idempotencyKey: 'l3-a1', reason: 'Arrêt maladie — report L3141-19-1',
      },
    })
    rec('L3-01', 'Création d’un lot (201)', c1.status === 201, `HTTP ${c1.status}`)
    rec('L3-01b', 'Reliquat inconnu (remainingDays null)', c1.data?.remainingDays == null)
    rec('L3-01c', 'Échéance indicative (non opposable)', c1.data?.indicativeExpiresAt === exp1 && c1.data?.expiresAt == null, `indicative=${c1.data?.indicativeExpiresAt}`)
    rec('L3-01d', 'Statut A_VERIFIER', c1.data?.status === 'A_VERIFIER')
    const lot1Id = c1.data?.id

    // 2. Deux lots distincts.
    const c2 = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2026-2027',
        targetReferencePeriod: '2027-2028', days: 2,
        informationDate: info2, idempotencyKey: 'l3-a2',
      },
    })
    rec('L3-02', 'Deux lots distincts pour le même salarié', c2.status === 201 && c2.data?.id !== lot1Id, `lot #${c2.data?.id}`)
    rec('L3-03', 'Échéances indicatives différentes', c2.data?.indicativeExpiresAt === exp2 && exp1 !== exp2)

    // 3. Arrêt long : période de référence FIGÉE.
    const c3 = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colB.id), sourceReferencePeriod: '2025-2026',
        targetReferencePeriod: '2026-2027', days: 6, regime: 'ARRET_LONG',
        absenceStatus: 'ABSENT', idempotencyKey: 'l3-b1',
      },
    })
    rec('L3-07', 'Arrêt long conditions non confirmées → A_VERIFIER', c3.status === 201 && c3.data?.status === 'A_VERIFIER' && c3.data?.expiresAt == null)
    rec('L3-07b', 'Arrêt long : échéance indicative = fin de période + 15 mois', c3.data?.indicativeExpiresAt === '2027-08-31', `indicative=${c3.data?.indicativeExpiresAt}`)
    rec('L3-07c', 'Fin de période de référence FIGÉE (2026-05-31)', c3.data?.referencePeriodEndDate === '2026-05-31', `end=${c3.data?.referencePeriodEndDate}`)
    const lot3Id = c3.data?.id

    // Gel : changement de REFERENCE_PERIOD_START ne doit pas recalculer.
    await conn.query("INSERT INTO settings (setting_key, setting_value, description, updated_by_id) VALUES ('REFERENCE_PERIOD_START','01-01','test gel',NULL) ON DUPLICATE KEY UPDATE setting_value='01-01'")
    const frozen = await apiRequest(`/carryover-lots/${lot3Id}`, { token: rh })
    rec('L3-07d', 'Changement de REFERENCE_PERIOD_START sans recalcul silencieux', frozen.data?.indicativeExpiresAt === '2027-08-31' && frozen.data?.referencePeriodEndDate === '2026-05-31', `indicative=${frozen.data?.indicativeExpiresAt}`)
    await conn.query("DELETE FROM settings WHERE setting_key='REFERENCE_PERIOD_START'")

    // 4. Idempotence obligatoire.
    const noKey = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2025-2026', targetReferencePeriod: '2026-2027', days: 1,
      },
    })
    rec('L3-05a', 'Clé d’idempotence obligatoire (400 si absente)', noKey.status === 400, `HTTP ${noKey.status}`)

    // 5. Rejeu idempotent (même clé + mêmes données → pas de doublon).
    const replay = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2025-2026',
        targetReferencePeriod: '2026-2027', days: 4,
        informationDate: info1, repriseDate: reprise1, informationMode: 'bulletin',
        idempotencyKey: 'l3-a1', reason: 'Arrêt maladie — report L3141-19-1',
      },
    })
    const [[replayCount]] = await conn.query('SELECT COUNT(*) c FROM carryover_lots WHERE idempotency_key = ?', ['l3-a1'])
    rec('L3-05b', 'Rejeu idempotent (même clé, mêmes données → lot existant, aucun doublon)', (replay.status === 200 || replay.status === 201) && replay.data?.id === lot1Id && Number(replayCount.c) === 1, `HTTP ${replay.status} lot #${replay.data?.id}, rows=${replayCount.c}`)

    // 6. Même clé, données différentes → 409.
    const diffData = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2025-2026',
        targetReferencePeriod: '2026-2027', days: 9,
        informationDate: info1, idempotencyKey: 'l3-a1',
      },
    })
    rec('L3-05c', 'Même clé, données différentes → 409', diffData.status === 409, `HTTP ${diffData.status}`)

    // 7. Confirmation sécurisée — preuve valide → en attente (définitif DÉSACTIVÉ).
    const cf1 = await apiRequest(`/carryover-lots/${lot1Id}/confirm`, {
      method: 'POST', token: rh, body: { proofId: proofA, reason: 'Bulletin daté vérifié' },
    })
    rec('L3-08a', 'Confirmation preuve valide → en attente, pas d’échéance définitive', cf1.status === 201 && cf1.data?.confirmationStatus === 'EN_ATTENTE' && cf1.data?.expiresAt == null && cf1.data?.informationDateCertain == null, `status=${cf1.data?.confirmationStatus}`)
    rec('L3-08b', 'Aucune déduction automatique de informationDateCertain', cf1.data?.informationDateCertain == null)

    // Document inexistant.
    const cfMissing = await apiRequest(`/carryover-lots/${c2.data.id}/confirm`, { method: 'POST', token: rh, body: { proofId: 999999, reason: 'x' } })
    rec('L3-08c', 'Document inexistant → refusé', cfMissing.status === 400, `HTTP ${cfMissing.status}`)

    // Document d'un autre salarié.
    const cfOther = await apiRequest(`/carryover-lots/${c2.data.id}/confirm`, { method: 'POST', token: rh, body: { proofId: proofB, reason: 'x' } })
    rec('L3-08d', 'Document d’un autre salarié → refusé', cfOther.status === 400, `HTTP ${cfOther.status}`)

    // Date future.
    const c4 = await apiRequest('/carryover-lots', {
      method: 'POST', token: rh, body: {
        employeeId: Number(colA.id), sourceReferencePeriod: '2024-2025', targetReferencePeriod: '2025-2026',
        days: 1, informationDate: infoFuture, idempotencyKey: 'l3-fut',
      },
    })
    rec('L3-08e', 'Date future enregistrable comme prévision (indicatif)', c4.status === 201 && c4.data?.expiresAt == null)
    const cfFuture = await apiRequest(`/carryover-lots/${c4.data.id}/confirm`, { method: 'POST', token: rh, body: { proofId: proofA, reason: 'x' } })
    rec('L3-08f', 'Confirmation d’une réception future → refusée', cfFuture.status === 400, `HTTP ${cfFuture.status}`)

    // 9. Concurrence de création (même clé) → un seul lot.
    const keyConcurrent = 'l3-conc'
    const [ra, rb] = await Promise.all([
      apiRequest('/carryover-lots', { method: 'POST', token: rh, body: { employeeId: Number(colA.id), sourceReferencePeriod: '2024-2025', targetReferencePeriod: '2025-2026', days: 1, informationDate: info2, idempotencyKey: keyConcurrent } }),
      apiRequest('/carryover-lots', { method: 'POST', token: rh, body: { employeeId: Number(colA.id), sourceReferencePeriod: '2024-2025', targetReferencePeriod: '2025-2026', days: 1, informationDate: info2, idempotencyKey: keyConcurrent } }),
    ])
    const concOk = [ra.status, rb.status].every((s) => s === 200 || s === 201)
    const [[countConc]] = await conn.query('SELECT COUNT(*) c FROM carryover_lots WHERE idempotency_key = ?', [keyConcurrent])
    rec('L3-09', 'Créations concurrentes → un seul lot', concOk && Number(countConc.c) === 1, `HTTP ${ra.status}/${rb.status}, rows=${countConc.c}`)

    // 10. Modification RH + traçabilité.
    const upd = await apiRequest(`/carryover-lots/${c2.data.id}`, {
      method: 'PATCH', token: rh, body: { days: 3, reason: 'Correction RH : quantité corrigée' },
    })
    rec('L3-10', 'Modification RH acceptée', upd.status === 200 && Number(upd.data?.days) === 3, `days=${upd.data?.days}`)
    const hist = await apiRequest(`/carryover-lots/${c2.data.id}`, { token: rh })
    const updLog = hist.data?.history?.find((h) => h.action === 'CARRYOVER_LOT_UPDATED')
    rec('L3-10b', 'Journalisation avant/après', !!updLog && Number(updLog.oldValue?.days) === 2 && Number(updLog.newValue?.days) === 3, `old=${updLog?.oldValue?.days} → new=${updLog?.newValue?.days}`)

    // 11. Concurrence de modification (2 PATCH, même version initiale).
    const [p1, p2] = await Promise.all([
      apiRequest(`/carryover-lots/${c2.data.id}`, { method: 'PATCH', token: rh, body: { days: 7, reason: 'correction concurrente A' } }),
      apiRequest(`/carryover-lots/${c2.data.id}`, { method: 'PATCH', token: rh, body: { days: 8, reason: 'correction concurrente B' } }),
    ])
    const pStatuses = [p1.status, p2.status]
    const pOk = pStatuses.every((s) => s === 200 || s === 409) && pStatuses.includes(200)
    const [[finalLot]] = await conn.query('SELECT days FROM carryover_lots WHERE id = ?', [c2.data.id])
    const pConsistent = Number(finalLot.days) === 7 || Number(finalLot.days) === 8
    rec('L3-11', 'Deux PATCH concurrents : un gagnant, pas d’écrasement silencieux', pOk && pConsistent, `HTTP ${pStatuses.join('/')}, days=${finalLot.days}`)

    // 12. Concurrence PATCH vs confirmation.
    const [p3, cf2] = await Promise.all([
      apiRequest(`/carryover-lots/${c2.data.id}`, { method: 'PATCH', token: rh, body: { days: 9, reason: 'concurrente C' } }),
      apiRequest(`/carryover-lots/${c2.data.id}/confirm`, { method: 'POST', token: rh, body: { proofId: proofA, reason: 'confirmation concurrente' } }),
    ])
    const pcOk = [p3.status, cf2.status].every((s) => s === 200 || s === 201 || s === 409) && [p3.status, cf2.status].some((s) => s === 200 || s === 201)
    rec('L3-12', 'Concurrence PATCH/confirmation : cohérente, sans 500', pcOk, `HTTP ${p3.status}/${cf2.status}`)

    // 13. Périmètre RH global documenté.
    const listA = await apiRequest(`/carryover-lots/employee/${colA.id}`, { token: rh })
    const listB = await apiRequest(`/carryover-lots/employee/${colB.id}`, { token: rh })
    rec('L3-13', 'RH : accès global à tous les salariés (documenté)', listA.status === 200 && listB.status === 200, `A=${listA.data?.length}, B=${listB.data?.length}`)

    // 14. Non-RH refusé + IDOR.
    const denied = await apiRequest('/carryover-lots', { method: 'POST', token: col, body: { employeeId: Number(colA.id), sourceReferencePeriod: '2025-2026', targetReferencePeriod: '2026-2027', days: 1, idempotencyKey: 'l3-denied' } })
    const idor = await apiRequest(`/carryover-lots/employee/${colA.id}`, { token: col })
    const idor2 = await apiRequest(`/carryover-lots/${lot1Id}`, { token: col })
    rec('L3-14', 'Non-RH refusé (403) + IDOR refusé', denied.status === 403 && idor.status === 403 && idor2.status === 403, `HTTP ${denied.status}/${idor.status}/${idor2.status}`)

    // 15. Aucun changement des compteurs / mouvements / reports.
    const after = await snapshot(conn)
    rec('L3-15', 'Aucun changement des soldes N-1/N/N+1', sameNum(before.bal.acquired, after.bal.acquired) && sameNum(before.bal.reserved, after.bal.reserved) && sameNum(before.bal.consumed, after.bal.consumed) && sameNum(before.bal.available, after.bal.available))
    rec('L3-16', 'Aucun mouvement de congé créé', Number(before.mv.c) === Number(after.mv.c) && sameNum(before.mv.d, after.mv.d))
    rec('L3-17', 'Aucun impact sur les reports exceptionnels', Number(before.reportCount) === Number(after.reportCount))

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L3 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L3 :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
