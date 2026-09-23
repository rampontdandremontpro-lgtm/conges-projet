// Point d'entrée de la campagne de recette.
// Le périmètre s'enrichit module par module. Le premier module exécuté est AUTH.
// Priorités :
//   node tests/recette/run-all.mjs --priority P1
//   node tests/recette/run-all.mjs --priority P2

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const priority = process.argv.includes('--priority')
  ? process.argv[process.argv.indexOf('--priority') + 1]
  : null

const modules = [
  ['auth', 'modules/auth/run-auth.mjs'],
]

for (const [name, script] of modules) {
  console.log(`\n=== Module ${name.toUpperCase()} ===`)
  execFileSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
  })
}

if (priority) {
  console.log(`Filtre priorité demandé : ${priority} (l'architecture par priorité sera appliquée aux modules suivants).`)
}
