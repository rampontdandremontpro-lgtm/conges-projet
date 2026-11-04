// JUR-028 — sécurisation fonctionnelle :
//  - compteurs après restitution (acquis inchangés, disponibles restaurés) ;
//  - cohérence transactionnelle, idempotence/concurrence, arrêts multiples,
//    restitution partielle, contrôle du statut avant inversion ;
//  - déclaration d'arrêt maladie possible même si l'automatisation est
//    désactivée (signalement RH au lieu d'un refus systématique).
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}
const num = (v) => Number(v)

async function balance(conn, employeeId) {
  const [[row]] = await conn.query(
    "SELECT acquired_days, available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N'",
    [employeeId],
  )
  return { acquired: num(row?.acquired_days ?? 0), available: num(row?.available_days ?? 0) }
}

async function netMovements(conn, employeeId, type) {
  const [[row]] = await conn.query(
    'SELECT COALESCE(SUM(days),0) total FROM balance_movements WHERE employee_id=? AND movement_type=?',
    [employeeId, type],
  )
  return num(row?.total ?? 0)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'J28B' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `J28B-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const conge = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const maladie = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `Maladie-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })
  await apiRequest(`/leave-types/${maladie.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: 'ARRET_MALADIE' } })

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `J28B-${suffix}`, prenom: 'Recette', email: `j28b-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: gmesId } })).data
  const initBal = (empId) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 25, reason: 'Fixture JUR-028' } })
  const poseConge = (empId) => apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: conge.data.id, startDate: '2026-02-02', endDate: '2026-02-06', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', classification: 'MAIN' } })
  const declare = async (empId, start, end) => {
    const d = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empId, leaveTypeId: maladie.data.id, startDate: start, endDate: end } })
    if (d.status !== 201) return { draftStatus: d.status }
    const sub = await apiRequest(`/absence-declarations/${d.data.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })
    return { id: d.data.id, draftStatus: d.status, status: sub.data?.status }
  }

  // Maladie type configuré dès le départ ; automatisation désactivée.
  await conn.query("INSERT INTO settings (setting_key, setting_value) VALUES ('ARRET_CHEVAUCHEMENT_ENABLED', 'false'), ('ARRET_MALADIE_TYPE_IDS', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [String(maladie.data.id)])

  // ── A. Désactivé : déclaration possible + signalement, aucune restitution ──
  const empA = await mkEmp('A')
  await initBal(empA.id)
  await poseConge(empA.id)
  const a = await declare(empA.id, '2026-02-03', '2026-02-07')
  const balA = await balance(conn, empA.id)
  const [[notifA]] = await conn.query("SELECT COUNT(*) c FROM notifications WHERE type='ARRET_CHEVAUCHEMENT_REGULARISATION' AND absence_declaration_id=?", [a.id])
  rec('J28-DISABLED-DRAFT', 'Désactivé : arrêt maladie déclaré malgré chevauchement (201)', a.draftStatus === 201 && a.status === 'ENREGISTREE', `draft=${a.draftStatus}`)
  rec('J28-DISABLED-NO-RESTORE', 'Désactivé : aucune restitution (19 disponibles)', balA.available === 19 && balA.acquired === 25, `avail=${balA.available} acquired=${balA.acquired}`)
  rec('J28-DISABLED-SIGNAL', 'Désactivé : signalement RH émis', num(notifA?.c ?? 0) >= 1, `notifs=${notifA?.c}`)

  // ── B. Activé : compteurs corrects (acquis inchangés) ─────────────────────
  await conn.query("UPDATE settings SET setting_value='true' WHERE setting_key='ARRET_CHEVAUCHEMENT_ENABLED'")

  const empB = await mkEmp('B')
  await initBal(empB.id)
  await poseConge(empB.id)
  const b = await declare(empB.id, '2026-02-03', '2026-02-07') // chevauchement 5 jours
  const balB = await balance(conn, empB.id)
  const netB = await netMovements(conn, empB.id, 'ARRET_RESTITUTION')
  const deductB = await netMovements(conn, empB.id, 'DEDUCTION')
  rec('J28-COUNTERS', '25 acquis / 24 disponibles / +5 restitués (net consommé 1)', balB.acquired === 25 && balB.available === 24 && netB === 5 && deductB === 6, `acq=${balB.acquired} avail=${balB.available} rest=${netB} ded=${deductB}`)

  // Inversion refusée tant que l'arrêt est valide.
  const revValid = await apiRequest(`/leave-balances/arret-chevauchement/${b.id}/reverse`, { method: 'POST', token: rhToken })
  rec('J28-REVERSE-GUARD', 'Inversion refusée sur arrêt encore valide (400)', revValid.status === 400, `http=${revValid.status}`)

  // Annulation → inversion automatique (disponibles restaurés puis re-déduits).
  await apiRequest(`/absence-declarations/${b.id}/cancel`, { method: 'POST', token: rhToken })
  const balB2 = await balance(conn, empB.id)
  const netB2 = await netMovements(conn, empB.id, 'ARRET_RESTITUTION')
  rec('J28-CANCEL', 'Annulation : inversion (24 → 19, acquis 25, net restitution 0)', balB2.available === 19 && balB2.acquired === 25 && netB2 === 0, `avail=${balB2.available} acq=${balB2.acquired} net=${netB2}`)

  // ── C. Restitution partielle + arrêts multiples sur le même congé ─────────
  const empC = await mkEmp('C')
  await initBal(empC.id)
  await poseConge(empC.id)
  const c1 = await declare(empC.id, '2026-02-03', '2026-02-04') // jours 3,4 → 2 jours
  const balC1 = await balance(conn, empC.id)
  rec('J28-PARTIAL', 'Restitution partielle (2 jours sur 6)', balC1.available === 21 && balC1.acquired === 25, `avail=${balC1.available} acq=${balC1.acquired}`)

  const c2 = await declare(empC.id, '2026-02-05', '2026-02-06') // jours 5,6 → 2 jours
  const balC2 = await balance(conn, empC.id)
  const netC = await netMovements(conn, empC.id, 'ARRET_RESTITUTION')
  rec('J28-MULTI', 'Arrêts multiples : cumul 4 jours ≤ 6, acquis 25', balC2.available === 23 && balC2.acquired === 25 && netC === 4, `avail=${balC2.available} net=${netC}`)

  // Concurrence : deux restaurations simultanées → une seule écriture.
  await Promise.all([
    apiRequest(`/leave-balances/arret-chevauchement/${c1.id}/restore`, { method: 'POST', token: rhToken }),
    apiRequest(`/leave-balances/arret-chevauchement/${c1.id}/restore`, { method: 'POST', token: rhToken }),
  ])
  const netC2 = await netMovements(conn, empC.id, 'ARRET_RESTITUTION')
  const balC3 = await balance(conn, empC.id)
  rec('J28-CONCURRENCE', 'Concurrence : aucune double restitution', netC2 === 4 && balC3.available === 23, `net=${netC2} avail=${balC3.available}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-028 (sécurisation) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.query("DELETE FROM settings WHERE setting_key IN ('ARRET_CHEVAUCHEMENT_ENABLED','ARRET_MALADIE_TYPE_IDS')")
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-028 sécurisation :', e); process.exit(1) })
