import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeReport } from '../../helpers/report.mjs'

// Met à jour UNIQUEMENT VAL-033 / VAL-034 / VAL-035 dans recette-results-val-b1.{json,csv}
// à partir du log brut de la passe ciblée. Ne réexécute AUCUN scénario.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_PATH = process.argv[2] ?? path.resolve(__dirname, '../../logs/val-b1-033-035-final.log')
const REPORTS_DIR = path.resolve(__dirname, '../../reports')

const log = readFileSync(LOG_PATH, 'utf8')
const resultLine = log.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('RESULT ')).pop()
if (!resultLine) throw new Error('Ligne RESULT introuvable dans ' + LOG_PATH)

const raw = JSON.parse(resultLine.slice('RESULT '.length))
const ids = ['VAL-033', 'VAL-034', 'VAL-035']
for (const id of ids) {
  if (!raw[id]) throw new Error(`${id} absent du log`)
}

const allConforme = ids.every((id) => raw[id].status === 'Conforme')
if (!allConforme) {
  console.error('Abandon : une assertion est non conforme, aucun rapport n’est mis à jour.')
  for (const id of ids) console.error(id, raw[id].status, JSON.stringify(raw[id].checks))
  process.exit(1)
}

const jsonPath = path.join(REPORTS_DIR, 'recette-results-val-b1.json')
const report = JSON.parse(readFileSync(jsonPath, 'utf8'))

const fresh = {
  'VAL-033': {
    result: `UI réelle création prorata → POST /api/validator-replacements 201, replacementId=${raw['VAL-033'].replacementId}, employeeId=${raw['VAL-033'].employeeId}, replacementValidatorId=${raw['VAL-033'].replacementValidatorId}, isActive=true, countBefore=${raw['VAL-033'].countBefore}, countAfter=${raw['VAL-033'].countAfter}`,
    comment: `Passe ciblée propre 033-035 (reset-recette propre) — dates ${raw['VAL-033'].startDate} → ${raw['VAL-033'].endDate}`,
  },
  'VAL-034': {
    result: `UI réelle chevauchement → POST 400 « ${raw['VAL-034'].message} », countBefore=${raw['VAL-034'].countBefore}, countAfter=${raw['VAL-034'].countAfter}, existingStillActive=${raw['VAL-034'].existingStillActive}`,
    comment: `existingReplacementId=${raw['VAL-034'].existingReplacementId}, attemptedDates=${raw['VAL-034'].attemptedDates.startDate} → ${raw['VAL-034'].attemptedDates.endDate}`,
  },
  'VAL-035': {
    result: `UI réelle désactivation → PATCH /api/validator-replacements/${raw['VAL-035'].replacementId}/disable 200, isActive ${raw['VAL-035'].isActiveBefore}→${raw['VAL-035'].isActiveAfter}, resourceStillExists=${raw['VAL-035'].resourceStillExists}, rowCount=${raw['VAL-035'].rowCount}`,
    comment: `replacementId=${raw['VAL-035'].replacementId} (issu de VAL-033), toujours actif avant désactivation`,
  },
}

let changed = 0
for (const entry of report) {
  if (!fresh[entry.id]) continue
  entry.status = 'Conforme'
  entry.result = fresh[entry.id].result
  entry.date = new Date().toISOString()
  entry.proof = ''
  entry.error = ''
  entry.comment = fresh[entry.id].comment
  changed += 1
}

if (changed !== 3) throw new Error(`Attendu 3 entrées mises à jour, reçu ${changed}`)

writeReport(report, { label: 'recette-results-val-b1' })
console.log('RAPPORT MIS À JOUR', ids.join(','), '→ Conforme (3/3)')
