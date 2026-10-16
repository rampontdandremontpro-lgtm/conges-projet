// Retest — cas complémentaires arrondi L3141-7 vs transfert GMES.
// Période 2023-2024, embauche 16/07/2023 → base acquise 26,29 jours ouvrables.
// Vérifie : consommation (0,5 / 10 j), correction RH (+3 / -5), solde négatif,
// réservation bloquant la clôture, et absence de double attribution.
import mysql from 'mysql2/promise'

import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'L3141C' + Date.now().toString(36)
const PERIOD = '2023-2024'
const NEXT = '2024-2025'

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
if (!rh || !admin) throw new Error('Connexion impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function sqlRun(fn) {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'root',
    database: 'gestion_conges_gmes_test',
  })
  try { return await fn(conn) } finally { await conn.end() }
}

const svc = (await apiRequest('/services', {
  method: 'POST', token: admin,
  body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
})).data

async function createUser(suffix) {
  const r = await apiRequest('/users', {
    method: 'POST', token: rh,
    body: {
      nom: 'CAS', prenom: suffix, email: `cas.${suffix}.${TAG}@recette.fr`,
      role: 'COLLABORATEUR', employmentType: 'INTERNE',
      hireDate: '2023-07-16', serviceId: svc.id,
    },
  })
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`createUser ${suffix} HTTP ${r.status} ${JSON.stringify(r.data)}`)
  }
  return r.data
}

const u05 = await createUser('c05')
const u10 = await createUser('c10')
const upos = await createUser('pos')
const uneg = await createUser('neg')
const uover = await createUser('over')
const uresv = await createUser('resv')

// Acquisition réelle 2023-06 → 2024-05.
const months = []
for (let y = 2023; y <= 2024; y++) {
  const lo = y === 2023 ? 6 : 1
  const hi = y === 2023 ? 12 : 5
  for (let m = lo; m <= hi; m++) months.push(`${y}-${String(m).padStart(2, '0')}`)
}
for (const month of months) {
  const r = await apiRequest('/leave-balances/accrual/run', {
    method: 'POST', token: rh, body: { accrualMonth: month },
  })
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`accrual ${month} HTTP ${r.status} ${JSON.stringify(r.data)}`)
  }
}

async function balance(userId) {
  const r = await apiRequest(
    `/leave-balances/employee/${userId}?referencePeriod=${PERIOD}&counterType=N`,
    { token: rh },
  )
  return r.data?.[0] ?? null
}

// Fixtures SQL (consommation + réservation) : pas de chemin API pour une
// consommation sur une période passée ; le test de la clôture passe, lui, par
// l'API réelle.
async function setBalance(userId, { consumed, reserved, available }) {
  const b = await balance(userId)
  if (!b) throw new Error(`balance introuvable ${userId}`)
  await sqlRun((c) =>
    c.query(
      'UPDATE leave_balances SET consumed_days = ?, reserved_days = ?, available_days = ? WHERE id = ?',
      [consumed ?? b.consumedDays, reserved ?? b.reservedDays, available ?? b.availableDays, b.id],
    ),
  )
}

await setBalance(u05.id, { consumed: 0.5, available: 25.79 })
await setBalance(u10.id, { consumed: 10, available: 16.29 })
await setBalance(uover.id, { consumed: 30, available: -3.71 })
await setBalance(uresv.id, { reserved: 5 })

// Corrections RH réelles (+3 / -5).
async function correct(userId, days) {
  const b = await balance(userId)
  const r = await apiRequest(`/leave-balances/${b.id}/correction`, {
    method: 'POST', token: rh, body: { days, reason: `Cas complémentaire ${TAG}` },
  })
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`correction ${days} HTTP ${r.status} ${JSON.stringify(r.data)}`)
  }
  return r.data
}
await correct(upos.id, 3)
await correct(uneg.id, -5)

// Vérifications avant clôture.
rec('avant clôture — base acquise 26,29 (c05)', Number((await balance(u05.id)).acquiredDays) === 26.29,
  `acquiredDays=${(await balance(u05.id)).acquiredDays}`)
rec('avant clôture — correction +3 → 29,29', Number((await balance(upos.id)).acquiredDays) === 29.29,
  `acquiredDays=${(await balance(upos.id)).acquiredDays}`)
rec('avant clôture — correction -5 → 21,29', Number((await balance(uneg.id)).acquiredDays) === 21.29,
  `acquiredDays=${(await balance(uneg.id)).acquiredDays}`)
rec('avant clôture — solde négatif -3,71 (over)', Number((await balance(uover.id)).availableDays) === -3.71,
  `availableDays=${(await balance(uover.id)).availableDays}`)

// 5. Réservation : la clôture doit être bloquée.
const blocked = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: PERIOD, confirm: true },
})
rec('clôture bloquée par réservation (400)', blocked.status === 400,
  `HTTP ${blocked.status} ${blocked.data?.message ?? ''}`)
rec('aucun supplément appliqué pendant le blocage (resv acquis reste 26,29)',
  Number((await balance(uresv.id)).acquiredDays) === 26.29,
  `acquiredDays=${(await balance(uresv.id)).acquiredDays}`)

// Libération de la réservation puis clôture réelle.
await setBalance(uresv.id, { reserved: 0 })
const close = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: PERIOD, confirm: true },
})
rec('clôture 2023-2024 acceptée après libération', close.status === 201 || close.status === 200,
  `HTTP ${close.status}`)

const byEmp = Object.fromEntries((close.data?.employees ?? []).map((e) => [e.employeeId, e]))
const g = (u) => byEmp[u.id] ?? {}

rec('c05 (0,5 consommé) : supplément 0,71', Number(g(u05).roundingSupplement) === 0.71,
  `supplement=${g(u05).roundingSupplement}`)
rec('c05 (0,5 consommé) : disponible 26,5 → transfert GMES 27', Number(g(u05).transferredFromN) === 27,
  `transferred=${g(u05).transferredFromN}`)
rec('c10 (10 consommés) : supplément 0,71', Number(g(u10).roundingSupplement) === 0.71,
  `supplement=${g(u10).roundingSupplement}`)
rec('c10 (10 consommés) : disponible 17 → transfert 17', Number(g(u10).transferredFromN) === 17,
  `transferred=${g(u10).transferredFromN}`)
rec('pos (+3) : supplément 0,71 → acquis 30, transfert 30', Number(g(upos).roundingSupplement) === 0.71 && Number(g(upos).transferredFromN) === 30,
  `supplement=${g(upos).roundingSupplement} transferred=${g(upos).transferredFromN}`)
rec('neg (-5) : supplément 0,71 → acquis 22, transfert 22', Number(g(uneg).roundingSupplement) === 0.71 && Number(g(uneg).transferredFromN) === 22,
  `supplement=${g(uneg).roundingSupplement} transferred=${g(uneg).transferredFromN}`)
rec('over (négatif) : supplément 0,71, transfert 0, solde négatif conservé', Number(g(uover).roundingSupplement) === 0.71 && Number(g(uover).transferredFromN) === 0,
  `supplement=${g(uover).roundingSupplement} transferred=${g(uover).transferredFromN}`)
rec('resv (libéré) : supplément 0,71, transfert 27', Number(g(uresv).roundingSupplement) === 0.71 && Number(g(uresv).transferredFromN) === 27,
  `supplement=${g(uresv).roundingSupplement} transferred=${g(uresv).transferredFromN}`)

// Solde négatif conservé sur la période clôturée (non remis à zéro).
const overAfter = await balance(uover.id)
rec('over : solde N négatif conservé après clôture (-3)', Number(overAfter?.availableDays) === -3,
  `availableDays=${overAfter?.availableDays} acquiredDays=${overAfter?.acquiredDays}`)

// 6. Absence de double attribution : un seul mouvement CLOTURE_ARRONDI par salarié.
let doubleCheckOk = true
for (const u of [u05, u10, upos, uneg, uover, uresv]) {
  const h = await apiRequest(`/leave-balances/employee/${u.id}/history?referencePeriod=${PERIOD}`, { token: rh })
  const count = (h.data ?? []).filter((m) => String(m.reason ?? '').startsWith('CLOTURE_ARRONDI_L3141_7')).length
  if (count !== 1) { doubleCheckOk = false; console.log(`  -> ${u.prenom}: ${count} mouvements d’arrondi`); }
}
rec('un seul mouvement d’arrondi par salarié (pas de double attribution)', doubleCheckOk)

// Idempotence : seconde clôture refusée.
const again = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: PERIOD, confirm: true },
})
rec('seconde clôture refusée (409)', again.status === 409, `HTTP ${again.status}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
