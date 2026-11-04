// JUR-027 — Lot L4 : application manuelle des migrations additives L4.
// Cible IMPÉRATIVE : gestion_conges_gmes_test. Idempotent.
import { pathToFileURL } from 'node:url'
import { openConnection } from './l1-migrate.mjs'
import { ensureL3Migration } from './l3-migrate.mjs'

export const L4_MIGRATION_NAME = 'AddLotAllocations20261027180000'
export const L4_MIGRATION_TIMESTAMP = 261027180000

export async function ensureL4Migration(conn) {
  const l3 = await ensureL3Migration(conn)

  // 1. Colonne reconciled sur carryover_lots.
  const [cols] = await conn.query('SHOW COLUMNS FROM carryover_lots')
  const existingCols = new Set(cols.map((c) => c.Field))
  let reconciledAdded = false
  if (!existingCols.has('reconciled')) {
    await conn.query('ALTER TABLE `carryover_lots` ADD COLUMN `reconciled` tinyint(1) NULL')
    reconciledAdded = true
  }

  // 2. Table lot_allocations.
  const [tables] = await conn.query("SHOW TABLES LIKE 'lot_allocations'")
  let tableCreated = false
  if (tables.length === 0) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`lot_allocations\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`lot_id\` bigint NOT NULL,
        \`leave_request_id\` bigint NULL,
        \`movement_id\` bigint NULL,
        \`leave_balance_id\` bigint NULL,
        \`operation_type\` varchar(30) NOT NULL,
        \`frozen_in_balance\` tinyint(1) NULL,
        \`days\` decimal(7,2) NOT NULL DEFAULT 0,
        \`covered_dates\` json NULL,
        \`actor_id\` bigint NULL,
        \`reason\` text NULL,
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_lot_allocations_lot\` (\`lot_id\`),
        KEY \`IDX_lot_allocations_request\` (\`leave_request_id\`),
        KEY \`IDX_lot_allocations_movement\` (\`movement_id\`),
        UNIQUE KEY \`UQ_lot_allocations_request_lot_op\` (\`leave_request_id\`, \`lot_id\`, \`operation_type\`),
        CONSTRAINT \`FK_lot_allocations_lot\` FOREIGN KEY (\`lot_id\`) REFERENCES \`carryover_lots\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_lot_allocations_request\` FOREIGN KEY (\`leave_request_id\`) REFERENCES \`leave_requests\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_movement\` FOREIGN KEY (\`movement_id\`) REFERENCES \`balance_movements\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_balance\` FOREIGN KEY (\`leave_balance_id\`) REFERENCES \`leave_balances\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_lot_allocations_actor\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    tableCreated = true
  }

  // 3. Index d'unicité anti-double-consommation (request, lot, opération).
  const [uq] = await conn.query(
    "SHOW INDEX FROM lot_allocations WHERE Key_name = 'UQ_lot_allocations_request_lot_op'",
  )
  let uniqueIndexAdded = false
  if (uq.length === 0) {
    await conn.query(
      'ALTER TABLE `lot_allocations` ADD UNIQUE KEY `UQ_lot_allocations_request_lot_op` (`leave_request_id`, `lot_id`, `operation_type`)',
    )
    uniqueIndexAdded = true
  }

  // 3b. Corrige l'ancien index UNIQUE sur movement_id (plusieurs allocations
  //     peuvent pointer vers un même mouvement : CONSUMPTION + REGULARISATION).
  const [oldMov] = await conn.query(
    "SHOW INDEX FROM lot_allocations WHERE Key_name = 'IDX_lot_allocations_movement' AND Non_unique = 0",
  )
  let movementIndexFixed = false
  if (oldMov.length > 0) {
    await conn.query('ALTER TABLE `lot_allocations` DROP INDEX `IDX_lot_allocations_movement`')
    await conn.query('ALTER TABLE `lot_allocations` ADD KEY `IDX_lot_allocations_movement` (`movement_id`)')
    movementIndexFixed = true
  }

  // 3c. Colonne frozen_in_balance (gel en attente de régularisation RH).
  const [lotCols] = await conn.query('SHOW COLUMNS FROM lot_allocations')
  const lotColNames = new Set(lotCols.map((c) => c.Field))
  let frozenColAdded = false
  if (!lotColNames.has('frozen_in_balance')) {
    await conn.query('ALTER TABLE `lot_allocations` ADD COLUMN `frozen_in_balance` tinyint(1) NULL')
    frozenColAdded = true
  }

  // 4. Enregistrement typeorm_migrations.
  const [rows] = await conn.query('SELECT id FROM typeorm_migrations WHERE name = ?', [
    L4_MIGRATION_NAME,
  ])
  let recordInserted = false
  if (rows.length === 0) {
    await conn.query('INSERT INTO typeorm_migrations (timestamp, name) VALUES (?, ?)', [
      L4_MIGRATION_TIMESTAMP,
      L4_MIGRATION_NAME,
    ])
    recordInserted = true
  }

  return { l3, reconciledAdded, tableCreated, uniqueIndexAdded, movementIndexFixed, frozenColAdded, recordInserted }
}

async function main() {
  const conn = await openConnection()
  try {
    const r = await ensureL4Migration(conn)
    const [cols] = await conn.query('SHOW COLUMNS FROM lot_allocations')
    console.log('MIGRATION L4 OK')
    console.log('reconciled ajouté :', r.reconciledAdded)
    console.log('table lot_allocations créée :', r.tableCreated)
    console.log('index unicité ajouté :', r.uniqueIndexAdded, '| index movement corrigé :', r.movementIndexFixed, '| frozen_in_balance ajouté :', r.frozenColAdded)
    console.log('enregistrement typeorm_migrations L4 :', r.recordInserted)
    console.log('colonnes lot_allocations :', cols.length)
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('ERREUR MIGRATION L4 :', error.message)
    process.exit(1)
  })
}
