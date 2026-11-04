// JUR-027 — L5 (clôture unifiée) : concurrence réelle, verrou de période,
// rollback complet (traitement des lots + opérations GMES dans UNE transaction).
//
// Le pré-traitement autonome L5 est désormais BLOQUÉ : la clôture de période
// GMES (POST /leave-balances/period/close) traite les lots maladie et les
// opérations GMES dans la même transaction, avec un seul verrou et un seul
// marqueur définitif.
//
// Cible IMPÉRATIVE : gestion_conges_gmes_test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = path.resolve(__dirname, '../reports/retest-l5-coordination.json')

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

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
    const tag = 'COORD' + Date.now().toString(36)

    const addBalance = (emp, period, counter, available, reserved = 0, acquired = available) =>
      conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, 0)', [emp.id, period, counter, acquired, available, reserved])
    const addAcquisition = (emp, balanceId, days) =>
      conn.query("INSERT INTO balance_movements (employee_id, leave_balance_id, movement_type, days, balance_before, balance_after) VALUES (?, ?, 'ACQUISITION', ?, 0, ?)", [emp.id, balanceId, days, days])
    // Lot maladie confirmé, échéance juridiquement certaine (protégé).
    const addLot = (emp, key, days, remaining, target) =>
      conn.query(
        `INSERT INTO carryover_lots (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version, reference_period_end_date)
         VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-09-25', 'L3141-19-1', ?, 0, '2025-05-31')`,
        [emp.id, target, days, remaining, `${tag}-${key}`],
      )

    const normalClose = (p) => apiRequest('/leave-balances/period/close', { method: 'POST', token: rh, body: { referencePeriod: p, confirm: true } })
    const l5Execute = (p) => apiRequest(`/carryover-lots/closure/${p}/execute`, { method: 'POST', token: rh })
    const marker = async (p) => {
      const rows = await conn.query('SELECT setting_value FROM settings WHERE setting_key=?', [`REFERENCE_PERIOD_CLOSED_${p.replace('-', '_')}`])
      return rows[0]?.[0]?.setting_value ?? null
    }
    const lockName = (p) => `carr_closure_${p}`
    const isFreeLock = async (name) => num((await conn.query('SELECT IS_FREE_LOCK(?) AS v', [name]))[0][0].v)
    const isUsedLock = async (name) => (await conn.query('SELECT IS_USED_LOCK(?) AS v', [name]))[0][0]?.v ?? null

    // ── C1 : deux clôtures normales simultanées (avec lots) → une seule ─────
    {
      const P = '2019-2020'
      await addBalance(colA, P, 'N-1', 4)
      await addLot(colA, 'sim', 4, 4, P)
      const [r1, r2] = await Promise.all([normalClose(P), normalClose(P)])
      const st = [r1.status, r2.status].sort()
      const [[cur]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colA.id, P])
      const [[next]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2020-2021' AND counter_type='N-1'", [colA.id])
      const [[lot]] = await conn.query('SELECT target_reference_period FROM carryover_lots WHERE idempotency_key=?', [`${tag}-sim`])
      const [[mv]] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND reason LIKE 'REPORT_TRANSFERT|2019-2020|%'", [colA.id])
      const [[mkCount]] = await conn.query("SELECT COUNT(*) c FROM settings WHERE setting_key='REFERENCE_PERIOD_CLOSED_2019_2020'")
      const ok = st.join(',') === '201,409' && num(cur.available_days) === 0 && num(next?.available_days ?? 0) === 4 && lot.target_reference_period === '2020-2021' && num(mv.c) === 2 && num(mkCount.c) === 1 && (await isFreeLock(lockName(P))) === 1
      rec('C1', 'Deux clôtures simultanées (avec lots) → 1 clôture définitive', ok, `HTTP ${st.join('/')} cur=${cur.available_days} next=${next?.available_days} mv=${mv.c} markers=${mkCount.c} lockFree=${await isFreeLock(lockName(P))}`)
    }

    // ── C2 : deux clôtures normales simultanées (sans lot) → une seule ──────
    {
      const P = '2018-2019'
      await addBalance(colB, P, 'N-1', 7)
      const [r1, r2] = await Promise.all([normalClose(P), normalClose(P)])
      const st = [r1.status, r2.status].sort()
      const [[mkCount]] = await conn.query("SELECT COUNT(*) c FROM settings WHERE setting_key='REFERENCE_PERIOD_CLOSED_2018_2019'")
      const ok = st.join(',') === '201,409' && num(mkCount.c) === 1 && (await isFreeLock(lockName(P))) === 1
      rec('C2', 'Deux clôtures simultanées (sans lot) → 201/409', ok, `HTTP ${r1.status}/${r2.status} markers=${mkCount.c}`)
    }

    // ── C3 : clôture unifiée avec lot : lots + GMES dans une transaction ────
    {
      const P = '2017-2018'
      const [nMinus1] = await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colC.id, P, 'N-1', 6, 6, 0, 0])
      await addLot(colC, 'seq', 4, 4, P)
      const [n] = await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colC.id, P, 'N', 20.5, 20.5, 0, 0])
      await addAcquisition(colC, n.insertId, 20.5)
      await addBalance(colC, P, 'N+1', 3)
      const e1 = await normalClose(P)
      const [[lot]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-seq`])
      const [[next]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2018-2019' AND counter_type='N-1'", [colC.id])
      const [[nAfter]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N'", [colC.id, P])
      const mkAfter = await marker(P)
      const ok = e1.status === 201 && lot.target_reference_period === '2018-2019' && num(next?.available_days ?? 0) === 25 && num(nAfter.available_days) === 0 && mkAfter !== null
      rec('C3', 'Clôture unifiée : lot transféré + N arrondi/transféré + N+1 remis à zéro', ok, `HTTP ${e1.status} next=${next?.available_days} lotTarget=${lot.target_reference_period} N=${nAfter.available_days}`)
    }

    // ── C4 : clôture normale puis nouvelle tentative → 409 ──────────────────
    {
      const P = '2016-2017'
      await addBalance(colA, P, 'N-1', 7)
      const e1 = await normalClose(P)
      const e2 = await normalClose(P)
      const ok = e1.status === 201 && e2.status === 409
      rec('C4', 'Clôture rejouée refusée (409)', ok, `HTTP ${e1.status}/${e2.status}`)
    }

    // ── C5 : pré-traitement autonome L5 bloqué ──────────────────────────────
    {
      const P = '2015-2016'
      await addBalance(colB, P, 'N-1', 5)
      const r = await l5Execute(P)
      const [[bal]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colB.id, P])
      const mk = await marker(P)
      const ok = r.status === 400 && num(bal.available_days) === 5 && mk === null
      rec('C5', 'Pré-traitement autonome L5 bloqué (aucune écriture)', ok, `HTTP ${r.status} avail=${bal.available_days} marker=${mk}`)
    }

    // ── C6 : verrou déjà occupé → délai d'attente + libération ──────────────
    {
      const P = '2014-2015'
      await addBalance(colC, P, 'N-1', 5)
      const name = lockName(P)
      const [[myId]] = await conn.query('SELECT CONNECTION_ID() AS id')
      await conn.query('SELECT GET_LOCK(?, 0)', [name])
      const heldBy = await isUsedLock(name)
      const t0 = Date.now()
      const r = await normalClose(P)
      const elapsed = Date.now() - t0
      const stillHeldBy = await isUsedLock(name)
      const ok = r.status === 409 && num(heldBy) === num(myId.id) && num(stillHeldBy) === num(myId.id) && elapsed >= 9000
      rec('C6', 'Verrou occupé → 409 après délai d\'attente', ok, `HTTP ${r.status} heldBy=${heldBy}(conn ${myId.id}) elapsed=${elapsed}ms`)
      await conn.query('SELECT RELEASE_LOCK(?)', [name])
      rec('C6-rel', 'Verrou libéré sur la connexion connue', (await isFreeLock(name)) === 1, `free=${await isFreeLock(name)}`)
    }

    // ── C7 : rollback complet — lots traités puis erreur GMES ───────────────
    {
      const P = '2011-2012'
      await addBalance(colP, P, 'N-1', 4)
      await addLot(colP, 'rb', 4, 4, P)
      const [n] = await conn.query('INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days) VALUES (?, ?, ?, ?, ?, ?, ?)', [colP.id, P, 'N', 20.5, 20.5, 0, 0])
      await addAcquisition(colP, n.insertId, 20.5)
      await addBalance(colP, P, 'N+1', 3)
      const [[balBefore]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colP.id, P])
      const [[nBefore]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N'", [colP.id, P])
      const [[mvBefore]] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE employee_id=?', [colP.id])
      const trig = `trg_l5_unified_rollback_${tag}`
      await conn.query(`CREATE TRIGGER ${trig} BEFORE INSERT ON balance_movements FOR EACH ROW BEGIN IF NEW.employee_id = ${colP.id} AND NEW.reason LIKE 'CLOTURE_TRANSFERT_N%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled unified rollback'; END IF; END`)
      triggers.push(trig)
      const r = await normalClose(P)
      const [[balAfter]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colP.id, P])
      const [[nAfter]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N'", [colP.id, P])
      const [[nplus1After]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N+1'", [colP.id, P])
      const [[nextAfter]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2012-2013' AND counter_type='N-1'", [colP.id])
      const [[mvAfter]] = await conn.query('SELECT COUNT(*) c FROM balance_movements WHERE employee_id=?', [colP.id])
      const [[lotAfter]] = await conn.query('SELECT target_reference_period, status FROM carryover_lots WHERE idempotency_key=?', [`${tag}-rb`])
      const mk = await marker(P)
      const ok = r.status === 500 && num(balBefore.available_days) === num(balAfter.available_days) && num(nBefore.available_days) === num(nAfter.available_days) && num(nplus1After?.available_days ?? 0) === 3 && (nextAfter === undefined || num(nextAfter.available_days) === 0) && num(mvBefore.c) === num(mvAfter.c) && lotAfter?.target_reference_period === P && lotAfter?.status === 'ACTIF' && mk === null && (await isFreeLock(lockName(P))) === 1
      rec('C7', 'Rollback complet : lots traités puis erreur GMES → rien ne subsiste', ok, `HTTP ${r.status} N-1=${balBefore.available_days}→${balAfter.available_days} N=${nBefore.available_days}→${nAfter.available_days} lot=${lotAfter?.target_reference_period}/${lotAfter?.status} mv=${mvBefore.c}→${mvAfter.c} marker=${mk}`)
    }

    // ── C8 : après rollback, nouvelle tentative 201 puis 409 ────────────────
    {
      for (const trig of triggers) {
        await conn.query(`DROP TRIGGER IF EXISTS ${trig}`)
      }
      const P = '2011-2012'
      const e1 = await normalClose(P)
      const e2 = await normalClose(P)
      const [[lot]] = await conn.query('SELECT target_reference_period FROM carryover_lots WHERE idempotency_key=?', [`${tag}-rb`])
      const [[next]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2012-2013' AND counter_type='N-1'", [colP.id])
      const mk = await marker(P)
      const ok = e1.status === 201 && e2.status === 409 && lot?.target_reference_period === '2012-2013' && num(next?.available_days ?? 0) === 25 && mk !== null
      rec('C8', 'Après rollback : nouvelle tentative 201 puis 409', ok, `HTTP ${e1.status}/${e2.status} next=${next?.available_days} marker=${mk !== null}`)
    }

    // ── C9 : période future refusée sans écriture ───────────────────────────
    {
      const P = '2026-2027'
      await addBalance(colA, P, 'N-1', 5)
      await addLot(colA, 'fut', 5, 5, P)
      const [[mvBefore]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
      const r = await normalClose(P)
      const [[mvAfter]] = await conn.query('SELECT COUNT(*) c FROM balance_movements')
      const mk = await marker(P)
      const [[bal]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colA.id, P])
      const ok = r.status === 400 && num(mvBefore.c) === num(mvAfter.c) && mk === null && num(bal.available_days) === 5
      rec('C9', 'Période future refusée sans écriture', ok, `HTTP ${r.status} mv=${mvBefore.c}→${mvAfter.c} marker=${mk}`)
    }

    // ── C10 : période terminée acceptée ─────────────────────────────────────
    {
      const P = '2013-2014'
      await addBalance(colB, P, 'N-1', 3)
      const r = await normalClose(P)
      const [[cur]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period=? AND counter_type='N-1'", [colB.id, P])
      const ok = r.status === 201 && num(cur.available_days) === 0
      rec('C10', 'Période terminée acceptée', ok, `HTTP ${r.status} avail=${cur.available_days}`)
    }

    const failed = results.filter((r) => !r.ok).length
    console.log(`\nRÉSULTAT L5-COORD : ${results.length - failed}/${results.length} OK, ${failed} KO`)
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
  console.error('ERREUR L5-COORD :', error.message)
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ date: new Date().toISOString(), error: error.message }, null, 2))
  process.exit(1)
})
