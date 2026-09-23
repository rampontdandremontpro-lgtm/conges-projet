import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')

export const STATUS = {
  CONFORME: 'Conforme',
  NON_CONFORME: 'Non conforme',
  BLOQUE: 'Bloqué',
  A_RETESTER: 'A retester',
  A_TESTER: 'A tester',
}

export function writeReport(results, { label = 'recette-results' } = {}) {
  mkdirSync(REPORTS_DIR, { recursive: true })

  const jsonPath = path.join(REPORTS_DIR, `${label}.json`)
  const csvPath = path.join(REPORTS_DIR, `${label}.csv`)

  writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8')

  const columns = [
    'ID',
    'Priorité',
    'Module',
    'Scénario',
    'Type de test',
    'Statut',
    'Résultat obtenu',
    'Date',
    'Durée',
    'Preuve',
    'Erreur',
    'Commentaire',
  ]

  const escapeCsv = (value) => {
    const stringValue = String(value ?? '')
    if (/[";\n]/.test(stringValue)) {
      return `"${stringValue.replaceAll('"', '""')}"`
    }
    return stringValue
  }

  const lines = [
    columns.join(';'),
    ...results.map((row) =>
      columns
        .map((column) => {
          const key =
            column === 'ID'
              ? 'id'
              : column === 'Priorité'
                ? 'priority'
                : column === 'Module'
                  ? 'module'
                  : column === 'Scénario'
                    ? 'scenario'
                    : column === 'Type de test'
                      ? 'type'
                      : column === 'Statut'
                        ? 'status'
                        : column === 'Résultat obtenu'
                          ? 'result'
                          : column === 'Date'
                            ? 'date'
                            : column === 'Durée'
                              ? 'duration'
                              : column === 'Preuve'
                                ? 'proof'
                                : column === 'Erreur'
                                  ? 'error'
                                  : 'comment'
          return escapeCsv(row[key])
        })
        .join(';'),
    ),
  ]

  writeFileSync(csvPath, `\uFEFF${lines.join('\n')}`, 'utf8')

  return { jsonPath, csvPath }
}

export { REPORTS_DIR, config }
