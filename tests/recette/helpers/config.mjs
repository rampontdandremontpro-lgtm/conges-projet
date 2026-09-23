import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../../..')
const BACKEND_DIR = path.join(ROOT_DIR, 'backend')
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend')

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

function loadEnv() {
  let fileValues = {}
  let recetteValues = {}
  try {
    fileValues = parseDotEnv(
      fs.readFileSync(path.join(BACKEND_DIR, '.env'), 'utf8'),
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    recetteValues = parseDotEnv(
      fs.readFileSync(path.join(BACKEND_DIR, '.env.recette'), 'utf8'),
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const get = (key, fallback) =>
    process.env[key] ?? recetteValues[key] ?? fileValues[key] ?? fallback

  return {
    ROOT_DIR,
    BACKEND_DIR,
    FRONTEND_DIR,
    API_URL: get('API_URL', 'http://localhost:3000/api').replace(/\/$/, ''),
    FRONTEND_URL: get('FRONTEND_URL', 'http://localhost:5173'),
    JWT_SECRET: get('JWT_SECRET', 'gmes_conges_secret'),
    DB_HOST: get('DB_HOST', 'localhost'),
    DB_PORT: Number(get('DB_PORT', '3306')),
    DB_USERNAME: get('DB_USERNAME', 'root'),
    DB_PASSWORD: get('DB_PASSWORD', ''),
    DB_DATABASE: get('DB_DATABASE', 'gestion_conges_gmes'),
  }
}

export const config = loadEnv()
