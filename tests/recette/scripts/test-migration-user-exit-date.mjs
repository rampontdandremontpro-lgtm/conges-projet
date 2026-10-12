// Test isolé de la migration AddUserExitDate sur base temporaire.
// Ne touche JAMAIS production, jamais la base de développement réelle.

import { createRequire } from 'node:module'
import mysql from 'mysql2/promise'

const require = createRequire('C:/Users/rampo/conges-project/backend/package.json')
const { DataSource } = require('typeorm')
const {
  AddUserExitDate20260930180000,
} = require('C:/Users/rampo/conges-project/backend/dist/database/migrations/20260930180000-add-user-exit-date.js')

const DB = { host: '127.0.0.1', port: 3307, user: 'recette', password: 'recette' }
const TEMP_DB = 'gestion_conges_exit_date_migration_test'

async function adminQuery(sql, params = []) {
  const c = await mysql.createConnection({ ...DB, database: 'mysql' })
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}
async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection({ ...DB, database: TEMP_DB })
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}

async function columnInfo() {
  const rows = await dbQuery(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'exit_date'
  `, [TEMP_DB])
  return rows[0] ?? null
}

async function run() {
  console.log('=== Migration exit_date — base temporaire ===')
  await adminQuery(`DROP DATABASE IF EXISTS \`${TEMP_DB}\``)
  await adminQuery(`CREATE DATABASE \`${TEMP_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)

  await dbQuery(`
    CREATE TABLE users (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL,
      hire_date DATE NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB
  `)
  await dbQuery(`INSERT INTO users (id, email, hire_date) VALUES (1, 'a@gmes.fr', '2026-07-01'), (2, 'b@gmes.fr', NULL)`)

  const ds = new DataSource({ type: 'mysql', host: DB.host, port: DB.port, username: DB.user, password: DB.password, database: TEMP_DB, synchronize: false })
  await ds.initialize()
  const qr = ds.createQueryRunner()
  await qr.connect()
  const migration = new AddUserExitDate20260930180000()

  // UP
  await migration.up(qr)
  let col = await columnInfo()
  console.log('APRÈS UP:', JSON.stringify(col))
  const upOk = col && col.DATA_TYPE === 'date' && col.IS_NULLABLE === 'YES' && /date/i.test(col.COLUMN_TYPE)
  console.log('UP OK (colonne DATE NULL):', upOk)

  // Idempotence UP (re-run)
  await migration.up(qr)
  const colsAfterReUp = await dbQuery(`
    SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'exit_date'
  `, [TEMP_DB])
  console.log('UP idempotent (1 seule colonne):', colsAfterReUp[0].n === 1)

  // Valeur historique = NULL
  const hist = await dbQuery(`SELECT id, exit_date FROM users ORDER BY id`)
  console.log('Valeur historique NULL:', hist.every((r) => r.exit_date === null))

  // DOWN
  await migration.down(qr)
  col = await columnInfo()
  console.log('APRÈS DOWN (colonne supprimée):', col === null)

  // DOWN idempotent (pas d'erreur)
  await migration.down(qr)
  console.log('DOWN idempotent: OK')

  // re-UP
  await migration.up(qr)
  col = await columnInfo()
  console.log('APRÈS re-UP:', JSON.stringify(col))
  console.log('re-UP OK:', col && col.DATA_TYPE === 'date' && col.IS_NULLABLE === 'YES')

  await ds.destroy()
  await adminQuery(`DROP DATABASE IF EXISTS \`${TEMP_DB}\``)
  console.log('=== fin ===')
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
