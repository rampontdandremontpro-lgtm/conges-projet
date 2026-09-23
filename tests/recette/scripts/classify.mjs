import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = path.resolve(__dirname, '../manifest/scenarios.json')
const OUTPUT_PATH = path.resolve(__dirname, '../manifest/classification.json')

const scenarios = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

// Classification vérifiée module par module.
// Seul le module AUTH a été réellement analysé et exécuté à ce stade.
const VERIFIED_TYPES = {
  'AUTH-001': 'B',
  'AUTH-002': 'A',
  'AUTH-003': 'A',
  'AUTH-004': 'A',
  'AUTH-005': 'C',
  'AUTH-006': 'B',
  'AUTH-007': 'B',
  'AUTH-008': 'B',
  'PRE-025': 'C',
  'PRE-026': 'C',
  'ADM-001': 'B',
  'ADM-002': 'B',
  'ADM-003': 'B',
  'ADM-004': 'B',
  'ADM-005': 'B',
  'ADM-006': 'A',
  'ADM-007': 'A',
  'ADM-008': 'C',
  'ADM-009': 'B',
  'ADM-010': 'B',
  'ADM-011': 'B',
  'ADM-012': 'B',
  'ADM-013': 'C',
  'ADM-014': 'B',
  'ADM-015': 'B',
  'ADM-016': 'B',
  'ADM-017': 'B',
  'ADM-018': 'B',
  'ADM-019': 'B',
  'ADM-020': 'B',
  'ADM-021': 'B',
  'ADM-022': 'C',
  'ADM-023': 'B',
  'ADM-024': 'B',
  'ADM-025': 'B',
  'SET-001': 'B',
  'SET-002': 'B',
  'SET-003': 'B',
  'SET-004': 'B',
  'SET-005': 'C',
  'SET-006': 'C',
  'SET-007': 'C',
}

const classified = scenarios.map((scenario) => ({
  ...scenario,
  type: VERIFIED_TYPES[scenario.id] ?? 'A_CLASSIFIER',
}))

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
writeFileSync(OUTPUT_PATH, JSON.stringify(classified, null, 2), 'utf8')

const counts = classified.reduce((acc, item) => {
  acc[item.type] = (acc[item.type] ?? 0) + 1
  return acc
}, {})

console.log(`Classification écrite dans ${OUTPUT_PATH}`)
console.log(`Total scénarios : ${classified.length}`)
console.log('Répartition :', counts)
console.log(
  'Les scénarios A_CLASSIFIER seront classés module par module avant leur exécution.',
)
