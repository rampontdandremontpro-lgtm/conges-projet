// JUR-019 / JUR-020 — ancienneté Syntec 5.1 : attribution manuelle RH + traçabilité.
// Cible : gestion_conges_gmes_test uniquement (API 3001, flag carryover OFF).
// Démonstration : la RH applique manuellement les jours d'ancienneté via
// POST /leave-balances/:id/correction (mouvement + audit). Aucune attribution automatique.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const TAG = 'ANC' + Date.now().toString(36)
const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`) }
const num = (v) => Number(v)

// Référence Syntec 5.1 : ancienneté révolue au 01/05/2026.
const REF = '2026-05-01'
function fullYearsBetween(hire, ref) {
  const [hy, hm, hd] = hire.split('-').map(Number)
  const [ry, rm, rd] = ref.split('-').map(Number)
  let years = ry - hy
  const passed = rm > hm || (rm === hm && rd >= hd)
  if (!passed) years -= 1
  return Math.max(0, years)
}
function extraDays(hire, ref = REF) {
  const y = fullYearsBetween(hire, ref)
  if (y >= 20) return 4
  if (y >= 15) return 3
  if (y >= 10) return 2
  if (y >= 5) return 1
  return 0
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `ANC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })

  const cases = [
    { key: 'E1', hire: '2021-05-02', label: '4 ans 364 j au 01/05/2026 → 0 j' },
    { key: 'E2', hire: '2021-05-01', label: '5 ans révolus au 01/05/2026 → +1 j' },
    { key: 'E3', hire: '2016-05-01', label: '10 ans → +2 j' },
    { key: 'E4', hire: '2011-05-01', label: '15 ans → +3 j' },
    { key: 'E5', hire: '2006-05-01', label: '20 ans → +4 j' },
    { key: 'E6', hire: '2021-04-30', label: 'anniversaire AVANT le 1er mai → +1 j' },
    { key: 'E7', hire: '2021-05-02', label: 'anniversaire APRÈS le 1er mai → 0 j' },
  ]

  for (const c of cases) {
    const exp = extraDays(c.hire)
    // Créer un collaborateur fictif avec sa date d'embauche.
    const u = (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `ANC-${c.key}`, prenom: 'Recette', email: `anc-${c.key}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: c.hire } })).data
    // Initialiser le compteur N (base 25 j).
    const init = await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: u.id, referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 25, reason: 'Fixture ancienneté' } })
    const balId = init.data?.id
    // Attribution manuelle RH (0 j = aucune correction).
    let corrStatus = null
    if (exp > 0) {
      const corr = await apiRequest(`/leave-balances/${balId}/correction`, { method: 'POST', token: rhToken, body: { days: exp, reason: `Ancienneté Syntec 5.1 — ${fullYearsBetween(c.hire, REF)} ans révolus au ${REF}` } })
      corrStatus = corr.status
    }
    // Lecture du solde.
    const [[bal]] = await conn.query('SELECT available_days, acquired_days FROM leave_balances WHERE id=?', [balId])
    const [mv] = await conn.query("SELECT COUNT(*) c, COALESCE(SUM(days),0) s FROM balance_movements WHERE leave_balance_id=? AND movement_type='CORRECTION_POSITIVE'", [balId])
    const [aud] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE resource_type='LEAVE_BALANCE' AND resource_id=? AND action='RH_BALANCE_CORRECTED'", [balId])
    const ok = (exp > 0 ? corrStatus === 201 : true) && num(bal.available_days) === 25 + exp && num(bal.acquired_days) === 25 + exp && num(mv[0].c) === (exp > 0 ? 2 : 1) && num(mv[0].s) === 25 + exp && num(aud[0].c) === (exp > 0 ? 1 : 0)
    // mv.c : 1 mouvement d'initialisation (CORRECTION_POSITIVE de 25 j) + 1 correction d'ancienneté le cas échéant.
    rec(`JUR-019-${c.key}`, c.label, ok, `expected=+${exp} available=${bal.available_days} acquired=${bal.acquired_days} mv=${mv[0].c}(${mv[0].s}j) audit=${aud[0].c}`)
  }

  // Traçabilité : le motif de la correction est conservé dans le mouvement.
  const [reasonRows] = await conn.query("SELECT reason FROM balance_movements WHERE reason LIKE 'Ancienneté Syntec 5.1%' AND employee_id IN (SELECT id FROM users WHERE email LIKE ?)", [`anc-%.${TAG}@recette.fr`])
  rec('JUR-019-TRACE', 'Motif de correction d’ancienneté conservé dans le mouvement', reasonRows.length === 5, `motifs=${reasonRows.length}`)

  // Absence de double attribution : relecture, aucune nouvelle écriture automatique.
  const [totBefore] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE reason LIKE 'Ancienneté Syntec 5.1%'")
  rec('JUR-019-NODBL', 'Aucune attribution automatique (aucune écriture ajoutée sans acte RH)', num(totBefore[0].c) === 5, `mouvements ancienneté=${totBefore[0].c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT ANCIENNETÉ : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR ANCIENNETÉ :', e); process.exit(1) })
