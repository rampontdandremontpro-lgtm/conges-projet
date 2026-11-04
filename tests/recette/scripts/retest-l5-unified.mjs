// JUR-027 — L5 (clôture unifiée) : clôture mixte représentative.
//
// Un seul parcours RH (POST /leave-balances/period/close) exécute, dans UNE
// transaction : traitement des lots maladie + opérations GMES (arrondi,
// transfert N→N-1, remise à zéro N/N-1/N+1, reports exceptionnels, audit,
// notifications) + marqueur définitif unique.
//
// Ce test compare les soldes SQL avant/après et vérifie le blocage des
// dossiers incomplets (échéance incertaine), sans remise à zéro.
//
// Cible IMPÉRATIVE : gestion_conges_gmes_test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l5-unified.json')

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  try {
    const get = async (email) => (await conn.query('SELECT id FROM users WHERE email=?', [email]))[0][0]
    const colA = await get('col-a.recette@gmes.fr')
    const colB = await get('col-b.recette@gmes.fr')
    const colC = await get('col-c.recette@gmes.fr')
    const rh = await login('rh.recette@gmes.fr')
    const tag = 'UNIF' + Date.now().toString(36)

    const addBalance = (emp, period, counter, acquired, available, reserved = 0) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, acquired, available, reserved])
    const addAcquisition = (emp, balanceId, days) =>
      conn.query("INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after) VALUES (?, ?, 'ACQUISITION', ?, 0, ?)", [emp.id, balanceId, days, days])
    // Lot confirmé, échéance juridiquement certaine (protégé).
    const addConfirmedLot = (emp, key, days, target) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', ?, 0, '2025-05-31')`,
        [emp.id, target, days, days, `${tag}-${key}`],
      )
    // Lot incomplet : échéance incertaine (A_VERIFIER) → doit bloquer.
    const addUncertainLot = (emp, key, days, target) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'A_VERIFIER', NULL, NULL, NULL, 1, NULL, 'L3141-19-1', ?, 0, '2025-05-31')`,
        [emp.id, target, days, days, `${tag}-${key}`],
      )

    const normalClose = (p) => apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: p, confirm: true } })
    const carryover = (empId, period, days) => apiRequest('/leave-balances/period/carryover', { method: 'POST', token: rh, body: { employeeId: empId, closingReferencePeriod: period, days, reason: 'Arrêt maladie — report L3141-19-1 (unifié)' } })

    const bal = (emp, period, counter) =>
      conn.query('SELECT acquired_days, available_days, reserved_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type=?', [emp.id, period, counter])

    // ── État mixte (période terminée 2020-2021) ─────────────────────────────
    const P = '2020-2021'
    const NP = '2021-2022'
    // Salarié A : N-1 = 12 (4 lot confirmé + 8 ordinaire), N = 20.5 (arrondi), N+1 = 3.
    await addBalance(colA, P, 'N-1', 12, 12)
    await addConfirmedLot(colA, 'conf', 4, P)
    const [nA] = await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colA.id, P, 'N', 20.5, 20.5, 0, 0])
    await addAcquisition(colA, nA.insertId, 20.5)
    await addBalance(colA, P, 'N+1', 3, 3)
    // Report exceptionnel distinct : débite N-1 (12→10), crédite N-1 suivant (+2).
    const repA = await carryover(colA.id, P, 2)

    // Salarié B : sans report maladie, N-1 = 7, N = 12, N+1 = 2.
    await addBalance(colB, P, 'N-1', 7, 7)
    await addBalance(colB, P, 'N', 12, 12)
    await addBalance(colB, P, 'N+1', 2, 2)

    const [[aN1Before]] = await bal(colA, P, 'N-1')
    const [[aNBefore]] = await bal(colA, P, 'N')
    const [[aNp1Before]] = await bal(colA, P, 'N+1')
    const [[bN1Before]] = await bal(colB, P, 'N-1')

    rec('U1', 'Report exceptionnel distinct tracé', repA.status === 201 || repA.status === 200, `HTTP ${repA.status} sourceN1=${aN1Before?.available_days}`)

    const close = await normalClose(P)
    rec('U2', 'Clôture mixte acceptée (une seule transaction)', close.status === 201, `HTTP ${close.status}`)

    const [[aN1]] = await bal(colA, P, 'N-1')
    const [[aN]] = await bal(colA, P, 'N')
    const [[aNp1]] = await bal(colA, P, 'N+1')
    const [[aNextN1]] = await bal(colA, NP, 'N-1')
    const [[bN1]] = await bal(colB, P, 'N-1')
    const [[bN]] = await bal(colB, P, 'N')
    const [[bNextN1]] = await bal(colB, NP, 'N-1')

    rec('U3', 'Salarié A : N-1/N/N+1 remis à zéro', num(aN1.available_days) === 0 && num(aN.available_days) === 0 && num(aNp1.available_days) === 0, `N-1=${aN1.available_days} N=${aN.available_days} N+1=${aNp1.available_days}`)
    rec('U4', 'Salarié A : N-1 suivant = 27 (report 2 + lot 4 + N arrondi 21)', num(aNextN1?.available_days ?? 0) === 27, `nextN-1=${aNextN1?.available_days}`)
    rec('U5', 'Salarié B (sans lot) : compteurs traités par la clôture normale', num(bN1.available_days) === 0 && num(bN.available_days) === 0 && num(bNextN1?.available_days ?? 0) === 12, `N-1=${bN1.available_days} N=${bN.available_days} nextN-1=${bNextN1?.available_days}`)

    const [[lotA]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-conf`])
    rec('U6', 'Lot confirmé transféré vers la période suivante (statut conservé)', lotA?.target_reference_period === NP && lotA?.status === 'ACTIF', `target=${lotA?.target_reference_period} status=${lotA?.status}`)

    const [mvA] = await conn.query("SELECT movement_type, reason FROM balance_movements WHERE employee_id=? ORDER BY id", [colA.id])
    const reasons = mvA.map((m) => m.reason ?? '')
    const hasArrondi = reasons.some((r) => r.startsWith('CLOTURE_ARRONDI_L3141_7'))
    const hasTransfertN = reasons.some((r) => r.startsWith('CLOTURE_TRANSFERT_N'))
    const hasReportTransfert = reasons.some((r) => r.startsWith('REPORT_TRANSFERT|'))
    const hasPeriode = reasons.some((r) => r.startsWith('CLOTURE_PERIODE|'))
    rec('U7', 'Mouvements GMES + lots présents (arrondi, transfert N, transfert lot, remise à zéro)', hasArrondi && hasTransfertN && hasReportTransfert && hasPeriode, reasons.join(','))

    const [[mk]] = await conn.query("SELECT COUNT(*) c FROM settings WHERE setting_key='REFERENCE_PERIOD_CLOSED_2020_2021'")
    const [[mkTreated]] = await conn.query("SELECT COUNT(*) c FROM settings WHERE setting_key='CARRYOVER_LOTS_TREATED_2020_2021'")
    rec('U8', 'Marqueur définitif unique (aucun marqueur de pré-traitement)', num(mk.c) === 1 && num(mkTreated.c) === 0, `definitif=${mk.c} pretraitement=${mkTreated.c}`)

    const [notif] = await conn.query("SELECT COUNT(*) c FROM notifications WHERE type='REFERENCE_PERIOD_CLOSED'")
    const [audit] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE action='REFERENCE_PERIOD_CLOSED' AND JSON_EXTRACT(new_value, '$.referencePeriod')='2020-2021'")
    rec('U9', 'Notifications + audit de clôture présents', num(notif[0]?.c ?? 0) >= 2 && num(audit[0]?.c ?? 0) >= 1, `notif=${notif[0]?.c} audit=${audit[0]?.c}`)

    // ── Dossier incomplet : échéance incertaine → blocage sans remise à zéro ─
    {
      const Q = '2019-2020'
      await addBalance(colC, Q, 'N-1', 5, 5)
      await addUncertainLot(colC, 'unc', 3, Q)
      const [[before]] = await bal(colC, Q, 'N-1')
      const [[mvBefore]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
      const r = await normalClose(Q)
      const [[after]] = await bal(colC, Q, 'N-1')
      const [[mvAfter]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
      const [[lot]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-unc`])
      const [[mkQ]] = await conn.query("SELECT COUNT(*) c FROM settings WHERE setting_key='REFERENCE_PERIOD_CLOSED_2019_2020'")
      const ok = r.status === 400 && num(before.available_days) === num(after.available_days) && num(mvBefore.c) === num(mvAfter.c) && lot?.target_reference_period === Q && num(mkQ.c) === 0
      rec('U10', 'Échéance incertaine → blocage sans remise à zéro ni marqueur', ok, `HTTP ${r.status} avail=${before.available_days}→${after.available_days} mv=${mvBefore.c}→${mvAfter.c} marker=${mkQ.c}`)
    }

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L5-UNIFIE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), results, failed }, null, 2))
    process.exitCode = failed ? 1 : 0
  } finally {
    await conn.end()
  }
}

main().catch((error) => {
  console.error('ERREUR L5-UNIFIE :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
