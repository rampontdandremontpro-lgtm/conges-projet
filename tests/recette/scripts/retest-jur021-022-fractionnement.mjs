// JUR-021 / JUR-022 — fractionnement des congés : attribution manuelle RH + traçabilité.
// Cible : gestion_conges_gmes_test uniquement. Aucun calcul automatique ; démonstration
// du mécanisme existant (correction de solde) + référence des seuils (calcul du script).
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const TAG = 'FRA' + Date.now().toString(36)
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`) }
const num = (v) => Number(v)

// Référence des seuils (calcul de test — PAS une fonction de l'application) :
// Syntec 5.1 (jours OUVRÉS) : 3-4 → +1 ; >=5 → +2.
// L3141-23 (jours OUVRABLES, supplétif) : 3-5 → +1 ; >=6 → +2.
function syntecFraction(eligibleOuvres) {
  if (eligibleOuvres >= 5) return 2
  if (eligibleOuvres >= 3) return 1
  return 0
}
function legalFraction(eligibleOuvrables) {
  if (eligibleOuvrables >= 6) return 2
  if (eligibleOuvrables >= 3) return 1
  return 0
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `FRA-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })

  const mkEmp = async (suffix) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `FRA-${suffix}`, prenom: 'Recette', email: `fra-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2010-01-06' } })).data
  const initBal = (empId) => apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empId, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 25, reason: 'Fixture fractionnement' } })

  // ── Seuils de référence (vérification du calcul de test, pas du code applicatif) ──
  const thresholds = [
    [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 1, 1], [4, 1, 1], [5, 2, 1], [6, 2, 2],
  ]
  const thrOk = thresholds.every(([d, s, l]) => syntecFraction(d) === s && legalFraction(d) === l)
  rec('JUR-021-SEUILS', 'Seuils de référence 0→6 jours (Syntec OUVRÉS / L3141-23 OUVRABLES)', thrOk, '3-4→+1 ; >=5 (Syntec) →+2 ; 3-5→+1 ; >=6 (légal) →+2')

  // ── Attribution manuelle RH (+1 Syntec) ──
  const e1 = await mkEmp('S1')
  const b1 = await initBal(e1.id)
  const c1 = await apiRequest(`/leave-balances/${b1.data.id}/correction`, { method: 'POST', token: rhToken, body: { days: 1, reason: 'Fractionnement Syntec 5.1 — 4 jours ouvrés hors période (01/05-31/10) → +1 jour ouvré' } })
  const [[bal1]] = await conn.query('SELECT available_days FROM leave_balances WHERE id=?', [b1.data.id])
  const [mv1] = await conn.query("SELECT COUNT(*) c, SUM(days) s FROM balance_movements WHERE leave_balance_id=? AND movement_type='CORRECTION_POSITIVE' AND reason LIKE 'Fractionnement%'", [b1.data.id])
  rec('JUR-021-ATTRIB', 'Attribution manuelle +1 jour (Syntec 4 j ouvrés) tracée', c1.status === 201 && num(bal1.available_days) === 26 && num(mv1[0].c) === 1 && num(mv1[0].s) === 1, `http=${c1.status} available=${bal1.available_days} mv=${mv1[0].c}(${mv1[0].s}j)`)

  // ── Attribution manuelle RH (+2 Syntec) ──
  const e2 = await mkEmp('S2')
  const b2 = await initBal(e2.id)
  const c2 = await apiRequest(`/leave-balances/${b2.data.id}/correction`, { method: 'POST', token: rhToken, body: { days: 2, reason: 'Fractionnement Syntec 5.1 — 5 jours ouvrés hors période → +2 jours ouvrés' } })
  const [[bal2]] = await conn.query('SELECT available_days FROM leave_balances WHERE id=?', [b2.data.id])
  const [mv2] = await conn.query("SELECT COUNT(*) c, SUM(days) s FROM balance_movements WHERE leave_balance_id=? AND movement_type='CORRECTION_POSITIVE' AND reason LIKE 'Fractionnement%'", [b2.data.id])
  rec('JUR-021-ATTRIB2', 'Attribution manuelle +2 jours (Syntec >=5 j ouvrés) tracée', c2.status === 201 && num(bal2.available_days) === 27 && num(mv2[0].c) === 1 && num(mv2[0].s) === 2, `http=${c2.status} available=${bal2.available_days} mv=${mv2[0].c}(${mv2[0].s}j)`)

  // ── Régime légal supplétif L3141-23 (+1 pour 3-5 j ouvrables) ──
  const e3 = await mkEmp('L1')
  const b3 = await initBal(e3.id)
  const c3 = await apiRequest(`/leave-balances/${b3.data.id}/correction`, { method: 'POST', token: rhToken, body: { days: 1, reason: 'Fractionnement L3141-23 (supplétif) — 4 jours ouvrables hors période → +1 jour ouvrable' } })
  const [[bal3]] = await conn.query('SELECT available_days FROM leave_balances WHERE id=?', [b3.data.id])
  rec('JUR-022-ATTRIB', 'Attribution manuelle +1 jour (L3141-23, 4 j ouvrables) tracée', c3.status === 201 && num(bal3.available_days) === 26, `http=${c3.status} available=${bal3.available_days}`)

  // ── Ajustement / annulation : correction négative tracée ──
  const neg = await apiRequest(`/leave-balances/${b1.data.id}/correction`, { method: 'POST', token: rhToken, body: { days: -1, reason: 'Ajustement fractionnement : annulation d’un congé hors période' } })
  const [[bal1b]] = await conn.query('SELECT available_days FROM leave_balances WHERE id=?', [b1.data.id])
  const [mv1b] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE leave_balance_id=? AND movement_type='CORRECTION_NEGATIVE' AND reason LIKE 'Ajustement fractionnement%'", [b1.data.id])
  rec('JUR-021-AJUST', 'Ajustement après annulation : correction négative tracée (aucun lien automatique)', neg.status === 201 && num(bal1b.available_days) === 25 && num(mv1b[0].c) === 1, `http=${neg.status} available=${bal1b.available_days} mv=${mv1b[0].c}`)

  // ── Traçabilité globale + absence de double attribution ──
  const [tot] = await conn.query("SELECT COUNT(*) c, SUM(days) s FROM balance_movements WHERE reason LIKE 'Fractionnement%' OR reason LIKE 'Ajustement fractionnement%'")
  rec('JUR-021-TRACE', 'Motifs de fractionnement conservés (aucune écriture automatique)', num(tot[0].c) === 4, `mouvements=${tot[0].c} (somme abs=${tot[0].s})`)

  // ── La RH peut voir les dates de congés (pour déterminer « hors période ») ──
  const d = await apiRequest('/leave-requests/rh/direct', { method: 'POST', token: rhToken, body: { employeeId: e1.id, leaveTypeId: lt.data.id, startDate: '2026-02-09', endDate: '2026-02-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })
  const mgmt = await apiRequest('/leave-requests/management/all', { token: rhToken })
  const items = Array.isArray(mgmt.data) ? mgmt.data : []
  const own = items.find((x) => x.employeeId === e1.id)
  rec('JUR-021-VISU', 'RH peut consulter les congés (dates + jours décomptés) pour déterminer le fractionnement', d.status === 201 && own && own.startDate === '2026-02-09' && num(own.deductedDays) === 3, `req=${d.status} visible=${Boolean(own)} start=${own?.startDate} ded=${own?.deductedDays}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT FRACTIONNEMENT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR FRACTIONNEMENT :', e); process.exit(1) })
