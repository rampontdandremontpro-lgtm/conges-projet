// Chargeur commun de l'environnement de recette.
//
// Lit `.env.recette` (base gestion_conges_gmes_test, MariaDB 127.0.0.1:3307,
// utilisateur `recette`), le valide, puis exporte les valeurs dans process.env
// pour que le process NestJS (et ses éventuels enfants en mode watch) utilisent
// exclusivement cette configuration.
//
// Toute configuration manquante, invalide ou contredite par une variable
// d'environnement héritée provoque un arrêt explicite (code 1) AVANT toute
// connexion : il n'y a jamais de repli silencieux vers `.env` ni vers la base
// réelle `gestion_conges_gmes`.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.join(__dirname, '..')
const RECETTE_ENV_PATH = path.join(backendDir, '.env.recette')

const PROTECTED_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'JWT_SECRET',
]

export function recetteFail(message) {
  console.error(`[recette] Arrêt : ${message}`)
  process.exit(1)
}

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

export function loadRecatteEnv() {
  if (!existsSync(RECETTE_ENV_PATH)) {
    recetteFail(
      `fichier « ${RECETTE_ENV_PATH} » introuvable. La recette exige .env.recette ; aucun repli vers .env n'est autorisé.`,
    )
  }

  const values = parseDotEnv(readFileSync(RECETTE_ENV_PATH, 'utf8'))

  const missing = PROTECTED_KEYS.filter((key) => !values[key]?.trim())
  if (missing.length > 0) {
    recetteFail(
      `configuration incomplète : clé(s) manquante(s) ${missing.join(', ')} dans .env.recette.`,
    )
  }

  if (values.DB_DATABASE !== 'gestion_conges_gmes_test') {
    recetteFail(
      `DB_DATABASE=« ${values.DB_DATABASE} » est interdit pour la recette. Seule « gestion_conges_gmes_test » est autorisée.`,
    )
  }

  if (values.DB_HOST !== '127.0.0.1') {
    recetteFail(
      `DB_HOST=« ${values.DB_HOST} » non autorisé pour la recette (attendu 127.0.0.1).`,
    )
  }

  if (values.DB_PORT !== '3307') {
    recetteFail(
      `DB_PORT=« ${values.DB_PORT} » non autorisé pour la recette (attendu 3307).`,
    )
  }

  if (values.DB_USERNAME !== 'recette') {
    recetteFail(
      `DB_USERNAME=« ${values.DB_USERNAME} » non autorisé pour la recette (attendu recette).`,
    )
  }

  // Une variable héritée de l'environnement ne doit jamais contredire la
  // configuration de recette (sinon risque de repli vers une autre base).
  for (const key of PROTECTED_KEYS) {
    const inherited = process.env[key]
    if (inherited !== undefined && inherited !== values[key]) {
      recetteFail(
        `variable d'environnement héritée ${key} contredit .env.recette. Définissez-la avant de lancer la recette.`,
      )
    }
  }

  process.env.ENV_FILE = '.env.recette'
  for (const [key, value] of Object.entries(values)) {
    if (PROTECTED_KEYS.includes(key) || process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
