// JUR-024 — la convention détermine réellement les règles applicables.
// Deux entreprises configurées différemment ; droits effectivement calculés.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const results = []
const rec = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const conn = await dbConn()
  const adminToken = await login('admin.recette@gmes.fr')
  const rhToken = await login('rh.recette@gmes.fr')
  const TAG = 'J24D' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const effId = ents.find((e) => e.code === 'EFFICIENCE').id

  // GMES = Syntec ; EFFICIENCE = légal confirmé.
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `J24D-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const lt = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `CP-${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })
  const mkEmp = async (suffix, entId) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `J24D-${suffix}`, prenom: 'Recette', email: `j24d-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2014-05-01', legalEntityId: entId } })).data

  await apiRequest('/leave-balances/seniority-extra/config', { method: 'PUT', token: rhToken, body: { enabled: true, referenceMonthDay: '05-01', thresholds: [{ minYears: 5, extraDays: 1 }, { minYears: 10, extraDays: 2 }, { minYears: 15, extraDays: 3 }, { minYears: 20, extraDays: 4 }] } })

  const empG = await mkEmp('G', gmesId)
  const empE = await mkEmp('E', effId)

  // Ancienneté : seule l'entité Syntec est éligible.
  const sr = await apiRequest('/leave-balances/seniority-extra/preview/2025-2026', { token: rhToken })
  const gSr = sr.data.find((x) => x.employeeId === empG.id)
  const eSr = sr.data.find((x) => x.employeeId === empE.id)
  rec('J24D-SR-SYNTEC', 'Ancienneté : GMES (Syntec) éligible +2', gSr?.applicable === true && gSr?.extraDays === 2, `applicable=${gSr?.applicable} days=${gSr?.extraDays}`)
  rec('J24D-SR-LEGAL', 'Ancienneté : EFFICIENCE (légal) non éligible', eSr?.applicable === false && eSr?.extraDays === 0, `applicable=${eSr?.applicable} days=${eSr?.extraDays}`)

  // Fractionnement : régime déterminé par la convention.
  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }, { code: 'EFFICIENCE', regime: 'LEGAL' }] } })
  const fr = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const gFr = fr.data.find((x) => x.employeeId === empG.id)
  const eFr = fr.data.find((x) => x.employeeId === empE.id)
  rec('J24D-FR-SYNTEC', 'Fractionnement : GMES régime Syntec (ouvrés)', gFr?.regime === 'SYNTEC', `regime=${gFr?.regime}`)
  rec('J24D-FR-LEGAL', 'Fractionnement : EFFICIENCE régime légal (ouvrables)', eFr?.regime === 'LEGAL', `regime=${eFr?.regime}`)

  // Contradiction : EFFICIENCE (légal) configurée en SYNTEC → aucun calcul.
  await apiRequest('/leave-balances/fractionnement/config', { method: 'PUT', token: rhToken, body: { eligiblePeriodStart: '05-01', eligiblePeriodEnd: '10-31', entities: [{ code: 'GMES', regime: 'SYNTEC' }, { code: 'EFFICIENCE', regime: 'SYNTEC' }] } })
  const fr2 = await apiRequest('/leave-balances/fractionnement/preview/2025-2026', { token: rhToken })
  const eFr2 = fr2.data.find((x) => x.employeeId === empE.id)
  rec('J24D-CONTRADICTION', 'Configuration contradictoire → aucun calcul auto (EFFICIENCE)', eFr2?.regime === 'NONE', `regime=${eFr2?.regime}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-024 (droits calculés) : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-024 droits :', e); process.exit(1) })
