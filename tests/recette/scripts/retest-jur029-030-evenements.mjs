// JUR-029 / JUR-030 — congés pour événements familiaux (valeurs corrigées).
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
  const TAG = 'J29B' + Date.now().toString(36)

  const [ents] = await conn.query('SELECT id, code FROM legal_entities')
  const gmesId = ents.find((e) => e.code === 'GMES').id
  const effId = ents.find((e) => e.code === 'EFFICIENCE').id
  await apiRequest(`/legal-entities/${gmesId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'SYNTEC', idcc: '1486' } })
  await apiRequest(`/legal-entities/${effId}/convention`, { method: 'PATCH', token: rhToken, body: { conventionType: 'LEGAL' } })

  const svc = await apiRequest('/services', { method: 'POST', token: adminToken, body: { name: `J29B-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })
  const mkEmp = async (suffix, entId) => (await apiRequest('/users', { method: 'POST', token: adminToken, body: { nom: `J29B-${suffix}`, prenom: 'Recette', email: `j29b-${suffix}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.data.id, hireDate: '2015-05-01', legalEntityId: entId } })).data

  const mkEventType = async (name, kind, documentRequired = true) => {
    const t = await apiRequest('/leave-types', { method: 'POST', token: adminToken, body: { name: `${name}-${TAG}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired, documentCanBeAddedLater: true, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false } })
    await apiRequest(`/leave-types/${t.data.id}/absence-kind`, { method: 'PATCH', token: rhToken, body: { absenceKind: kind } })
    return t.data
  }

  const mariage = await mkEventType('Mariage', 'MARIAGE_PACS', true)
  const decesEnfant = await mkEventType('Deces enfant', 'DECES_ENFANT', true)
  const deuil = await mkEventType('Deuil enfant', 'DEUIL_ENFANT', true)
  const annonce = await mkEventType('Annonce handicap', 'ANNONCE_HANDICAP_ENFANT', true)
  const enfantMalade = await mkEventType('Enfant malade', 'ENFANT_MALADE', true)

  const empG = await mkEmp('G', gmesId) // Syntec
  const empE = await mkEmp('E', effId) // légal

  const rule = (typeId, date, empId, qs = '') => apiRequest(`/leave-types/${typeId}/family-event-rule?date=${date}&employeeId=${empId}${qs}`, { token: rhToken }).then((r) => r.data)

  // ── Durées corrigées ──────────────────────────────────────────────────────
  const mariageG = await rule(mariage.id, '2026-10-01', empG.id)
  rec('J29-MARIAGE-SYNTEC', 'Mariage (Syntec) : 4 jours ouvrés (pas 5)', mariageG?.days === 4 && mariageG?.unit === 'OUVRES', `days=${mariageG?.days} unit=${mariageG?.unit}`)

  const mariageE = await rule(mariage.id, '2026-10-01', empE.id)
  rec('J29-MARIAGE-LEGAL', 'Mariage (légal) : 4 jours ouvrables', mariageE?.days === 4 && mariageE?.unit === 'OUVRABLES', `days=${mariageE?.days}`)

  const annB = await rule(annonce.id, '2026-06-13', empG.id)
  rec('J29-ANNONCE-AVANT', 'Annonce handicap < 14/06/2026 : 5 jours ouvrables', annB?.days === 5 && annB?.unit === 'OUVRABLES', `days=${annB?.days}`)
  const annA = await rule(annonce.id, '2026-06-14', empG.id)
  rec('J29-ANNONCE-APRES', 'Annonce handicap ≥ 14/06/2026 : 10 jours ouvrables', annA?.days === 10 && annA?.unit === 'OUVRABLES', `days=${annA?.days}`)

  const decJeune = await rule(decesEnfant.id, '2026-10-01', empG.id, '&enfantAge=10')
  rec('J29-DECES-ENFANT-JEUNE', 'Décès enfant < 25 ans : 14 jours ouvrables', decJeune?.days === 14, `days=${decJeune?.days}`)
  const decAge = await rule(decesEnfant.id, '2026-10-01', empG.id, '&enfantAge=30')
  rec('J29-DECES-ENFANT-AGE', 'Décès enfant ≥ 25 ans : 12 jours ouvrables', decAge?.days === 12, `days=${decAge?.days}`)

  const deuilR = await rule(deuil.id, '2026-10-01', empG.id)
  rec('J29-DEUIL', 'Congé de deuil : 8 jours ouvrables distincts', deuilR?.days === 8 && deuilR?.reference === 'L3142-1-1', `days=${deuilR?.days}`)

  const em3 = await rule(enfantMalade.id, '2026-10-01', empG.id, '&enfantAge=5')
  rec('J29-ENFANT-MALADE-3', 'Enfant malade ≥ 1 an : 3 jours, non rémunéré', em3?.days === 3 && em3?.paid === false, `days=${em3?.days} paid=${em3?.paid}`)
  const em5 = await rule(enfantMalade.id, '2026-10-01', empG.id, '&enfantAge=0')
  rec('J29-ENFANT-MALADE-5', 'Enfant malade < 1 an : 5 jours, non rémunéré', em5?.days === 5 && em5?.paid === false, `days=${em5?.days}`)

  // ── Sécurité : le collaborateur consulte SES règles, pas celles d'un autre ─
  const colRule = await apiRequest(`/leave-types/${mariage.id}/family-event-rule?date=2026-10-01&employeeId=${empG.id}`, { token: colToken })
  rec('J29-SECURITE', 'Collaborateur : employeeId ignoré (identité de session)', colRule.data?.kind === 'MARIAGE_PACS', `http=${colRule.status}`)

  const badDate = await apiRequest(`/leave-types/${mariage.id}/family-event-rule?date=abc&employeeId=${empG.id}`, { token: rhToken })
  rec('J29-DATE-INVALIDE', 'Date invalide refusée (400)', badDate.status === 400, `http=${badDate.status}`)

  // ── Absence non débitée des congés payés ──────────────────────────────────
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: empG.id, referencePeriod: '2025-2026', counterType: 'N', acquiredDays: 25, reason: 'Fixture JUR-029' } })
  const d = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empG.id, leaveTypeId: mariage.id, startDate: '2026-10-01', endDate: '2026-10-04' } })
  const [[bal]] = await conn.query("SELECT available_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N'", [empG.id])
  rec('J29-NON-DEBIT', 'Événement familial non débité des congés payés (25 → 25)', d.status === 201 && Number(bal?.available_days ?? 0) === 25, `http=${d.status} avail=${bal?.available_days}`)

  // ── Dépassement des droits (backend, non contournable) ───────────────────
  // Mariage Syntec = 4 jours OUVRÉS. Du lundi 05/10 au vendredi 09/10 = 5 ouvrés.
  const over = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empG.id, leaveTypeId: mariage.id, startDate: '2026-10-05', endDate: '2026-10-09', familyEventContext: { eventDate: '2026-10-01' } } })
  rec('J29-DEPASSEMENT', 'Dépassement des droits refusé (400)', over.status === 400 && /Dépassement/i.test(over.data?.message ?? ''), `http=${over.status}`)

  // ── Contexte d'événement persisté ─────────────────────────────────────────
  const withCtx = await apiRequest('/absence-declarations', { method: 'POST', token: rhToken, body: { employeeId: empG.id, leaveTypeId: decesEnfant.id, startDate: '2026-10-05', endDate: '2026-10-08', familyEventContext: { eventDate: '2026-10-01', enfantAge: 10 } } })
  rec('J29-CONTEXTE', 'Contexte familial persisté', withCtx.status === 201, `http=${withCtx.status}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT JUR-029/030 : ${results.length - failed}/${results.length} OK, ${failed} KO`)
  await conn.end()
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error('ERREUR JUR-029/030 :', e); process.exit(1) })
