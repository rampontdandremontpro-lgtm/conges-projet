// JUR-028 — interaction arrêt maladie / congés déjà posés.
// Restitution automatique (configurable, idempotente) des jours de congé
// couverts par un arrêt maladie, et inversion à l'annulation de l'arrêt.
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
  const TAG = 'J28' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `J28-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const conge = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const maladie = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })
  await apiRequest(`/leave-types/${maladie.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `J28-${suffix}`, prenom: 'Recette', email: `j28-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId, days) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: days, reason: 'Fixture JUR-028' } })

  // ── 0. Désactivé + non configuré : arrêt maladie reconnu par le nom ──
  //     (déclaration possible, aucune restitution automatique, signalement).
  const emp0 = await mkEmp('X')
  await initBal(emp0.id, 25)
  await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: emp0.id, leaveTypeId: conge.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const d0 = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: emp0.id, leaveTypeId: maladie.data.id, startDate: '2026-02-03', endDate: '2026-02-07' } })
  const sub0 = await apiRequest(`/absence-declarations/${d0.data?.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
  const [mv0] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE movement_type='ARRET_RESTITUTION' AND employee_id=?", [emp0.id])
  rec('J28-OFF', 'Désactivé/non configuré : arrêt déclaré (201), aucune restitution', d0.status === 201 && sub0.data?.status === 'ENREGISTREE' && num(mv0[0]?.c ?? 0) === 0, `http=${d0.status} mvts=${mv0[0]?.c}`)

  // ── 1. Activation + restitution sur chevauchement ─────────────────────────
  await conn.query("INSERT INTO settings (setting_key, setting_value) VALUES ('ARRET_CHEVAUCHEMENT_ENABLED', 'true'), ('ARRET_MALADIE_TYPE_IDS', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [String(maladie.data.id)])

  const emp = await mkEmp('A')
  await initBal(emp.id, 25)
  const before = await balAvailable(conn, emp.id)
  await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: emp.id, leaveTypeId: conge.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const afterConge = await balAvailable(conn, emp.id)
  // Règle GMES : congé lun→ven = 6 jours décomptés (samedi inclus).
  rec('J28-CONGE', 'Congé posé déduit (25 → 19)', before === 25 && afterConge === 19, `before=${before} after=${afterConge}`)

  const d = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: emp.id, leaveTypeId: maladie.data.id, startDate: '2026-02-03', endDate: '2026-02-07' } })
  rec('J28-DRAFT', 'Arrêt maladie autorisé malgré le chevauchement (201)', d.status === 201, `http=${d.status}`)
  const sub = await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
  rec('J28-ARRET', 'Arrêt maladie enregistré (ENREGISTREE)', sub.data?.status === 'ENREGISTREE', `status=${sub.data?.status}`)

  const afterArret = await balAvailable(conn, emp.id)
  const preview = await apiRequest(`/leave-balances/arret-chevauchement/${d.data.id}`, { token: rhToken })
  const overlap = preview.data?.overlaps?.[0]
  // Chevauchement : jours décomptés 2,3,4,5,6,7 ∩ arrêt 3..7 = 3,4,5,6,7 = 5 jours.
  rec('J28-RESTORE', 'Jours chevauchés restitués (19 → 24)', afterArret === 24 && overlap?.alreadyRestored === true, `after=${afterArret} already=${overlap?.alreadyRestored}`)
  rec('J28-DETAIL', 'Chevauchement daté identifié (congé lié)', overlap?.leaveRequestId != null && overlap?.overlapDays === 5 && overlap?.uncertain === false, `overlap=${overlap?.overlapDays}`)

  const [mv] = await conn.query("SELECT days FROM balance_movements WHERE movement_type='ARRET_RESTITUTION' AND employee_id=? ORDER BY id", [emp.id])
  rec('J28-MOUVEMENT', 'Mouvement ARRET_RESTITUTION tracé (+5)', mv.length === 1 && num(mv[0].days) === 5, `days=${mv[0]?.days}`)
  const [track] = await conn.query("SELECT days, reversed_at FROM leave_arrete_restaurations WHERE absence_declaration_id=?", [d.data.id])
  rec('J28-TRACE', 'Trace idempotente enregistrée', track.length === 1 && num(track[0].days) === 5 && track[0].reversed_at === null, `rows=${track.length}`)

  // ── 2. Idempotence : relance → aucun doublon ──────────────────────────────
  const re = await apiRequest(`/leave-balances/arret-chevauchement/${d.data.id}/restore`, { method: 'POST', token: rhToken })
  const afterIdem = await balAvailable(conn, emp.id)
  const [mv2] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE movement_type='ARRET_RESTITUTION' AND employee_id=?", [emp.id])
  rec('J28-IDEM', 'Relance idempotente (aucun double crédit)', re.data?.restoredDays === 0 && afterIdem === 24 && num(mv2[0].c) === 1, `restored=${re.data?.restoredDays} after=${afterIdem}`)

  // ── 3. Annulation de l'arrêt → inversion ─────────────────────────────────
  await apiRequest(`/absence-declarations/${d.data.id}/cancel`, { method: 'POST', token: rhToken })
  const afterCancel = await balAvailable(conn, emp.id)
  const [mv3] = await conn.query("SELECT days FROM balance_movements WHERE movement_type='ARRET_RESTITUTION' AND employee_id=? ORDER BY id", [emp.id])
  const [track2] = await conn.query("SELECT reversed_at FROM leave_arrete_restaurations WHERE absence_declaration_id=?", [d.data.id])
  rec('J28-REVERSE', 'Annulation → restitution inversée (24 → 19)', afterCancel === 19 && mv3.length === 2 && num(mv3[1].days) === -5, `after=${afterCancel} mvts=${mv3.length}`)
  rec('J28-REVERSE-TRACE', 'Trace de restitution marquée inversée', track2[0]?.reversed_at != null, `reversed=${track2[0]?.reversed_at != null}`)

  // ── 4. Type non maladie → aucune restitution ─────────────────────────────
  const emp2 = await mkEmp('B')
  await initBal(emp2.id, 25)
  await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: emp2.id, leaveTypeId: conge.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const autre = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Autre-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })
  const d2 = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: emp2.id, leaveTypeId: autre.data.id, startDate: '2026-02-03', endDate: '2026-02-07' } })
  rec('J28-NON-MALADIE-REFUS', 'Type non maladie : chevauchement toujours refusé (409)', d2.status === 409, `http=${d2.status}`)
  const after2 = await balAvailable(conn, emp2.id)
  rec('J28-NON-MALADIE', 'Type non maladie : aucune restitution', after2 === 19, `after=${after2}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-028 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.query("DELETE FROM settings WHERE setting_key IN ('ARRET_CHEVAUCHEMENT_ENABLED','ARRET_MALADIE_TYPE_IDS')")
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-028 :', e); process.exit(1) })
