// Lancement du backend sur l'environnement de recette isolé.
//
// Charge explicitement `.env.recette` (base gestion_conges_gmes_test, MariaDB
// 127.0.0.1:3307, utilisateur `recette`) AVANT d'importer l'application
// compilée. Toute configuration manquante ou invalide provoque un arrêt
// explicite (code 1) : il n'y a jamais de repli silencieux vers `.env`, qui
// pointerait la base réelle `gestion_conges_gmes`.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.join(__dirname, '..')
const envFile = path.join(backendDir, '.env.recette')

function fail(message) {
  console.error(`[start:recette] Arrêt : ${message}`)
  process.exit(1)
}

if (!existsSync(envFile)) {
  fail(`fichier « ${envFile} » introuvable. La recette exige .env.recette ; aucun repli vers .env n'est autorisé.`)
}

// Parse KEY=VALUE (valeurs entre guillemets simples/doubles supportées).
const values = {}
for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
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

const required = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'JWT_SECRET']
const missing = required.filter((key) => !values[key]?.trim())
if (missing.length > 0) {
  fail(`configuration incomplète : clé(s) manquante(s) ${missing.join(', ')} dans .env.recette.`)
}

if (values.DB_DATABASE !== 'gestion_conges_gmes_test') {
  fail(
    `DB_DATABASE=« ${values.DB_DATABASE} » est interdit pour la recette. ` +
      'Seule « gestion_conges_gmes_test » est autorisée.',
  )
}

// Exporte les valeurs dans process.env : elles priment sur tout autre fichier
// et empêchent l'application de retomber sur les valeurs par défaut (réelles).
process.env.ENV_FILE = '.env.recette'
for (const [key, value] of Object.entries(values)) {
  if (process.env[key] === undefined) {
    process.env[key] = value
  }
}

const distMain = path.join(backendDir, 'dist', 'main.js')
if (!existsSync(distMain)) {
  fail(`backend non compilé : « ${distMain} » introuvable. Lancez d'abord la compilation (npm run build).`)
}

// Sur Windows, import() exige une URL file:// et non un chemin brut (C:\…).
await import(pathToFileURL(distMain).href)
