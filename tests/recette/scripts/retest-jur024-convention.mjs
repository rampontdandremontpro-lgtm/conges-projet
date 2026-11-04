// JUR-024 — convention collective par entité juridique.
// Aucune convention n'est présumée (défaut AUCUN) ; la RH identifie
// explicitement la convention applicable (Syntec / accord d'entreprise).
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
  const colToken = await login('col-a.recette@gmes.fr')

  const list = await apiRequest('/legal-entities', { token: rhToken })
  const gmes = list.data.find((e) => e.code === 'GMES')
  const eff = list.data.find((e) => e.code === 'EFFICIENCE')

  rec('J24-DEFAULT', 'Défaut : aucune convention présumée (NON_RENSEIGNEE)', gmes?.conventionType === 'NON_RENSEIGNEE' && gmes?.idcc === null && gmes?.conventionName === null, `type=${gmes?.conventionType}`)

  const syn = await apiRequest(`/legal-entities/${gmes.id}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486', conventionName: 'Syntec 5.1' } })
  rec('J24-SYNTEC', 'Syntec enregistré (IDCC 1486, nom)', syn.status === 200 && syn.data?.conventionType === 'SYNTEC' && syn.data?.idcc === '1486', `http=${syn.status}`)

  const acc = await apiRequest(`/legal-entities/${eff.id}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', accordType: 'ACCORD_ENTREPRISE', accordName: 'Accord GMES Efficience 2026' } })
  rec('J24-ACCORD', 'Accord séparé de la branche (SYNTEC + accord coexistent)', acc.status === 200 && acc.data?.conventionType === 'SYNTEC' && acc.data?.accordType === 'ACCORD_ENTREPRISE' && acc.data?.accordName === 'Accord GMES Efficience 2026', `http=${acc.status}`)

  const legal = await apiRequest(`/legal-entities/${eff.id}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })
  rec('J24-LEGAL', 'Régime légal confirmé (distinct de NON_RENSEIGNEE)', legal.status === 200 && legal.data?.conventionType === 'LEGAL', `http=${legal.status}`)

  const back = await apiRequest(`/legal-entities/${gmes.id}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'NON_RENSEIGNEE', accordType: 'NONE' } })
  rec('J24-RESET', 'Retour à NON_RENSEIGNEE (aucune convention)', back.status === 200 && back.data?.conventionType === 'NON_RENSEIGNEE' && back.data?.idcc === null && back.data?.accordType === 'NONE', `type=${back.data?.conventionType}`)

  const bad = await apiRequest(`/legal-entities/${gmes.id}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'XYZ' } })
  rec('J24-INVALID', 'Valeur de convention invalide refusée (400)', bad.status === 400, `http=${bad.status}`)

  const forbidden = await apiRequest(`/legal-entities/${gmes.id}/convention`, { method: 'PATCH', token: colToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  rec('J24-ROLE', 'Non-RH refusé (403)', forbidden.status === 403, `http=${forbidden.status}`)

  const [[audit]] = await conn.query("SELECT COUNT(*) c FROM audit_logs WHERE action='LEGAL_ENTITY_CONVENTION_UPDATED'")
  rec('J24-AUDIT', 'Modification tracée (audit)', Number(audit?.c ?? 0) >= 4, `audits=${audit?.c}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-024 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-024 :', e); process.exit(1) })
