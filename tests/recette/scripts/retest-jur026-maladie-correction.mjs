// Retest JUR-026 — arrêt maladie non professionnelle : ajustement manuel RH.
// L'application crédite automatiquement 2,5 jours ouvrables/mois ; en cas
// d'arrêt maladie, la RH examine les jours d'arrêt et applique une correction
// manuelle sur le compteur. Aucun calcul automatique de réduction n'est requis.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'JUR026' + Date.now().toString(36)
const MONTH = '2025-06'
const PERIOD = '2025-2026'

const rh = await login('rh.recette@gmes.fr')
if (!rh) throw new Error('Connexion RH impossible')
const admin = await login('admin.recette@gmes.fr')
if (!admin) throw new Error('Connexion ADMIN impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const svc = (await apiRequest('/services', {
  method: 'POST', token: admin,
  body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
})).data

const created = await apiRequest('/users', {
  method: 'POST', token: rh,
  body: {
    nom: 'MALADIE-NP', prenom: 'Exemple', email: `maladie.np.${TAG}@recette.fr`,
    role: 'COLLABORATEUR', employmentType: 'INTERNE',
    hireDate: '2025-01-06', serviceId: svc.id,
  },
})
if (created.status !== 201 && created.status !== 200) {
  throw new Error(`createUser HTTP ${created.status} ${JSON.stringify(created.data)}`)
}
const emp = created.data

// 1. Acquisition mensuelle automatique de juin 2025.
const accr = await apiRequest('/leave-balances/accrual/run', {
  method: 'POST', token: rh, body: { accrualMonth: MONTH },
})
rec('acquisition mensuelle 2025-06 exécutée', accr.status === 201 || accr.status === 200,
  `HTTP ${accr.status}`)

async function balance() {
  const r = await apiRequest(
    `/leave-balances/employee/${emp.id}?referencePeriod=${PERIOD}&counterType=N`,
    { token: rh },
  )
  return r.data?.[0] ?? null
}

const b0 = await balance()
rec('après acquisition : acquiredDays = 2,5 (crédit automatique)',
  Number(b0?.acquiredDays) === 2.5, `acquiredDays=${b0?.acquiredDays}`)
rec('après acquisition : availableDays = 2,5',
  Number(b0?.availableDays) === 2.5, `availableDays=${b0?.availableDays}`)

// 2. Correction RH manuelle : -0,5 jour pour un mois complet d'arrêt maladie
//    non professionnelle (L3141-5-1 : 2 jours ouvrables/mois au lieu de 2,5).
const corr = await apiRequest(`/leave-balances/${b0.id}/correction`, {
  method: 'POST', token: rh,
  body: {
    days: -0.5,
    reason: `Arrêt maladie non professionnelle ${MONTH} — mois complet (L3141-5-1 : 2 j/mois au lieu de 2,5)`,
    notifyEmployee: false,
  },
})
rec('correction RH -0,5 acceptée', corr.status === 201 || corr.status === 200,
  `HTTP ${corr.status}`)

const b1 = await balance()
rec('après correction : acquiredDays = 2 (2 jours/mois)',
  Number(b1?.acquiredDays) === 2, `acquiredDays=${b1?.acquiredDays}`)
rec('après correction : availableDays = 2',
  Number(b1?.availableDays) === 2, `availableDays=${b1?.availableDays}`)

// 3. Historisation du mouvement (motif, auteur, montant, type).
const hist = await apiRequest(
  `/leave-balances/employee/${emp.id}/history?referencePeriod=${PERIOD}`,
  { token: rh },
)
const moves = hist.data ?? []
const corrMove = moves.find((m) =>
  String(m.movementType ?? '').startsWith('CORRECTION_NEGATIVE') &&
  String(m.reason ?? '').includes('L3141-5-1'))
rec('mouvement CORRECTION_NEGATIVE historisé', Boolean(corrMove),
  `movementType=${corrMove?.movementType}`)
rec('montant du mouvement = 0,5', Number(corrMove?.days) === 0.5,
  `days=${corrMove?.days}`)
rec('motif enregistré (raison contient « L3141-5-1 »)',
  String(corrMove?.reason ?? '').includes('L3141-5-1'), 'reason présent')
rec('auteur enregistré (actorId renseigné)', Number(corrMove?.actorId ?? 0) > 0,
  `actorId=${corrMove?.actorId}`)
rec('balance_before/after cohérents (2,5 → 2)',
  Number(corrMove?.balanceBefore) === 2.5 && Number(corrMove?.balanceAfter) === 2,
  `before=${corrMove?.balanceBefore} after=${corrMove?.balanceAfter}`)

// 4. Audit RH_BALANCE_CORRECTED en base (traçabilité).
const conn = await mysql.createConnection({
  host: 'localhost', port: 3306, user: 'root', password: 'root',
  database: 'gestion_conges_gmes_test',
})
try {
  const [audits] = await conn.query(
    `SELECT action, actor_id, JSON_EXTRACT(new_value, '$.reason') AS reason, JSON_EXTRACT(new_value, '$.correctionDays') AS days
       FROM audit_logs
      WHERE action = 'RH_BALANCE_CORRECTED' AND resource_id = ?
      ORDER BY id DESC LIMIT 1`,
    [b0.id],
  )
  rec('audit RH_BALANCE_CORRECTED enregistré', audits.length === 1,
    audits.length ? `actor=${audits[0].actor_id} days=${audits[0].days}` : 'aucun')
} finally {
  await conn.end()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
