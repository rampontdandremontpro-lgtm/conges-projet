// Priorité 3 — filtrage des entités juridiques pour l'ancienneté.
// Deux entités Syntec fictives ; configuration limitée à une seule ;
// vérifie qu'aucun salarié de l'entité exclue ne reçoit de jours.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'OK ' : 'KO '}${name}${detail ? ' — ' + detail : ''}`) }
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const TAG = 'EF' + Date.now().toString(36)
  const codeA = `ENTA-${TAG}`
  const codeB = `ENTB-${TAG}`

  const [insA] = await conn.query(
    "INSERT INTO legal_entities (code, name, convention_type) VALUES (?, 'Entité A Syntec', 'SYNTEC')",
    [codeA],
  )
  const [insB] = await conn.query(
    "INSERT INTO legal_entities (code, name, convention_type) VALUES (?, 'Entité B Syntec', 'SYNTEC')",
    [codeB],
  )
  const entA = Number(insA.insertId)
  const entB = Number(insB.insertId)

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SVC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const empA = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: `ENTA-${TAG}`, prenom: 'Recette', email: `enta.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2021-05-01', legalEntityId: entA } })).data
  const empB = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: `ENTB-${TAG}`, prenom: 'Recette', email: `entb.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2021-05-01', legalEntityId: entB } })).data

  // Configuration limitée à l'entité A uniquement.
  const cfg = await apiRequest('/leave-balances/seniority-extra/config', { method: 'PUT', token: rh, body: { enabled: true, referenceMonthDay: '05-01', thresholds: [{ minYears: 5, extraDays: 1 }, { minYears: 10, extraDays: 2 }, { minYears: 15, extraDays: 3 }, { minYears: 20, extraDays: 4 }], legalEntityCodes: [codeA] } })
  rec('EF-CONFIG', 'Configuration ancienneté limitée à l’entité A', cfg.status === 200 && (cfg.data?.legalEntityCodes ?? []).includes(codeA.toUpperCase()), `codes=${JSON.stringify(cfg.data?.legalEntityCodes)}`)

  const preview = await apiRequest('/leave-balances/seniority-extra/preview/2026-2027', { token: rh })
  const pA = (preview.data ?? []).find((x) => x.employeeId === empA.id)
  const pB = (preview.data ?? []).find((x) => x.employeeId === empB.id)
  rec('EF-PREVIEW-A', 'Prévisualisation : entité A concernée (+1 j)', pA?.applicable === true && num(pA?.extraDays) === 1, `applicable=${pA?.applicable} extra=${pA?.extraDays}`)
  rec('EF-PREVIEW-B', 'Prévisualisation : entité B exclue (0 j)', pB?.applicable === false && num(pB?.extraDays) === 0 && pB?.skipReason === 'ENTITE_NON_CONCERNEE', `applicable=${pB?.applicable} skip=${pB?.skipReason}`)

  const apply = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const allocA = (apply.data?.allocated ?? []).find((x) => x.employeeId === empA.id)
  const skipB = (apply.data?.skipped ?? []).find((x) => x.employeeId === empB.id)
  rec('EF-APPLY-A', 'Attribution : entité A reçoit +1 j', allocA?.extraDays === 1, `alloc=${JSON.stringify(allocA)}`)
  rec('EF-APPLY-B', 'Attribution : entité B exclue (aucun jour)', skipB?.reason === 'ENTITE_NON_CONCERNEE', `skip=${skipB?.reason}`)

  const [mvA] = await conn.query("SELECT COUNT(*) c, COALESCE(SUM(days),0) s FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [empA.id])
  const [mvB] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [empB.id])
  rec('EF-MOUVEMENTS', 'Mouvements : A = 1 j, B = aucun', num(mvA[0].c) === 1 && num(mvA[0].s) === 1 && num(mvB[0].c) === 0, `A=${mvA[0].c}(${mvA[0].s}j) B=${mvB[0].c}`)

  const apply2 = await apiRequest('/leave-balances/seniority-extra/apply', { method: 'POST', token: rh, body: { referencePeriod: '2026-2027' } })
  const skipA2 = (apply2.data?.skipped ?? []).find((x) => x.employeeId === empA.id)
  const [mvA2] = await conn.query("SELECT COUNT(*) c FROM balance_movements WHERE employee_id=? AND movement_type='SENIORITY_EXTRA'", [empA.id])
  rec('EF-RELANCE', 'Relance : A déjà attribué, aucun double crédit', skipA2?.reason === 'DEJA_ATTRIBUE' && num(mvA2[0].c) === 1, `skip=${skipA2?.reason} mv=${mvA2[0].c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nFILTRAGE ENTITÉS ANCIENNETÉ : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error('ERREUR FILTRAGE ENTITÉS :', e); process.exit(1) })
