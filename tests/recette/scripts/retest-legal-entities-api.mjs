// Retest API : entités juridiques (référence, rattachement, droits, profil).
import { apiRequest, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'LE' + Date.now().toString(36)
const admin = await login('admin.recette@gmes.fr')
const rh = await login('rh.recette@gmes.fr')
const collaborateur = await login('col-a.recette@gmes.fr')

let passed = 0
let failed = 0
const failures = []
function check(label, ok, detail = '') {
  if (ok) passed += 1
  else { failed += 1; failures.push(`${label}${detail ? ` — ${detail}` : ''}`) }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

// 1. Les trois entités.
const entities = (await apiRequest('/legal-entities', { token: collaborateur })).data
check('Trois entités', Array.isArray(entities) && entities.length === 3, JSON.stringify(entities?.map((e) => e.name)))
check('GMES présent', entities.some((e) => e.code === 'GMES'))
check('Efficience présente', entities.some((e) => e.code === 'EFFICIENCE'))
check('GMES Ingénierie présente', entities.some((e) => e.code === 'GMES_INGENIERIE'))

const gmes = entities.find((e) => e.code === 'GMES')
const efficience = entities.find((e) => e.code === 'EFFICIENCE')
const ingenierie = entities.find((e) => e.code === 'GMES_INGENIERIE')

// 2. Création d'un service + utilisateurs de test.
const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data

async function createUser(suffix, legalEntityId) {
  const body = { nom: 'LE', prenom: suffix, email: `le.${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06', legalEntityId }
  return apiRequest('/users', { method: 'POST', token: rh, body })
}

const uEfficience = await createUser('efficience', efficience.id)
check('Création collaborateur Efficience → 201', uEfficience.status === 201, uEfficience.status)
check('Rattachement Efficience enregistré', uEfficience.data?.legalEntity?.name === 'Efficience', uEfficience.data?.legalEntity?.name)

const uIngenierie = await createUser('ingenierie', ingenierie.id)
check('Création collaborateur GMES Ingénierie → 201', uIngenierie.status === 201, uIngenierie.status)
check('Rattachement GMES Ingénierie enregistré', uIngenierie.data?.legalEntity?.name === 'GMES Ingénierie')

// 3. Interne sans entité → rattaché à GMES par défaut (non destructif).
const noEntity = await createUser('sansentite', undefined)
check('Création interne sans entité → 201', noEntity.status === 201, noEntity.status)
check('Création interne sans entité → GMES par défaut', noEntity.data?.legalEntity?.name === 'GMES', noEntity.data?.legalEntity?.name)

// 4. Modification du rattachement (Efficience → GMES Ingénierie).
const upd = await apiRequest(`/users/${uEfficience.data.id}`, { method: 'PATCH', token: rh, body: { legalEntityId: ingenierie.id } })
check('Modification rattachement → 200', upd.status === 200, upd.status)
check('Rattachement modifié conservé', upd.data?.legalEntity?.name === 'GMES Ingénierie', upd.data?.legalEntity?.name)

// 5. Profil : /users/me contient l'entité.
const meToken = signAccessToken({ id: uIngenierie.data.id, email: uIngenierie.data.email, role: 'COLLABORATEUR' })
const me = (await apiRequest('/users/me', { token: meToken })).data
check('Profil : entreprise affichée', me?.legalEntity?.name === 'GMES Ingénierie', me?.legalEntity?.name)

// 6. Refus de modification par le collaborateur lui-même.
const selfPatch = await apiRequest(`/users/${uIngenierie.data.id}`, { method: 'PATCH', token: meToken, body: { legalEntityId: efficience.id } })
check('Collaborateur ne peut pas modifier son entreprise (403)', selfPatch.status === 403, selfPatch.status)

// 7. ADMIN peut aussi gérer.
const uGmes = await createUser('gmes', gmes.id)
check('ADMIN : création rattachée à GMES', uGmes.status === 201 && uGmes.data?.legalEntity?.name === 'GMES', `${uGmes.status} ${uGmes.data?.legalEntity?.name}`)

// Nettoyage.
for (const id of [uEfficience.data.id, uIngenierie.data.id, uGmes.data.id, noEntity.data.id]) {
  await apiRequest(`/users/${id}`, { method: 'DELETE', token: admin })
}

console.log(`\n=== RÉSUMÉ entités juridiques (API) ===`)
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
