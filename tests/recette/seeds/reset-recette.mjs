// Réinitialisation SÛRE de la base de recette.
//
// Garde-fous :
//   - RECETTE_ENV doit valoir "1"
//   - la base cible doit être EXACTEMENT gestion_conges_gmes_test
//
// La base de développement gestion_conges_gmes n'est utilisée qu'en lecture
// (SHOW CREATE TABLE) pour cloner le schéma. Aucune donnée de développement
// n'est modifiée ni supprimée.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(__dirname, '../../..', 'backend')
const SOURCE_DATABASE = 'gestion_conges_gmes'
const TEST_DATABASE = 'gestion_conges_gmes_test'

function parseDotEnv(content) {
  const values = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function readEnvFile(fileName) {
  try {
    return parseDotEnv(fs.readFileSync(path.join(BACKEND_DIR, fileName), 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return {}
  }
}

function loadConfiguration() {
  const recette = readEnvFile('.env.recette')
  const dev = readEnvFile('.env')

  const get = (key, fallback) =>
    process.env[key] ?? recette[key] ?? dev[key] ?? fallback

  return {
    host: get('DB_HOST', 'localhost'),
    port: Number(get('DB_PORT', '3306')),
    user: get('DB_USERNAME', 'root'),
    password: get('DB_PASSWORD', ''),
    database: get('DB_DATABASE', TEST_DATABASE),
  }
}

function assertResetAllowed(configuration) {
  if (process.env.RECETTE_ENV !== '1') {
    throw new Error(
      'Reset refusé : RECETTE_ENV doit valoir "1" pour réinitialiser la base de recette.',
    )
  }

  if (configuration.database !== TEST_DATABASE) {
    throw new Error(
      `Reset refusé : la base "${configuration.database}" n'est pas la base de recette autorisée "${TEST_DATABASE}".`,
    )
  }
}

const ACCOUNTS = [
  { nom: 'ADMIN-TEST', prenom: 'Recette', email: 'admin.recette@gmes.fr', role: 'ADMIN', password: 'RecetteGMES@2026!' },
  { nom: 'RH-TEST', prenom: 'Recette', email: 'rh.recette@gmes.fr', role: 'RH', password: 'RecetteGMES@2026!' },
  { nom: 'DIR-TEST', prenom: 'Recette', email: 'directeur.recette@gmes.fr', role: 'DIRECTEUR', password: 'RecetteGMES@2026!' },
  { nom: 'RESP-TEST', prenom: 'Recette', email: 'responsable.recette@gmes.fr', role: 'RESPONSABLE_SERVICE', password: 'RecetteGMES@2026!' },
  { nom: 'COL-A', prenom: 'Recette', email: 'col-a.recette@gmes.fr', role: 'COLLABORATEUR', password: 'RecetteGMES@2026!', hireDate: '2026-01-06' },
  { nom: 'COL-B', prenom: 'Recette', email: 'col-b.recette@gmes.fr', role: 'COLLABORATEUR', password: 'RecetteGMES@2026!', hireDate: '2026-01-06' },
  { nom: 'COL-C', prenom: 'Recette', email: 'col-c.recette@gmes.fr', role: 'COLLABORATEUR', password: 'RecetteGMES@2026!', hireDate: '2026-01-06' },
  { nom: 'COL-PRORATA', prenom: 'Recette', email: 'col-prorata.recette@gmes.fr', role: 'COLLABORATEUR', password: 'RecetteGMES@2026!', hireDate: '2026-02-16' },
]

async function cloneSchema(sourceConnection, testConnection) {
  const [rows] = await sourceConnection.query('SHOW TABLES')
  const tableKey = Object.keys(rows[0] ?? {})[0]
  const tables = rows.map((row) => row[tableKey])

  await testConnection.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of tables) {
    const [createRows] = await sourceConnection.query(`SHOW CREATE TABLE \`${table}\``)
    const createKey = Object.keys(createRows[0] ?? {}).find((key) =>
      key.toLowerCase().startsWith('create'),
    )
    const createStatement = createRows[0][createKey]
    await testConnection.query(createStatement)
  }
  await testConnection.query('SET FOREIGN_KEY_CHECKS = 1')

  return tables.length
}

async function seedAccounts(connection) {
  const passwordHash = bcrypt.hashSync('RecetteGMES@2026!', 12)
  for (const account of ACCOUNTS) {
    await connection.query(
      `INSERT INTO users
        (nom, prenom, email, password_hash, role, employment_type, hire_date, presence_status, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, 'INTERNE', ?, 'PRESENT', 1, 0)`,
      [
        account.nom,
        account.prenom,
        account.email,
        passwordHash,
        account.role,
        account.hireDate ?? null,
      ],
    )
  }
  return ACCOUNTS.length
}

// Ces valeurs reproduisent les fallbacks applicatifs pour rendre la recette déterministe.
const DEFAULT_SETTINGS = [
  ['MODIFICATION_DEADLINE_DAYS', '7', 'Délai de modification d’une demande'],
  ['NORMAL_REQUEST_DEADLINE_DAYS', '30', 'Délai normal de dépôt'],
  ['SPECIAL_REQUEST_DEADLINE_DAYS', '60', 'Délai spécial période estivale'],
  ['SPECIAL_DURATION_THRESHOLD_DAYS', '21', 'Seuil long séjour'],
  ['SUMMER_PERIOD_START', '05-01', 'Début de la période estivale'],
  ['SUMMER_PERIOD_END', '10-31', 'Fin de la période estivale'],
  ['AFTERNOON_START_HOUR', '12:00', 'Heure de bascule après-midi'],
]

async function seedSettings(connection) {
  for (const [settingKey, settingValue, description] of DEFAULT_SETTINGS) {
    await connection.query(
      `INSERT INTO settings (setting_key, setting_value, description, updated_by_id)
       VALUES (?, ?, ?, NULL)`,
      [settingKey, settingValue, description],
    )
  }
  return DEFAULT_SETTINGS.length
}

async function main() {
  const configuration = loadConfiguration()
  assertResetAllowed(configuration)

  console.log(`Création de la base de recette isolée : ${TEST_DATABASE}`)

  const serverConnection = await mysql.createConnection({
    host: configuration.host,
    port: configuration.port,
    user: configuration.user,
    password: configuration.password,
    charset: 'utf8mb4',
    multipleStatements: true,
  })

  try {
    await serverConnection.query(
      `DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``,
    )
    await serverConnection.query(
      `CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    await serverConnection.end()
  }

  const sourceConnection = await mysql.createConnection({
    host: configuration.host,
    port: configuration.port,
    user: configuration.user,
    password: configuration.password,
    database: SOURCE_DATABASE,
    charset: 'utf8mb4',
    multipleStatements: true,
  })

  const testConnection = await mysql.createConnection({
    host: configuration.host,
    port: configuration.port,
    user: configuration.user,
    password: configuration.password,
    database: TEST_DATABASE,
    charset: 'utf8mb4',
    multipleStatements: true,
  })

  try {
    const tableCount = await cloneSchema(sourceConnection, testConnection)
    const accountCount = await seedAccounts(testConnection)
    const settingCount = await seedSettings(testConnection)
    console.log(`OK — schéma cloné (${tableCount} tables), ${accountCount} comptes de recette, ${settingCount} paramètres de recette créés.`)
  } finally {
    await sourceConnection.end()
    await testConnection.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
