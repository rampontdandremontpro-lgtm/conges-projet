// JUR-028 — classification métier explicite des types d'absence.
// Seul un type classé ARRET_MALADIE déclenche la restitution. Aucun crédit
// automatique sur simple correspondance de mots (enfant malade, AT/MP, etc.).
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function balAvailable(conn, employeeId) {
  const [[row]] = await conn.query(
    "SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N'",
    [employeeId],
  )
  return num(row?.available_days ?? 0)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'J28K' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `J28K-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const conge = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const mkType = async (name, kind) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })
    if (kind) await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }

  await conn.query("UPDATE settings SET setting_value='true' WHERE setting_key='ARRET_CHEVAUCHEMENT_ENABLED'")

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `J28K-${suffix}`, prenom: 'Recette', email: `j28k-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 25, reason: 'Fixture JUR-028 classification' } })
  const poseConge = (empId) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: conge.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })

  const cases = [
    { label: 'ARRET_MALADIE', kind: 'ARRET_MALADIE', expectDeclare: 201, expectRestore: true },
    { label: 'ENFANT_MALADE', kind: 'ENFANT_MALADE', expectDeclare: 409, expectRestore: false },
    { label: 'AT_MP', kind: 'AT_MP', expectDeclare: 409, expectRestore: false },
    { label: 'NON_MEDICAL', kind: 'NON_MEDICAL', expectDeclare: 409, expectRestore: false },
    { label: 'NON_CLASSIFIE', kind: null, expectDeclare: 409, expectRestore: false },
  ]

  for (const c of cases) {
    const type = await mkType(c.label, c.kind)
    // Garde-fou JUR-028 : un ancien identifiant ne réactive pas la restitution
    // pour un type explicitement reclassé ENFANT_MALADE.
    if (c.label === 'ENFANT_MALADE') {
      await conn.query("UPDATE settings SET setting_value=? WHERE setting_key='ARRET_MALADIE_TYPE_IDS'", [String(type.id)])
    }
    const emp = await mkEmp(c.label.replace(/_/g, ''))
    await initBal(emp.id)
    await poseConge(emp.id)
    const d = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: emp.id, leaveTypeId: type.id, startDate: '2026-02-03', endDate: '2026-02-07' } })
    if (d.status === 201) {
      await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    }
    const after = await balAvailable(conn, emp.id)
    const okDeclare = d.status === c.expectDeclare
    const okRestore = c.expectRestore ? after === 24 : after === 19
    rec(`J28K-${c.label}`, `${c.label} : déclaration ${c.expectDeclare}, restitution ${c.expectRestore ? 'oui' : 'non'}`, okDeclare && okRestore, `http=${d.status} after=${after}`)
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-028 (classification) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.query("DELETE FROM settings WHERE setting_key IN ('ARRET_CHEVAUCHEMENT_ENABLED','ARRET_MALADIE_TYPE_IDS')")
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-028 classification :', e); process.exit(1) })
