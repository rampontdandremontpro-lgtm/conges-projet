// Fusion documentaire finale — RH-ONLY (12/10/2026) + BAL-009.
// Met à jour recette-results.json et recette-results.csv :
//   - 17 scénarios ABS : nouveau référentiel RH-only (preuves retest-abs-rh-only-officiel.json)
//   - BAL-009 : Bloqué -> Conforme (preuves retest-bal009-prorata.json + retest-bal009-ui.json)
// Aucune ligne perdue ni dupliquée. Les historiques sont préservés dans docs/_backup_20261012_fusion/.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS = path.resolve(__dirname, '../reports')
const JSON_PATH = path.join(REPORTS, 'recette-results.json')
const CSV_PATH = path.join(REPORTS, 'recette-results.csv')

const DATE = '2026-10-12'
const PROOF = 'retest-abs-rh-only-officiel.json'
const EVO = 'Évolution fonctionnelle 12/10/2026 : seule la RH crée/soumet/modifie/annule les déclarations d’absence administratives.'

const absUpdates = {
  'ABS-001': { scenario: 'Collaborateur ne peut pas créer une déclaration (même pour lui-même)', type: 'B - API', result: 'POST /absence-declarations (soi-même) HTTP=403 « Vous ne disposez pas des autorisations nécessaires. » ; aucune création, aucune mutation BDD.', proof: PROOF, error: '', comment: EVO },
  'ABS-002': { scenario: 'Collaborateur ne crée pas une absence pour un collègue', type: 'B - API', result: 'POST /absence-declarations (employeeId=COL-C) HTTP=403 ; aucune mutation BDD.', proof: PROOF, error: '', comment: EVO },
  'ABS-003': { scenario: 'Tous les types de déclaration d’absence sont réservés à la RH (création)', type: 'B - API', result: 'POST type normal HTTP=403 | type justificatif HTTP=403 ; aucune mutation BDD (403 quel que soit le type).', proof: PROOF, error: '', comment: EVO },
  'ABS-004': { scenario: 'Collaborateur ne peut plus soumettre un brouillon (même ancien, lui appartenant)', type: 'B - API', result: 'POST /absence-declarations/:id/submit HTTP=403 ; statut BROUILLON inchangé (avant=après).', proof: PROOF, error: '', comment: EVO },
  'ABS-005': { scenario: 'Autre collaborateur ne consulte pas cette absence', type: 'B - API', result: 'GET /absence-declarations/:id : propriétaire HTTP=200, autre collaborateur HTTP=403 ; confidentialité préservée.', proof: PROOF, error: '', comment: 'Précondition : absence préparée par la RH (12/10/2026).' },
  'ABS-006': { scenario: 'Collaborateur ajoute un justificatif PDF valide', type: 'B - API', result: 'POST /documents/absence/:id HTTP=201 | déclaration JUSTIFICATIF_EN_ATTENTE → A_VERIFIER_PAR_RH | document EN_ATTENTE.', proof: PROOF, error: '', comment: 'Précondition RH. Justificatif collaborateur conservé.' },
  'ABS-007': { scenario: 'Autre collaborateur ne consulte pas le justificatif', type: 'B - API', result: 'liste API HTTP=403 | download API HTTP=403 ; aucun PDF divulgué.', proof: PROOF, error: '', comment: 'Précondition RH. Confidentialité conservée.' },
  'ABS-008': { scenario: 'RH consulte les justificatifs à contrôler', type: 'B - API', result: 'GET /documents/management?status=EN_ATTENTE HTTP=200 | document EN_ATTENTE présent.', proof: PROOF, error: '', comment: '' },
  'ABS-009': { scenario: 'Directeur ne télécharge pas le justificatif', type: 'B - API', result: 'GET /documents/:id/download HTTP=403 ; aucun PDF divulgué.', proof: PROOF, error: '', comment: '' },
  'ABS-010': { scenario: 'RH télécharge le justificatif', type: 'B - API', result: 'GET /documents/:id/download HTTP=200 | Content-Type=application/pdf | signature=%PDF- | hash SHA-256 identique.', proof: PROOF, error: '', comment: '' },
  'ABS-011': { scenario: 'RH rejette le justificatif avec un motif', type: 'B - API', result: 'POST /documents/:id/reject HTTP=200 | document REJETE (motif conservé) | absence → JUSTIFICATIF_EN_ATTENTE.', proof: PROOF, error: '', comment: '' },
  'ABS-012': { scenario: 'Collaborateur remplace le justificatif rejeté', type: 'B - API', result: 'POST /documents/absence/:id HTTP=201 | ancien document ARCHIVE | nouveau document EN_ATTENTE | absence → A_VERIFIER_PAR_RH.', proof: PROOF, error: '', comment: 'Remplacement conservé (précondition RH).' },
  'ABS-013': { scenario: 'L’ancien justificatif archivé n’est plus traitable', type: 'B - API', result: 'accept ancien HTTP=404 | reject ancien HTTP=404 ; document archivé non traitable.', proof: PROOF, error: '', comment: '' },
  'ABS-014': { scenario: 'RH accepte le justificatif de remplacement', type: 'B - API', result: 'POST /documents/:id/accept HTTP=200 ACCEPTE | 2e acceptation HTTP=400.', proof: PROOF, error: '', comment: '' },
  'ABS-015': { scenario: 'RH enregistre définitivement l’absence', type: 'B - API', result: 'POST /absence-declarations/:id/register HTTP=200 | statut A_VERIFIER_PAR_RH → ENREGISTREE.', proof: PROOF, error: '', comment: '' },
  'ABS-016': { scenario: 'RH crée une absence pour un collaborateur (interface réelle)', type: 'C - UI + API', result: 'UI RH création HTTP=201 | statut ENREGISTREE | visible par le collaborateur concerné, invisible pour autrui (contrôle API + BDD).', proof: 'Playwright + API + SQL — ' + PROOF, error: '', comment: 'Création RH-only via l’interface réelle.' },
  'ABS-017': { scenario: 'Collaborateur ne peut plus annuler son brouillon d’absence', type: 'B - API', result: 'POST /absence-declarations/:id/cancel HTTP=403 ; statut BROUILLON inchangé (avant=après).', proof: PROOF, error: '', comment: EVO },
}

const bal009Update = {
  status: 'Conforme',
  result: 'Prorata calendaire arbitré : taux mensuel × jours calendaires de présence (arrivée et départ inclus) ÷ jours calendaires du mois, arrondi mathématique 2 déc., crédit automatique, date de sortie enregistrée, correction RH tracée. Cas de référence (taux 2,50) : complet 2,50 ; arrivée 16/07 1,29 ; arrivée 31/07 0,08 ; départ 15/07 1,21 ; départ 31/07 2,50 ; arrivée 16/07+départ 20/07 0,40. Idempotence et correction RH vérifiées.',
  proof: 'retest-bal009-prorata.json + retest-bal009-ui.json',
  error: '',
  comment: 'Arbitrage fonctionnel 12/10/2026 : prorata défini et validé (voir rapports BAL-009).',
}

function escapeCsv(value) {
  const s = String(value ?? '')
  if (/[";\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

const rows = JSON.parse(readFileSync(JSON_PATH, 'utf8'))

for (const row of rows) {
  const id = String(row.id)
  if (absUpdates[id]) {
    Object.assign(row, { ...absUpdates[id], date: DATE })
  } else if (id === 'BAL-009') {
    Object.assign(row, { ...bal009Update, date: DATE })
  }
}

writeFileSync(JSON_PATH, JSON.stringify(rows, null, 2) + '\n', 'utf8')

// Génération CSV cohérente (mêmes colonnes que report.mjs)
const columns = [
  ['ID', 'id'], ['Priorité', 'priority'], ['Module', 'module'], ['Scénario', 'scenario'],
  ['Type de test', 'type'], ['Statut', 'status'], ['Résultat obtenu', 'result'], ['Date', 'date'],
  ['Durée', 'duration'], ['Preuve', 'proof'], ['Erreur', 'error'], ['Commentaire', 'comment'],
]
const header = columns.map(([label]) => label).join(';')
const lines = [header]
for (const row of rows) {
  lines.push(columns.map(([, key]) => escapeCsv(row[key])).join(';'))
}
writeFileSync(CSV_PATH, lines.join('\n') + '\n', 'utf8')

// Vérification
const ids = rows.map((r) => r.id)
const unique = new Set(ids)
console.log('Total lignes JSON:', rows.length)
console.log('IDs uniques:', unique.size)
console.log('ABS conformes:', rows.filter((r) => String(r.id).startsWith('ABS') && r.status === 'Conforme').length, '/', rows.filter((r) => String(r.id).startsWith('ABS')).length)
console.log('BAL-009 statut:', rows.find((r) => r.id === 'BAL-009')?.status)
const statusCount = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
console.log('Répartition statuts:', JSON.stringify(statusCount))
console.log('CSV lignes (hors header):', lines.length - 1)
