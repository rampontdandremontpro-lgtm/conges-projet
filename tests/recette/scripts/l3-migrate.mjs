// JUR-027 — Lot L3 : application manuelle des migrations additives L3 et L3b
// sur `carryover_lots`. Cible IMPÉRATIVE : gestion_conges_gmes_test (garde-fou).
// Idempotent : vérifie l'existence de chaque colonne/index/FK avant d'agir.
import { pathToFileURL } from 'node:url'
import { openConnection, ensureMigration } from './l1-migrate.mjs'

export const L3_MIGRATION_NAME = 'AddCarryoverLotFields20261027090000'
export const L3_MIGRATION_TIMESTAMP = 261027090000

export const L3B_MIGRATION_NAME = 'AddCarryoverLotConfirmation20261027091500'
export const L3B_MIGRATION_TIMESTAMP = 261027091500

export const L3_COLUMNS = [
  ['absence_status', 'varchar(20) NULL'],
  ['information_date_certain', 'tinyint(1) NULL'],
  ['acquired_during_l3141_5_5or7', 'tinyint(1) NULL'],
  ['suspension_at_least_one_year_at_period_end', 'tinyint(1) NULL'],
  ['indicative_expires_at', 'date NULL'],
  ['idempotency_key', 'varchar(190) NULL'],
  ['source_movement_id', 'bigint NULL'],
  ['version', 'int NOT NULL DEFAULT 0'],
]

export const L3B_COLUMNS = [
  ['confirmation_status', 'varchar(20) NULL'],
  ['reference_period_end_date', 'date NULL'],
]

async function addColumns(conn, columns) {
  const [cols] = await conn.query('SHOW COLUMNS FROM carryover_lots')
  const existing = new Set(cols.map((c) => c.Field))
  const added = []
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await conn.query(`ALTER TABLE \`carryover_lots\` ADD COLUMN \`${name}\` ${definition}`)
      added.push(name)
    }
  }
  return added
}

async function recordMigration(conn, name, timestamp) {
  const [rows] = await conn.query('SELECT id FROM typeorm_migrations WHERE name = ?', [name])
  let inserted = false
  if (rows.length === 0) {
    await conn.query('INSERT INTO typeorm_migrations (timestamp, name) VALUES (?, ?)', [
      timestamp,
      name,
    ])
    inserted = true
  }
  return inserted
}

export async function ensureL3Migration(conn) {
  // 1. Garantit la table de base L1 (idempotent) et son enregistrement.
  const l1 = await ensureMigration(conn)

  // 2. Colonnes L3.
  const addedL3 = await addColumns(conn, L3_COLUMNS)

  // 3. Index d'unicité (anti-doublon).
  const [idx] = await conn.query(
    "SHOW INDEX FROM carryover_lots WHERE Key_name = 'IDX_carryover_lots_idempotency'",
  )
  let indexAdded = false
  if (idx.length === 0) {
    await conn.query(
      'ALTER TABLE `carryover_lots` ADD UNIQUE KEY `IDX_carryover_lots_idempotency` (`idempotency_key`)',
    )
    indexAdded = true
  }

  // 4. FK vers balance_movements (rapprochement du mouvement d'origine).
  const [fks] = await conn.query(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carryover_lots'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND CONSTRAINT_NAME = 'FK_carryover_lots_source_movement'`,
  )
  let fkAdded = false
  if (fks.length === 0) {
    await conn.query(
      'ALTER TABLE `carryover_lots` ADD CONSTRAINT `FK_carryover_lots_source_movement` ' +
        'FOREIGN KEY (`source_movement_id`) REFERENCES `balance_movements` (`id`) ON DELETE SET NULL',
    )
    fkAdded = true
  }

  const recordL3 = await recordMigration(conn, L3_MIGRATION_NAME, L3_MIGRATION_TIMESTAMP)

  // 5. Colonnes L3b.
  const addedL3b = await addColumns(conn, L3B_COLUMNS)
  const recordL3b = await recordMigration(conn, L3B_MIGRATION_NAME, L3B_MIGRATION_TIMESTAMP)

  return {
    l1,
    addedL3,
    addedL3b,
    indexAdded,
    fkAdded,
    recordL3,
    recordL3b,
  }
}

async function main() {
  const conn = await openConnection()
  try {
    const r = await ensureL3Migration(conn)
    const [cols] = await conn.query('SHOW COLUMNS FROM carryover_lots')
    console.log('MIGRATION L3+L3b OK')
    console.log('colonnes L3 ajoutées :', r.addedL3.join(', ') || '(aucune)')
    console.log('colonnes L3b ajoutées :', r.addedL3b.join(', ') || '(aucune)')
    console.log('index unicité ajouté :', r.indexAdded, '| FK ajoutée :', r.fkAdded)
    console.log('enregistrements typeorm_migrations L3/L3b :', r.recordL3, '/', r.recordL3b)
    console.log('total colonnes carryover_lots :', cols.length)
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('ERREUR MIGRATION L3 :', error.message)
    process.exit(1)
  })
}
