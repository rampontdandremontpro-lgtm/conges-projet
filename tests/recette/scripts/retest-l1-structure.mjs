// JUR-027 — Lot L1 : test de structure (création, idempotence, non-régression).
import { openConnection, ensureMigration, MIGRATION_NAME } from './l1-migrate.mjs'

async function snapshot(conn) {
  const [tables] = await conn.query('SHOW TABLES')
  const tableNames = tables.map((t) => Object.values(t)[0]).sort()
  const [bal] = await conn.query(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(CAST(acquired_days AS DECIMAL(10,2))),0) AS acquired,
            COALESCE(SUM(CAST(reserved_days AS DECIMAL(10,2))),0) AS reserved,
            COALESCE(SUM(CAST(consumed_days AS DECIMAL(10,2))),0) AS consumed,
            COALESCE(SUM(CAST(available_days AS DECIMAL(10,2))),0) AS available
     FROM leave_balances`,
  )
  const [mv] = await conn.query(
    `SELECT COUNT(*) AS c, COALESCE(SUM(CAST(days AS DECIMAL(10,2))),0) AS days FROM balance_movements`,
  )
  const [st] = await conn.query('SELECT COUNT(*) AS c FROM settings')
  const [lr] = await conn.query('SELECT COUNT(*) AS c FROM leave_requests')
  const [nt] = await conn.query('SELECT COUNT(*) AS c FROM notifications')
  return {
    tableNames,
    balances: { ...bal[0] },
    movements: { ...mv[0] },
    settingsCount: st[0].c,
    leaveRequests: lr[0].c,
    notifications: nt[0].c,
  }
}

const num = (v) => Number(v)

async function main() {
  const conn = await openConnection()
  const results = []
  const rec = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
  }

  try {
    const before = await snapshot(conn)
    const beforeTableCount = before.tableNames.length

    const first = await ensureMigration(conn)
    const second = await ensureMigration(conn)

    const after = await snapshot(conn)
    const [cols] = await conn.query('SHOW COLUMNS FROM carryover_lots')
    const [migRows] = await conn.query(
      'SELECT * FROM typeorm_migrations WHERE name = ?',
      [MIGRATION_NAME],
    )

    rec(
      'Structure créée (17 → 18 tables)',
      after.tableNames.length === beforeTableCount + 1 && after.tableNames.includes('carryover_lots'),
      `${beforeTableCount} → ${after.tableNames.length}`,
    )
    rec('Table carryover_lots : 22 colonnes', cols.length === 22, `cols=${cols.length}`)
    rec(
      'remaining_days nullable (NULL = inconnu, pas zéro)',
      cols.some((c) => c.Field === 'remaining_days' && c.Null === 'YES'),
    )
    rec(
      'Migration idempotente (2 exécutions, 1 enregistrement)',
      first.migrationRecordInserted === true && second.migrationRecordInserted === false,
    )
    rec('Enregistrement typeorm_migrations unique', migRows.length === 1)

    const balUnchanged =
      num(before.balances.acquired) === num(after.balances.acquired) &&
      num(before.balances.reserved) === num(after.balances.reserved) &&
      num(before.balances.consumed) === num(after.balances.consumed) &&
      num(before.balances.available) === num(after.balances.available)
    rec('Soldes N-1/N/N+1 inchangés', balUnchanged)
    rec('Aucun jour crédité', num(before.balances.available) === num(after.balances.available))
    rec(
      'Mouvements existants inchangés',
      before.movements.c === after.movements.c && num(before.movements.days) === num(after.movements.days),
    )
    rec(
      'settings / leave_requests / notifications inchangés',
      before.settingsCount === after.settingsCount &&
        before.leaveRequests === after.leaveRequests &&
        before.notifications === after.notifications,
    )

    console.log('\nColonnes carryover_lots :')
    for (const c of cols) {
      console.log(`  - ${c.Field} ${c.Type}${c.Null === 'YES' ? ' NULL' : ' NOT NULL'}${c.Default ? ` default=${c.Default}` : ''}`)
    }
  } finally {
    await conn.end()
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT L1-STRUCTURE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => {
  console.error('ERREUR :', error.message)
  process.exit(1)
})
