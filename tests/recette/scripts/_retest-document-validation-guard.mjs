// Vérifie qu'un justificatif de FONDEMENT ne peut pas être accepté par
// l'endpoint général (POST /documents/:id/accept) sans justification/périmètre,
// et que le parcours dédié reste opérationnel (validation + audit).
import { apiRequest, dbConn, login } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const conn = await dbConn()

  const [ents] = await conn.query('SELECT id, code, convention_type FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const gmesInit = ents.find((e) => e.code === 'GMES')?.convention_type ?? 'NON_RENSEIGNEE'
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec recette' } })

  const TAG = 'DOCGUARD' + Date.now().toString(36)
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const emp = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `DG-${TAG}`, prenom: 'Recette', email: `dg-${TAG.toLowerCase()}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2020-01-01', legalEntityId: gmesId } })).data

  // Téléversement d'un justificatif de fondement (EN ATTENTE).
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  const form = new FormData()
  form.append('employeeId', String(emp.id))
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'fondement.pdf')
  const upRes = await fetch(`${process.env.API_URL ?? 'http://localhost:3001/api'}/documents/basis`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${rhToken}` },
    body: form,
  })
  const uploaded = await upRes.json().catch(() => null)
  if (upRes.status !== 201 && upRes.status !== 200) {
    throw new Error(`upload failed: ${upRes.status} ${JSON.stringify(uploaded)}`)
  }
  const docId = uploaded.id
  rec('GUARD-UPLOAD', 'Téléversement du fondement en EN ATTENTE', uploaded.status === 'EN_ATTENTE', `status=${uploaded.status}`)

  // NÉGATIF : l'endpoint général d'acceptation doit refuser un fondement.
  const acceptRes = await apiRequest(`/documents/${docId}/accept`, { method: 'POST', token: rhToken, body: {} })
  rec('GUARD-ACCEPT-REFUSE', 'Endpoint général d’acceptation refusé pour un fondement (400)', acceptRes.status === 400, `status=${acceptRes.status}`)

  // PARCOURS DÉDIÉ : validation justifiée → ACCEPTE + audit.
  const validateRes = await apiRequest(`/documents/basis/${docId}/validate`, { method: 'POST', token: rhToken, body: { justification: 'Fondement vérifié par la RH.' } })
  rec('GUARD-VALIDATE-OK', 'Parcours dédié : validation justifiée acceptée (200)', validateRes.status === 200 && validateRes.data?.status === 'ACCEPTE', `status=${validateRes.status} doc=${validateRes.data?.status}`)

  const [auditRows] = await conn.query(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE action='DOCUMENT_BASIS_VALIDATED' AND resource_id=?",
    [docId],
  )
  rec('GUARD-AUDIT', 'Trace d’audit enregistrée pour la validation', Number(auditRows?.[0]?.c) === 1, `audit=${auditRows?.[0]?.c}`)

  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: gmesInit } }).catch(() => {})
  await conn.end()

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nGARDE VALIDATION DOCUMENT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR GARDE VALIDATION :', e); process.exit(1) })
