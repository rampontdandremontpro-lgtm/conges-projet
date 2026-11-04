// JUR-031 — parcours documentaire réel (type requis documentRequired=true)
// et modification d'une période déjà enregistrée.
import { apiRequest, login, dbConn, isoAddDays } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function uploadDocument(token, absenceId, buffer, filename) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename)
  const response = await fetch(`${API_URL}/documents/absence/${absenceId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'ascii',
)

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'DOC' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES')?.id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `Svc-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `DOC-${suffix}`, prenom: 'Recette', email: `doc-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const empLogin = async (suffix) => {
    const u = await mkEmp(suffix)
    await apiRequest(`/users/${u.id}/reset-password`, { method: 'PATCH', token: adminToken, body: { temporaryPassword: 'DocTemp2026!Pass' } })
    return { ...u, token: await login(`doc-${suffix}.${TAG}@recette.fr`, 'DocTemp2026!Pass') }
  }

  // Type requis (documentRequired=true) et type de flux pour la modification.
  const mgmt = await apiRequest('/leave-types/management', { token: rhToken })
  const requiredType = (mgmt.data ?? []).find((t) => t.name === 'Congé de paternité et d’accueil de l’enfant')
  rec('DOC-TYPE-REQUIS', 'Type requis documentRequired=true', requiredType?.documentRequired === true && requiredType?.documentCanBeAddedLater === true, `docReq=${requiredType?.documentRequired}`)

  const mkType = async (name, kind) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }
  const pat = await mkType('Paternité', 'PATERNITE_ACCUEIL')
  const naissance = await mkType('Naissance', 'NAISSANCE')

  const registerBirthLeave = async (token, dateNaissance) => {
    const d = await apiRequest('/absence-declarations', { method: 'POST', token, body: { leaveTypeId: naissance.id, startDate: dateNaissance, endDate: isoAddDays(dateNaissance, 2), familyEventContext: { eventDate: dateNaissance } } })
    await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token, body: { certifiedAccurate: true } })
    await apiRequest(`/absence-declarations/${d.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  }

  // ── A. Parcours documentaire réel ────────────────────────────────────────
  const empA = await empLogin('A')
  const empB = await empLogin('B')
  const ev = await apiRequest('/birth-events', { method: 'POST', token: empA.token, body: { dateNaissance: '2026-06-15', nbEnfants: 1 } })
  await registerBirthLeave(empA.token, '2026-06-15')

  const decl = await apiRequest('/absence-declarations', { method: 'POST', token: empA.token, body: { leaveTypeId: requiredType.id, startDate: '2026-06-18', endDate: '2026-06-21', familyEventContext: { naissanceId: ev.data.id, periode: 'PREMIERE' } } })
  rec('DOC-CREATION', 'Demande créée sur le type requis', decl.status === 201, `http=${decl.status}`)

  const sub = await apiRequest(`/absence-declarations/${decl.data.id}/submit`, { method: 'POST', token: empA.token, body: { certifiedAccurate: true } })
  rec('DOC-STATUT-ATTENTE', 'Soumission sans justificatif → JUSTIFICATIF_EN_ATTENTE', sub.data?.status === 'JUSTIFICATIF_EN_ATTENTE', `status=${sub.data?.status}`)

  const foreignUpload = await uploadDocument(empB.token, decl.data.id, MINIMAL_PDF, 'acte-naissance.pdf')
  rec('DOC-PERMISSION', 'Un autre salarié ne peut pas déposer le justificatif (403)', foreignUpload.status === 403 || foreignUpload.status === 404, `http=${foreignUpload.status}`)

  const up = await uploadDocument(empA.token, decl.data.id, MINIMAL_PDF, 'acte-naissance.pdf')
  rec('DOC-UPLOAD', 'Justificatif PDF déposé et rattaché à la déclaration', up.status === 201 && up.data?.absenceDeclarationId === decl.data.id, `http=${up.status} docId=${up.data?.id}`)

  const afterUpload = await apiRequest(`/absence-declarations/${decl.data.id}`, { token: empA.token })
  rec('DOC-STATUT-A-VERIFIER', 'Après dépôt → A_VERIFIER_PAR_RH', afterUpload.data?.status === 'A_VERIFIER_PAR_RH', `status=${afterUpload.data?.status}`)

  const accept = await apiRequest(`/documents/${up.data.id}/accept`, { method: 'POST', token: rhToken })
  rec('DOC-ACCEPT', 'La RH accepte le justificatif', accept.status === 200 && accept.data?.status === 'ACCEPTE', `status=${accept.data?.status}`)

  const registerResp = await apiRequest(`/absence-declarations/${decl.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  rec('DOC-DECISION-FINALE', 'Décision finale après justificatif accepté', registerResp.data?.status === 'ENREGISTREE', `status=${registerResp.data?.status}`)

  // ── B. Modification d'une période déjà enregistrée ───────────────────────
  const empC = await empLogin('C')
  const evC = await apiRequest('/birth-events', { method: 'POST', token: empC.token, body: { dateNaissance: '2026-06-01', nbEnfants: 1 } })
  await registerBirthLeave(empC.token, '2026-06-01')

  const m1 = await apiRequest('/absence-declarations', { method: 'POST', token: empC.token, body: { leaveTypeId: pat.id, startDate: '2026-06-04', endDate: '2026-06-07', familyEventContext: { naissanceId: evC.data.id, periode: 'PREMIERE' } } })
  await apiRequest(`/absence-declarations/${m1.data.id}/submit`, { method: 'POST', token: empC.token, body: { certifiedAccurate: true } })
  await apiRequest(`/absence-declarations/${m1.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  const m2 = await apiRequest('/absence-declarations', { method: 'POST', token: empC.token, body: { leaveTypeId: pat.id, startDate: '2026-07-01', endDate: '2026-07-10', familyEventContext: { naissanceId: evC.data.id, periode: 'SECONDE', prevenanceDate: '2026-06-01' } } })
  await apiRequest(`/absence-declarations/${m2.data.id}/submit`, { method: 'POST', token: empC.token, body: { certifiedAccurate: true } })
  const m2reg = await apiRequest(`/absence-declarations/${m2.data.id}/register`, { method: 'POST', token: rhToken, body: {} })
  rec('DOC-MODIF-SETUP', 'Période enregistrée avant modification', m2reg.data?.status === 'ENREGISTREE', `status=${m2reg.data?.status}`)

  const mod = await apiRequest(`/absence-declarations/${m2.data.id}`, { method: 'PATCH', token: rhToken, body: { endDate: '2026-07-15' } })
  rec('DOC-MODIF-OK', 'Modification RH d’une période enregistrée (10→15 j calendaires)', mod.status === 200 && mod.data?.durationDays === 15, `http=${mod.status} days=${mod.data?.durationDays}`)

  const modBad = await apiRequest(`/absence-declarations/${m2.data.id}`, { method: 'PATCH', token: rhToken, body: { endDate: '2026-07-22' } })
  rec('DOC-MODIF-CAP', 'Modification au-delà du plafond de 21 j refusée', modBad.status === 400, `http=${modBad.status}`)

  const [auditRows] = await conn.query(
    "SELECT old_value, new_value FROM audit_logs WHERE resource_type='ABSENCE_DECLARATION' AND resource_id = ? AND action='ABSENCE_DECLARATION_MODIFIED' ORDER BY id DESC LIMIT 1",
    [m2.data.id],
  )
  const parseJson = (v) => (v && typeof v === 'string' ? JSON.parse(v) : v)
  const auditOld = parseJson(auditRows?.[0]?.old_value)
  const auditNew = parseJson(auditRows?.[0]?.new_value)
  rec('DOC-AUDIT', 'Historique d’audit : ancienne (10 j) et nouvelle (15 j) situation', !!auditOld && !!auditNew && auditNew?.durationDays === 15 && auditOld?.durationDays === 10, `oldDays=${auditOld?.durationDays} newDays=${auditNew?.durationDays}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-031 DOCUMENTS/MODIF : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-031 DOCUMENTS/MODIF :', e); process.exit(1) })
