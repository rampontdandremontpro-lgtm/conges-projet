// JUR-027 — Lot L6 : application manuelle des tables de notification
// individuelle et de preuve de réception. Cible IMPÉRATIVE :
// gestion_conges_gmes_test (garde-fou dur). Idempotent.
import { pathToFileURL } from 'node:url'
import { openConnection, ensureMigration } from './l1-migrate.mjs'
import { ensureL3Migration } from './l3-migrate.mjs'
import { ensureL4Migration } from './l4-migrate.mjs'

export const L6_NOTIF_MIGRATION_NAME = 'AddCarryoverNotifications20261028090000'
export const L6_NOTIF_MIGRATION_TIMESTAMP = 261028090000
export const L6_PROOF_MIGRATION_NAME = 'AddCarryoverReceptionProofs20261028091500'
export const L6_PROOF_MIGRATION_TIMESTAMP = 261028091500

const NOTIFICATIONS_SQL = `
CREATE TABLE IF NOT EXISTS \`carryover_notifications\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`reference\` varchar(80) NOT NULL,
  \`employee_id\` bigint NOT NULL,
  \`status\` varchar(30) NOT NULL DEFAULT 'BROUILLON',
  \`established_at\` date NULL,
  \`reprise_date\` date NULL,
  \`content_json\` json NULL,
  \`transmission_mode\` varchar(40) NULL,
  \`transmitted_at\` datetime(6) NULL,
  \`expected_receipt_date\` date NULL,
  \`active_key\` varchar(60) NULL,
  \`document_reference\` varchar(80) NULL,
  \`document_checksum\` varchar(64) NULL,
  \`transmitted_content_json\` json NULL,
  \`coherence_anomaly\` tinyint(1) NULL DEFAULT 0,
  \`coherence_note\` text NULL,
  \`corrected_from_id\` bigint NULL,
  \`version\` int NOT NULL DEFAULT 0,
  \`created_by_id\` bigint NULL,
  \`cancel_reason\` text NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`UQ_carryover_notifications_reference\` (\`reference\`),
  UNIQUE KEY \`UQ_carryover_notifications_active_key\` (\`active_key\`),
  KEY \`IDX_carryover_notifications_employee\` (\`employee_id\`),
  KEY \`IDX_carryover_notifications_status\` (\`status\`),
  CONSTRAINT \`FK_carryover_notifications_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`FK_carryover_notifications_creator\` FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`FK_carryover_notifications_corrected_from\` FOREIGN KEY (\`corrected_from_id\`) REFERENCES \`carryover_notifications\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

const PROOFS_SQL = `
CREATE TABLE IF NOT EXISTS \`carryover_reception_proofs\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`notification_id\` bigint NOT NULL,
  \`employee_id\` bigint NOT NULL,
  \`mode\` varchar(40) NOT NULL,
  \`received_at\` datetime(6) NULL,
  \`proof_reference\` varchar(255) NULL,
  \`checksum\` varchar(64) NULL,
  \`storage_key\` varchar(500) NULL,
  \`mime_type\` varchar(100) NULL,
  \`file_size\` bigint NULL,
  \`status\` varchar(30) NOT NULL DEFAULT 'EN_ATTENTE',
  \`verified_by_id\` bigint NULL,
  \`verified_at\` datetime NULL,
  \`rejection_reason\` text NULL,
  \`verification_result\` varchar(30) NULL,
  \`verification_note\` text NULL,
  \`simulation\` tinyint(1) NULL DEFAULT 0,
  \`history_json\` json NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`UQ_carryover_reception_proofs_storage\` (\`storage_key\`),
  KEY \`IDX_carryover_reception_proofs_notification\` (\`notification_id\`),
  KEY \`IDX_carryover_reception_proofs_employee\` (\`employee_id\`),
  CONSTRAINT \`FK_carryover_reception_proofs_notification\` FOREIGN KEY (\`notification_id\`) REFERENCES \`carryover_notifications\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`FK_carryover_reception_proofs_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`FK_carryover_reception_proofs_verifier\` FOREIGN KEY (\`verified_by_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

async function addColumns(conn, table, columns) {
  const [cols] = await conn.query('SHOW COLUMNS FROM ??', [table])
  const existing = new Set(cols.map((c) => c.Field))
  const added = []
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`)
      added.push(name)
    }
  }
  return added
}

async function ensureUniqueIndex(conn, table, indexName, column) {
  const [idx] = await conn.query('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, indexName])
  if (idx.length === 0) {
    await conn.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`${column}\`)`)
    return true
  }
  return false
}

async function ensureDatetimePrecision(conn, table, column) {
  const [cols] = await conn.query('SHOW COLUMNS FROM ?? WHERE Field = ?', [table, column])
  if (cols.length === 0) return false
  const type = String(cols[0].Type).toLowerCase()
  if (!type.startsWith('datetime(')) {
    await conn.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` datetime(6) NULL`)
    return true
  }
  return false
}

async function recordMigration(conn, name, timestamp) {
  const [rows] = await conn.query('SELECT id FROM typeorm_migrations WHERE name = ?', [name])
  if (rows.length === 0) {
    await conn.query('INSERT INTO typeorm_migrations (timestamp, name) VALUES (?, ?)', [timestamp, name])
    return true
  }
  return false
}

export async function ensureL6Migration(conn) {
  const l4 = await ensureL4Migration(conn)

  const [notifTables] = await conn.query("SHOW TABLES LIKE 'carryover_notifications'")
  let notificationsCreated = false
  if (notifTables.length === 0) {
    await conn.query(NOTIFICATIONS_SQL)
    notificationsCreated = true
  }
  const recordNotif = await recordMigration(conn, L6_NOTIF_MIGRATION_NAME, L6_NOTIF_MIGRATION_TIMESTAMP)

  const [proofTables] = await conn.query("SHOW TABLES LIKE 'carryover_reception_proofs'")
  let proofsCreated = false
  if (proofTables.length === 0) {
    await conn.query(PROOFS_SQL)
    proofsCreated = true
  }
  const recordProof = await recordMigration(conn, L6_PROOF_MIGRATION_NAME, L6_PROOF_MIGRATION_TIMESTAMP)

  // Colonnes ajoutées en correction ciblée (idempotent).
  const notifCols = await addColumns(conn, 'carryover_notifications', [
    ['active_key', 'varchar(60) NULL'],
    ['document_reference', 'varchar(80) NULL'],
    ['document_checksum', 'varchar(64) NULL'],
    ['transmitted_content_json', 'json NULL'],
    ['coherence_anomaly', 'tinyint(1) NULL DEFAULT 0'],
    ['coherence_note', 'text NULL'],
  ])
  const activeIndex = await ensureUniqueIndex(conn, 'carryover_notifications', 'UQ_carryover_notifications_active_key', 'active_key')
  const precisionNotif = await ensureDatetimePrecision(conn, 'carryover_notifications', 'transmitted_at')
  const precisionProof = await ensureDatetimePrecision(conn, 'carryover_reception_proofs', 'received_at')
  const proofCols = await addColumns(conn, 'carryover_reception_proofs', [
    ['verification_result', 'varchar(30) NULL'],
    ['verification_note', 'text NULL'],
    ['simulation', 'tinyint(1) NULL DEFAULT 0'],
  ])

  return { l4, notificationsCreated, recordNotif, proofsCreated, recordProof, notifCols, activeIndex, proofCols, precisionNotif, precisionProof }
}

async function main() {
  const conn = await openConnection()
  try {
    const r = await ensureL6Migration(conn)
    console.log('MIGRATION L6 OK')
    console.log('carryover_notifications créée :', r.notificationsCreated, '| enregistrée :', r.recordNotif)
    console.log('carryover_reception_proofs créée :', r.proofsCreated, '| enregistrée :', r.recordProof)
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('ERREUR MIGRATION L6 :', error.message)
    process.exit(1)
  })
}
