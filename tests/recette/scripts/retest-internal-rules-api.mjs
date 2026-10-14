// Retest API : gestion des règles internes GMES (CRUD, droits, validation,
// conservation, cas du tableau vide).
import { apiRequest, login } from '../helpers/runner-utils.mjs'

const DEFAULT_RULES = [
  { title: 'Délais de prévenance', content: 'Déposez votre demande au moins {{delai_normal}} calendaires avant le départ. Ce délai passe à {{delai_special}} pour un congé d’au moins {{seuil_duree}} calendaires ou qui chevauche la période estivale.', icon: 'clock' },
  { title: 'Période estivale et demandes particulières', content: 'La période estivale s’étend du {{debut_ete}} au {{fin_ete}} inclus. Un congé qui chevauche cette période, ou d’une durée d’au moins {{seuil_duree}} calendaires, est soumis à un délai de dépôt de {{delai_special}}.', icon: 'sun' },
  { title: 'Périodes de référence N-1, N et N+1', content: 'Les congés sont comptabilisés par période de référence allant du {{debut_periode}} au {{fin_periode}} de l’année suivante. Votre solde se compose des droits N-1, N et N+1.', icon: 'calendar' },
  { title: 'Décompte des jours ouvrables et demi-journées', content: 'Les dimanches et les jours fériés non travaillés ne sont pas décomptés. Une demande peut être posée en journée entière ou en demi-journée (matin ou après-midi). Règle interne GMES : un congé qui se termine le vendredi après-midi décompte également le samedi suivant.', icon: 'check' },
  { title: 'Dérogations et modifications de demandes', content: 'Si le délai de prévenance n’est pas respecté, une dérogation peut être demandée jusqu’au début du congé ; elle est examinée par la RH. Une demande déjà soumise ne peut plus être modifiée dans les {{delai_modification}} précédant le départ.', icon: 'shield' },
  { title: 'Validation des demandes', content: 'Chaque demande est soumise à la validation des personnes compétentes. Le circuit dépend de votre rattachement et de l’existence éventuelle d’une dérogation ; il peut impliquer votre responsable, la RH ou la direction.', icon: 'users' },
]

const admin = await login('admin.recette@gmes.fr')
const rh = await login('rh.recette@gmes.fr')
const collab = await login('col-a.recette@gmes.fr')
const responsable = await login('responsable.recette@gmes.fr')
const directeur = await login('directeur.recette@gmes.fr')

let passed = 0
let failed = 0
const failures = []

function check(label, ok, detail = '') {
  if (ok) passed += 1
  else { failed += 1; failures.push(`${label}${detail ? ` — ${detail}` : ''}`) }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

// 1. Six règles initiales (paramètre non défini → défauts non persistés).
const initial = await apiRequest('/settings/internal-rules', { token: collab })
check('6 règles initiales', Array.isArray(initial.data) && initial.data.length === 6, `reçu: ${initial.data?.length}`)
check('Titres initiaux conformes', initial.data?.every((r, i) => r.title === DEFAULT_RULES[i].title))

// 2. Ajout par la RH.
const created = await apiRequest('/settings/internal-rules', { method: 'POST', token: rh, body: { title: 'Règle test', content: 'Contenu avec {{delai_normal}}.', icon: 'clock' } })
check('RH : ajout → 201', created.status === 201, created.status)
check('RH : ajout → 7 règles', created.data?.length === 7)
const newRule = created.data?.[created.data.length - 1]

// 3. Modification par la RH.
const updated = await apiRequest(`/settings/internal-rules/${newRule.id}`, { method: 'PATCH', token: rh, body: { title: 'Règle test modifiée' } })
check('RH : modification → 200', updated.status === 200, updated.status)
check('RH : modification conservée', updated.data?.some((r) => r.id === newRule.id && r.title === 'Règle test modifiée'))

// 4. Conservation après relecture.
const reloaded = await apiRequest('/settings/internal-rules', { token: collab })
check('Conservation après rechargement', reloaded.data?.length === 7 && reloaded.data.some((r) => r.title === 'Règle test modifiée'))

// 5. Suppression par la RH.
const afterDelete = await apiRequest(`/settings/internal-rules/${newRule.id}`, { method: 'DELETE', token: rh })
check('RH : suppression → 200', afterDelete.status === 200)
check('RH : suppression → retour à 6 règles', afterDelete.data?.length === 6)

// 6. Refus des écritures non autorisées.
const collabPost = await apiRequest('/settings/internal-rules', { method: 'POST', token: collab, body: { title: 'X', content: 'Y', icon: 'info' } })
check('Collaborateur : POST refusé (403)', collabPost.status === 403, collabPost.status)
const respPatch = await apiRequest(`/settings/internal-rules/${initial.data[0].id}`, { method: 'PATCH', token: responsable, body: { title: 'X' } })
check('Responsable : PATCH refusé (403)', respPatch.status === 403, respPatch.status)
const dirDelete = await apiRequest(`/settings/internal-rules/${initial.data[0].id}`, { method: 'DELETE', token: directeur })
check('Directeur : DELETE refusé (403)', dirDelete.status === 403, dirDelete.status)

// 7. Contenus invalides.
const badVar = await apiRequest('/settings/internal-rules', { method: 'POST', token: rh, body: { title: 'X', content: 'Var {{inconnue}}', icon: 'info' } })
check('Variable inconnue → 400', badVar.status === 400, badVar.status)
const badHtml = await apiRequest('/settings/internal-rules', { method: 'POST', token: rh, body: { title: 'X', content: '<script>alert(1)</script>', icon: 'info' } })
check('HTML → 400', badHtml.status === 400, badHtml.status)
const badIcon = await apiRequest('/settings/internal-rules', { method: 'POST', token: rh, body: { title: 'X', content: 'Y', icon: 'pouet' } })
check('Icône inconnue → 400', badIcon.status === 400, badIcon.status)
const badTitle = await apiRequest('/settings/internal-rules', { method: 'POST', token: rh, body: { title: '   ', content: 'Y', icon: 'info' } })
check('Titre vide → 400', badTitle.status === 400, badTitle.status)

// 8. Suppression de toutes les règles → tableau vide persistant.
const current = await apiRequest('/settings/internal-rules', { token: rh })
for (const rule of current.data) {
  await apiRequest(`/settings/internal-rules/${rule.id}`, { method: 'DELETE', token: rh })
}
const emptied = await apiRequest('/settings/internal-rules', { token: rh })
check('Suppression de tout → tableau vide', Array.isArray(emptied.data) && emptied.data.length === 0)
const recheck = await apiRequest('/settings/internal-rules', { token: rh })
check('Pas de réapparition automatique', Array.isArray(recheck.data) && recheck.data.length === 0)

// 9. Re-seed des six règles par défaut (pour la suite des tests UI).
for (const rule of DEFAULT_RULES) {
  await apiRequest('/settings/internal-rules', { method: 'POST', token: admin, body: rule })
}
const reseeded = await apiRequest('/settings/internal-rules', { token: admin })
check('Re-seed : 6 règles', reseeded.data?.length === 6)

console.log(`\n=== RÉSUMÉ règles internes (API) ===`)
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
