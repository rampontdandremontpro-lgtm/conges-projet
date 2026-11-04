// JUR-027 — Lot L1 : application manuelle de la migration additive `carryover_lots`.
// Cible IMPÉRATIVE : gestion_conges_gmes_test (garde-fou dur).
// N'exécute AUCUNE autre migration et ne touche à aucune table existante.
import mysql from 'mysql2/promise'
import { pathToFileURL } from 'node:url'

export const TARGET_DB = 'gestion_conges_gmes_test'
export const MIGRATION_NAME = 'AddCarryoverLots20261026180000'
export const MIGRATION_TIMESTAMP = 261026180000

// SQL strictement identique à la migration TypeORM
// backend/src/database/migrations/20261026180000-add-carryover-lots.ts
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS \`carryover_lots\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`employee_id\` bigint NOT NULL,
  \`source_reference_period\` varchar(20) NOT NULL,
  \`target_reference_period\` varchar(20) NOT NULL,
  \`target_counter_type\` varchar(20) NOT NULL DEFAULT 'N-1',
  \`days\` decimal(7,2) NOT NULL DEFAULT 0,
  \`remaining_days\` decimal(7,2) NULL,
  \`origin\` varchar(20) NOT NULL DEFAULT 'AUTRE',
  \`regime\` varchar(20) NOT NULL DEFAULT 'GENERAL',
  \`status\` varchar(20) NOT NULL DEFAULT 'A_VERIFIER',
  \`absence_start_date\` date NULL,
  \`absence_end_date\` date NULL,
  \`reprise_date\` date NULL,
  \`information_date\` date NULL,
  \`information_mode\` varchar(40) NULL,
  \`proof_id\` bigint NULL,
  \`expires_at\` date NULL,
  \`expiry_basis\` text NULL,
  \`reason\` text NULL,
  \`created_by\` bigint NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`IDX_carryover_lots_employee_status\` (\`employee_id\`, \`status\`),
  KEY \`IDX_carryover_lots_target\` (\`target_reference_period\`, \`target_counter_type\`),
  KEY \`IDX_carryover_lots_expires\` (\`expires_at\`),
  CONSTRAINT \`FK_carryover_lots_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`FK_carryover_lots_creator\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`FK_carryover_lots_proof\` FOREIGN KEY (\`proof_id\`) REFERENCES \`documents\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

export async function openConnection() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'root',
    database: TARGET_DB,
  })
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db')
  if (db !== TARGET_DB) {
    await conn.end()
    throw new Error(`Garde-fou : base cible inattendue « ${db} » (attendu ${TARGET_DB}).`)
  }
  return conn
}

export async function ensureMigration(conn) {
  const [tables] = await conn.query('SHOW TABLES LIKE ?', ['carryover_lots'])
  const tableExists = tables.length > 0

  await conn.query(MIGRATION_SQL)

  const [rows] = await conn.query(
    'SELECT id FROM typeorm_migrations WHERE name = ?',
    [MIGRATION_NAME],
  )
  if (rows.length === 0) {
    await conn.query(
      'INSERT INTO typeorm_migrations (timestamp, name) VALUES (?, ?)',
      [MIGRATION_TIMESTAMP, MIGRATION_NAME],
    )
  }

  return { tableExistedBefore: tableExists, migrationRecordInserted: rows.length === 0 }
}

async function main() {
  const conn = await openConnection()
  try {
    const result = await ensureMigration(conn)
    const [cols] = await conn.query('SHOW COLUMNS FROM carryover_lots')
    console.log('MIGRATION OK')
    console.log('table pré-existante :', result.tableExistedBefore)
    console.log('enregistrement typeorm_migrations inséré :', result.migrationRecordInserted)
    console.log('colonnes carryover_lots :', cols.map((c) => c.Field).join(', '))
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('ERREUR MIGRATION :', error.message)
    process.exit(1)
  })
}
