// Test isolé de la migration AddDerogationSubmittedAt sur base temporaire.
// Ne touche JAMAIS production, jamais la base de développement réelle, jamais
// gestion_conges_gmes_test (base de retest LOT 5).

import { createRequire } from 'node:module'
import mysql from 'mysql2/promise'

const require = createRequire('C:/Users/rampo/conges-project/backend/package.json')
const { DataSource } = require('typeorm')
const {
  AddDerogationSubmittedAt20260929180000,
} = require('C:/Users/rampo/conges-project/backend/dist/database/migrations/20260929180000-add-derogation-submitted-at.js')

const DB = { host: '127.0.0.1', port: 3307, user: 'recette', password: 'recette' }
const TEMP_DB = 'gestion_conges_migration_test'

async function adminQuery(sql, params = []) {
  const c = await mysql.createConnection({ ...DB, database: 'mysql' })
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}
async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection({ ...DB, database: TEMP_DB })
  try { const [rows] = await c.query(sql, params); return rows } finally { await c.end() }
}

async function run() {
  console.log('=== Migration submitted_at — base temporaire ===')
  await adminQuery(`DROP DATABASE IF EXISTS \`${TEMP_DB}\``)
  await adminQuery(`CREATE DATABASE \`${TEMP_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)

  // Schéma AVANT migration : derogations SANS submitted_at
  await dbQuery(`
    CREATE TABLE derogations (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      status ENUM('EN_ATTENTE_RH','ACCORDEE','REFUSEE','UTILISEE','EXPIREE') NOT NULL,
      requested_at DATETIME NOT NULL,
      decided_at DATETIME NULL,
      used_at DATETIME NULL
    ) ENGINE=InnoDB
  `)
  await dbQuery(`
    CREATE TABLE notifications (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(100) NOT NULL,
      derogation_id BIGINT NULL,
      created_at DATETIME NOT NULL
    ) ENGINE=InnoDB
  `)

  // CAS A : EN_ATTENTE_RH sans notification → NULL
  // CAS B : EN_ATTENTE_RH + 2 notifications → MIN(created_at)
  // CAS C : ACCORDEE sans notification, decided_at présent → fallback decided_at
  // CAS D : UTILISEE sans notification, decided_at + used_at → fallback decided_at
  await dbQuery(`INSERT INTO derogations (id, status, requested_at, decided_at, used_at) VALUES
    (1, 'EN_ATTENTE_RH', '2026-09-01 10:00:00', NULL, NULL),
    (2, 'EN_ATTENTE_RH', '2026-09-02 10:00:00', NULL, NULL),
    (3, 'ACCORDEE', '2026-09-05 10:00:00', '2026-09-06 11:00:00', NULL),
    (4, 'UTILISEE', '2026-09-07 10:00:00', '2026-09-08 11:00:00', '2026-09-09 12:00:00')
  `)
  await dbQuery(`INSERT INTO notifications (type, derogation_id, created_at) VALUES
    ('DEROGATION_SUBMITTED_RH', 2, '2026-09-03 08:00:00'),
    ('DEROGATION_SUBMITTED_RH', 2, '2026-09-04 09:00:00')
  `)

  const ds = new DataSource({ type: 'mysql', host: DB.host, port: DB.port, username: DB.user, password: DB.password, database: TEMP_DB, synchronize: false })
  await ds.initialize()
  const qr = ds.createQueryRunner()
  await qr.connect()
  const migration = new AddDerogationSubmittedAt20260929180000()

  await migration.up(qr)
  const afterUp = await dbQuery(`SELECT id, status, submitted_at FROM derogations ORDER BY id`)
  console.log('APRÈS UP:')
  for (const r of afterUp) console.log(`  id=${r.id} status=${r.status} submitted_at=${r.submitted_at ? new Date(r.submitted_at).toISOString().slice(0,19).replace('T',' ') : 'NULL'}`)

  const a = afterUp.find((r) => r.id === 1)
  const b = afterUp.find((r) => r.id === 2)
  const c = afterUp.find((r) => r.id === 3)
  const d = afterUp.find((r) => r.id === 4)

  const casA = a.submitted_at === null ? 'OK (NULL)' : `KO (${a.submitted_at})`
  const casB = b.submitted_at && new Date(b.submitted_at).getTime() === new Date('2026-09-03 08:00:00').getTime() ? 'OK (2026-09-03 08:00:00)' : `KO (${b.submitted_at})`
  const casC = c.submitted_at && new Date(c.submitted_at).getTime() === new Date('2026-09-06 11:00:00').getTime() ? 'OK (2026-09-06 11:00:00)' : `KO (${c.submitted_at})`
  const casD = d.submitted_at && new Date(d.submitted_at).getTime() === new Date('2026-09-08 11:00:00').getTime() ? 'OK (2026-09-08 11:00:00)' : `KO (${d.submitted_at})`
  console.log(`\nCAS A (EN_ATTENTE_RH sans notif): ${casA}`)
  console.log(`CAS B (EN_ATTENTE_RH avec notif): ${casB}`)
  console.log(`CAS C (ACCORDEE sans notif): ${casC}`)
  console.log(`CAS D (UTILISEE sans notif): ${casD}`)

  // Idempotence UP : re-exécuter sur base ayant déjà la colonne → aucun échec, aucune perte
  await migration.up(qr)
  const afterUp2 = await dbQuery(`SELECT id, submitted_at FROM derogations ORDER BY id`)
  const idemOk = afterUp2.every((r, i) => {
    const before = afterUp[i]
    return (r.submitted_at === null && before.submitted_at === null) || (r.submitted_at && before.submitted_at && new Date(r.submitted_at).getTime() === new Date(before.submitted_at).getTime())
  })
  console.log(`\nIDEMPOTENCE UP (2e exécution): ${idemOk ? 'OK (valeurs inchangées)' : 'KO'}`)

  // DOWN : suppression propre de submitted_at uniquement
  await migration.down(qr)
  const colsAfterDown = await dbQuery(`SHOW COLUMNS FROM derogations`)
  const downRemoved = !colsAfterDown.some((c) => c.Field === 'submitted_at')
  const downKept = colsAfterDown.some((c) => c.Field === 'decided_at') && colsAfterDown.some((c) => c.Field === 'used_at')
  console.log(`DOWN: submitted_at supprimé=${downRemoved} | decided_at/used_at conservés=${downKept}`)

  // Nouveau UP : la colonne est recréée et le backfill recomputé à l'identique
  await migration.up(qr)
  const afterReUp = await dbQuery(`SELECT id, status, submitted_at FROM derogations ORDER BY id`)
  const b2 = afterReUp.find((r) => r.id === 2)
  const c2 = afterReUp.find((r) => r.id === 3)
  const reUpOk = b2.submitted_at && new Date(b2.submitted_at).getTime() === new Date('2026-09-03 08:00:00').getTime() && c2.submitted_at && new Date(c2.submitted_at).getTime() === new Date('2026-09-06 11:00:00').getTime()
  console.log(`NOUVEAU UP (après DOWN): ${reUpOk ? 'OK (backfill identique)' : 'KO'}`)

  await qr.release()
  await ds.destroy()

  console.log('\n=== RÉCAP ===')
  console.log(`CAS A: ${casA}`)
  console.log(`CAS B: ${casB}`)
  console.log(`CAS C: ${casC}`)
  console.log(`CAS D: ${casD}`)
  console.log(`DOWN: ${downRemoved && downKept ? 'OK' : 'KO'}`)
  console.log(`NOUVEAU UP: ${reUpOk ? 'OK' : 'KO'}`)

  // Nettoyage de la base temporaire
  await adminQuery(`DROP DATABASE IF EXISTS \`${TEMP_DB}\``)
  console.log('Base temporaire supprimée.')
  process.exit(0)
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
