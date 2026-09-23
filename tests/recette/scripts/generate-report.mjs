import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = path.resolve(__dirname, '../reports/recette-results.json')

try {
  const results = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
  const counts = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {})

  console.log(`Rapport : ${REPORT_PATH}`)
  console.log(`Scénarios enregistrés : ${results.length}`)
  console.log('Statuts :', counts)
} catch (error) {
  console.error(`Impossible de lire le rapport : ${error.message}`)
  process.exitCode = 1
}
