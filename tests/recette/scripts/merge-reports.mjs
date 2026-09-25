import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')

// Source stricte : uniquement les rapports de modules validés.
// Le rapport global et les rapports intermédiaires (UI/API/partials)
// ne doivent JAMAIS être fusionnés dans le global.
const MODULE_SOURCES = [
  'recette-results-auth.json',
  'recette-results-adm.json',
  'recette-results-set.json',
  'recette-results-bal.json',
  'recette-results-abs.json',
  'recette-results-lea.json',
  'recette-results-can.json',
  'recette-results-der.json',
  'recette-results-not.json',
  'recette-results-rhc.json',
  'recette-results-dir.json',
  'recette-results-pre.json',
  'recette-results-ref.json',
  'recette-results-aud.json',
  'recette-results-exp.json',
  'recette-results-e4.json',
  'recette-results-half.json',
]

const FORBIDDEN_SOURCES = new Set([
  'recette-results.json', // rapport global : auto-référence interdite
  'recette-results-api.json', // volet API intermédiaire
  'recette-results-ui.json', // volet UI intermédiaire
  'recette-results-adm-ui.json', // volet UI intermédiaire
])

const all = []
for (const file of MODULE_SOURCES) {
  if (FORBIDDEN_SOURCES.has(file)) {
    throw new Error(`Source interdite dans la fusion : ${file}`)
  }
  const filePath = path.join(REPORTS_DIR, file)
  try {
    const rows = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!Array.isArray(rows)) {
      throw new Error(`Le rapport ${file} n'est pas un tableau JSON.`)
    }
    for (const row of rows) {
      if (!row?.id) {
        throw new Error(`Le rapport ${file} contient une entrée sans id.`)
      }
    }
    all.push(...rows)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn(`Rapport module absent, ignoré : ${file}`)
      continue
    }
    throw error
  }
}

// Déduplication par id (le module le plus récent gagne, ordre stable).
const byId = new Map()
for (const row of all) {
  const existing = byId.get(row.id)
  if (!existing || (row.date ?? '') >= (existing.date ?? '')) {
    byId.set(row.id, row)
  }
}

const duplicateCount = all.length - byId.size
const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))

// Garde-fou supplémentaire : aucun fichier global/intermédiaire n'a été lu.
const presentForbidden = [...FORBIDDEN_SOURCES].filter((file) => {
  try {
    readFileSync(path.join(REPORTS_DIR, file))
    return true
  } catch {
    return false
  }
})
if (presentForbidden.length > 0) {
  console.warn(`Rapports exclus présents mais non fusionnés : ${presentForbidden.join(', ')}`)
}

mkdirSync(REPORTS_DIR, { recursive: true })
writeFileSync(
  path.join(REPORTS_DIR, 'recette-results.json'),
  JSON.stringify(merged, null, 2),
  'utf8',
)

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
const keyMap = {
  ID: 'id',
  'Priorité': 'priority',
  Module: 'module',
  'Scénario': 'scenario',
  'Type de test': 'type',
  Statut: 'status',
  'Résultat obtenu': 'result',
  Date: 'date',
  'Durée': 'duration',
  Preuve: 'proof',
  Erreur: 'error',
  Commentaire: 'comment',
}
const lines = [
  columns.join(';'),
  ...merged.map((row) =>
    columns.map((col) => escapeCsv(row[keyMap[col]])).join(';'),
  ),
]
writeFileSync(
  path.join(REPORTS_DIR, 'recette-results.csv'),
  `\uFEFF${lines.join('\n')}`,
  'utf8',
)

console.log(`Rapport global : ${merged.length} scénarios (${all.length} lus, ${duplicateCount} doublons retirés).`)
