// Règle métier : un Collaborateur ne doit JAMAIS déclarer une absence.
// Vérifie côté API (base de test) : création/édition/soumission refusées pour
// le Collaborateur, autorisées pour la RH, consultation conservée.
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const collabToken = await login('col-a.recette@gmes.fr', 'RecetteGMES@2026!')
  const conn = await dbConn()
  const TAG = 'ABS' + Date.now().toString(36)

  const [gmes] = await conn.query("SELECT id FROM legal_entities WHERE code='GMES'")
  const absenceType = (await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Abs-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })).data
  await apiRequest(`/leave-types/${absenceType.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'NON_MEDICAL' } })

  const [[collab]] = await conn.query("SELECT id FROM users WHERE email='col-a.recette@gmes.fr'")
  const collabId = collab.id

  // 1. Collaborateur : création refusée
  const collabCreate = await apiRequest('/absence-declarations', { method: 'POST', token: collabToken, body: { employeeId: collabId, leaveTypeId: absenceType.id, startDate: '2026-12-01', endDate: '2026-12-01' } })
  rec('ABS-COLLAB-CREATE-403', 'Collaborateur : création d’absence refusée (403)', collabCreate.status === 403, `status=${collabCreate.status}`)

  // 2. Collaborateur : preview refusée (partie du formulaire)
  const collabPreview = await apiRequest('/absence-declarations/family-event/preview', { method: 'POST', token: collabToken, body: { leaveTypeId: absenceType.id, startDate: '2026-12-01', endDate: '2026-12-01' } })
  rec('ABS-COLLAB-PREVIEW-403', 'Collaborateur : aperçu famille refusé (403)', collabPreview.status === 403, `status=${collabPreview.status}`)

  // 3. RH : création autorisée (brouillon)
  const rhCreate = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: collabId, leaveTypeId: absenceType.id, startDate: '2026-12-01', endDate: '2026-12-01' } })
  const draftId = rhCreate.data?.id
  rec('ABS-RH-CREATE-OK', 'RH : création d’absence autorisée', rhCreate.status === 201 && Number.isInteger(draftId), `status=${rhCreate.status} id=${draftId}`)

  // 4. Collaborateur : édition du brouillon RH refusée
  const collabPatch = await apiRequest(`/absence-declarations/${draftId}`, { method: 'PATCH', token: collabToken, body: { endDate: '2026-12-02' } })
  rec('ABS-COLLAB-PATCH-403', 'Collaborateur : édition d’absence refusée (403)', collabPatch.status === 403, `status=${collabPatch.status}`)

  // 5. Collaborateur : soumission refusée
  const collabSubmit = await apiRequest(`/absence-declarations/${draftId}/submit`, { method: 'POST', token: collabToken, body: {} })
  rec('ABS-COLLAB-SUBMIT-403', 'Collaborateur : soumission refusée (403)', collabSubmit.status === 403, `status=${collabSubmit.status}`)

  // 6. Collaborateur : suppression refusée
  const collabDelete = await apiRequest(`/absence-declarations/${draftId}`, { method: 'DELETE', token: collabToken, body: {} })
  rec('ABS-COLLAB-DELETE-403', 'Collaborateur : suppression refusée (403)', collabDelete.status === 403, `status=${collabDelete.status}`)

  // 7. Collaborateur : consultation conservée (GET my → 200)
  const collabMy = await apiRequest('/absence-declarations/my', { method: 'GET', token: collabToken })
  rec('ABS-COLLAB-GET-MY-OK', 'Collaborateur : consultation de ses absences conservée (200)', collabMy.status === 200, `status=${collabMy.status}`)

  // 8. RH : édition autorisée
  const rhPatch = await apiRequest(`/absence-declarations/${draftId}`, { method: 'PATCH', token: rhToken, body: { endDate: '2026-12-02' } })
  rec('ABS-RH-PATCH-OK', 'RH : édition d’absence autorisée', rhPatch.status === 200, `status=${rhPatch.status}`)

  // nettoyage brouillon
  await apiRequest(`/absence-declarations/${draftId}`, { method: 'DELETE', token: rhToken, body: {} })

  await conn.end()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\nABSENCE RH-ONLY : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR :', e); process.exit(1) })
