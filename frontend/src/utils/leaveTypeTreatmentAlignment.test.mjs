import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '..')
const page = fs.readFileSync(path.join(src, 'pages/rh/LeaveTypesPage.jsx'), 'utf8')
const css = fs.readFileSync(path.join(src, 'styles/rh/leave-types.css'), 'utf8')

assert.match(page, /className="rh-leave-types-treatment-cell"/, 'La colonne Traitement doit utiliser un conteneur commun')
assert.match(css, /\.rh-leave-types-treatment-cell\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*align-self:\s*stretch;/s, 'Le conteneur Traitement doit centrer horizontalement et verticalement tous les badges')
assert.match(css, /\.rh-leave-types-treatment\s*\{[^}]*min-width:\s*0;[^}]*width:\s*auto;[^}]*max-width:\s*92px;/s, 'Les badges standards doivent rester compacts')
assert.match(css, /\.rh-leave-types-treatment--director\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*flex-direction:\s*column;[^}]*gap:\s*0;[^}]*padding:\s*4px 10px;[^}]*border-radius:\s*999px;[^}]*line-height:\s*1\.2;[^}]*white-space:\s*normal;/s, 'Le badge Directeur doit reprendre la même forme pilule et la même respiration que les badges métier multilignes existants')
assert.doesNotMatch(css, /\.rh-leave-types-treatment--director\s*\{[^}]*width:\s*104px;/s, 'Le badge Directeur ne doit plus avoir une largeur fixe qui l’écrase')

console.log('leaveTypeTreatmentAlignment.test.mjs: OK')
