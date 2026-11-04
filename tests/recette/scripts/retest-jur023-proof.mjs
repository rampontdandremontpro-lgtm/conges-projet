// JUR-023 — preuve écrite réelle (fichier conservé via le module Documents)
// + blocage des attributions automatiques en cas d'incertitude (JUR-021/022).
import { apiRequest, login, dbConn, config } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function uploadPdf(token, name, content = '%PDF-1.4\nrecette') {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(content, 'utf8')], { type: 'application/pdf' }), name)
  const response = await fetch(`${config.API_URL}/documents/report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await response.json()
  return { status: response.status, data }
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'PF' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `PF-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `PF-${suffix}`, prenom: 'Recette', email: `pf-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId, period, counter, days) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: period, counterType: counter, acquiredDays: days, reason: 'Fixture proof' } })

  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }] } })

  // ── 1. Preuve écrite : fichier réellement conservé ────────────────────────
  const emp = await mkEmp('D')
  await initBal(emp.id, '2025-2026', 'N', 10)

  const bogus = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Demande écrite', documentId: 999999, newDeadline: '2027-09-30' } })
  rec('DOC-BOGUS', 'Document inexistant refusé (400)', bogus.status === 400, `http=${bogus.status}`)

  // Document en base mais sans fichier physique → conservation non vérifiable.
  const [ins] = await conn.query("INSERT INTO documents (document_kind, storage_key, status) VALUES ('JUSTIFICATIF', ?, 'ACCEPTE')", [`proof-missing-${TAG}`])
  const missingFile = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Demande écrite', documentId: ins.insertId, newDeadline: '2027-09-30' } })
  rec('DOC-SANS-FICHIER', 'Preuve sans fichier physique refusée (conservation vérifiée)', missingFile.status === 400 && /fichier physique/i.test(missingFile.data?.message ?? ''), `http=${missingFile.status}`)

  // Document en attente (non validé) → refusé même si un fichier existe.
  const [ins2] = await conn.query("INSERT INTO documents (document_kind, storage_key, status) VALUES ('JUSTIFICATIF', ?, 'EN_ATTENTE')", [`proof-pending-${TAG}`])
  const pendingDoc = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Demande écrite', documentId: ins2.insertId, newDeadline: '2027-09-30' } })
  rec('DOC-NON-VALIDE', 'Preuve non validée (EN_ATTENTE) refusée', pendingDoc.status === 400 && /validé/i.test(pendingDoc.data?.message ?? ''), `http=${pendingDoc.status}`)

  // Parcours réel : la RH joint un justificatif (fichier stocké physiquement).
  const up = await uploadPdf(rhToken, `demande-ecrite-${TAG}.pdf`)
  rec('DOC-UPLOAD', 'Justificatif joint et conservé (fichier physique écrit)', up.status === 201 && up.data?.status === 'ACCEPTE', `http=${up.status} doc=${up.data?.id}`)

  const ok = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp.id, referencePeriod: '2025-2026', justification: 'Demande écrite', documentId: up.data.id, newDeadline: '2027-09-30' } })
  rec('DOC-REEL', 'Report validé avec la preuve conservée', ok.status === 201 && num(ok.data.documentId) === num(up.data.id), `http=${ok.status}`)

  const list = await apiRequest('/leave-balances/take-period/2025-2026/reports', { token: rhToken })
  const item = list.data?.find((r) => r.id === ok.data.id)
  rec('DOC-LIE', 'Report liste la preuve (statut VALIDE + nom de fichier)', item?.proofStatus === 'VALIDE' && item?.document?.originalName === `demande-ecrite-${TAG}.pdf`, `proof=${item?.proofStatus}`)

  // Report sans preuve → « en attente de preuve », jamais validé juridiquement.
  const emp2 = await mkEmp('S')
  await initBal(emp2.id, '2025-2026', 'N', 10)
  const noProof = await apiRequest('/leave-balances/take-period/report', { method: 'POST', token: rhToken, body: { employeeId: emp2.id, referencePeriod: '2025-2026', justification: 'Demande écrite sans justificatif', newDeadline: '2027-09-30' } })
  const list2 = await apiRequest('/leave-balances/take-period/2025-2026/reports', { token: rhToken })
  const noProofItem = list2.data?.find((r) => r.id === noProof.data.id)
  rec('DOC-SANS-PREUVE', 'Report sans justificatif reste en attente de preuve', noProof.status === 201 && noProofItem?.proofStatus === 'EN_ATTENTE_PREUVE', `proof=${noProofItem?.proofStatus}`)

  // Point 4 : un report sans preuve valide n'est PAS appliqué (échéance légale
  // conservée) ; un report avec preuve valide applique sa nouvelle échéance.
  const overview = await apiRequest('/leave-balances/take-period/2025-2026', { token: rhToken })
  const emp2Ov = overview.data?.employees?.find((x) => x.employeeId === emp2.id)
  const empOv = overview.data?.employees?.find((x) => x.employeeId === emp.id)
  rec('DOC-SANS-PREUVE-DEADLINE', 'Report sans preuve : échéance légale conservée (provisoire)', emp2Ov?.reportProofStatus === 'EN_ATTENTE_PREUVE' && emp2Ov?.effectiveDeadline === overview.data?.takePeriod?.end, `deadline=${emp2Ov?.effectiveDeadline}`)
  rec('DOC-PREUVE-DEADLINE', 'Report avec preuve : nouvelle échéance appliquée', empOv?.reportProofStatus === 'VALIDE' && empOv?.effectiveDeadline === '2027-09-30', `deadline=${empOv?.effectiveDeadline}`)

  // Point 2 : justificatif devenu inaccessible (fichier physique disparu) →
  // le report redevient provisoire et l'échéance légale s'applique à nouveau.
  await conn.query('UPDATE documents SET storage_key=? WHERE id=?', [`proof-gone-${TAG}`, up.data.id])
  const overview2 = await apiRequest('/leave-balances/take-period/2025-2026', { token: rhToken })
  const empOv2 = overview2.data?.employees?.find((x) => x.employeeId === emp.id)
  rec('DOC-FICHIER-MANQUANT', 'Justificatif inaccessible : report provisoire (échéance légale)', empOv2?.reportProofStatus === 'EN_ATTENTE_PREUVE' && empOv2?.effectiveDeadline === overview2.data?.takePeriod?.end, `proof=${empOv2?.reportProofStatus} deadline=${empOv2?.effectiveDeadline}`)

  // ── 2. Incertitude → aucune attribution automatique ────────────────────────
  const uc = await mkEmp('U')
  await initBal(uc.id, '2025-2026', 'N', 25)
  await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: uc.id, leaveTypeId: lt.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const before = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const ucBefore = before.data.find((x) => x.employeeId === uc.id)
  rec('UNCERT-AVANT', 'Avant perturbation : bonus +2, aucune incertitude', ucBefore?.bonusDays === 2 && ucBefore?.uncertainRequests === 0, `bonus=${ucBefore?.bonusDays}`)

  await conn.query("INSERT INTO holidays (date, name, holiday_type, deductible, is_active) VALUES ('2026-02-03', 'Fermeture test', 'FERMETURE_GMES', 0, 1)")
  const after = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const ucAfter = after.data.find((x) => x.employeeId === uc.id)
  rec('UNCERT-APRES', 'Reconstitution impossible → signalée, bonus 0', ucAfter?.uncertainRequests === 1 && ucAfter?.bonusDays === 0, `incert=${ucAfter?.uncertainRequests} bonus=${ucAfter?.bonusDays}`)

  const apply = await apiRequest('/leave-balances/fractionnement/apply', { method: 'POST', token: rhToken, body: { referencePeriod: '2025-2026' } })
  const ucSkipped = apply.data?.skipped?.find((x) => x.employeeId === uc.id)
  const [ucMv] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='FRACTIONNEMENT'", [uc.id])
  rec('UNCERT-BLOC', 'Aucune attribution automatique tant que l’incertitude existe', ucSkipped?.reason === 'INCERTITUDE_VERIFICATION_RH' && num(ucMv[0].c) === 0, `skip=${ucSkipped?.reason} mvts=${ucMv[0].c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT PREUVE/INCERTITUDE : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.query("DELETE FROM holidays WHERE name = 'Fermeture test' AND date = '2026-02-03'")
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR PREUVE :', e); process.exit(1) })
