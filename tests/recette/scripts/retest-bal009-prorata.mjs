// Retest métier BAL-009 — prorata automatique arrivée/départ (règle validée).
// Base isolée gestion_conges_gmes_test. Ne touche jamais production.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
const DATE = '30/09/2026'

async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  if (r.status !== 201 && r.status !== 200) throw new Error(`login ${email} HTTP ${r.status}`)
  return r.data?.accessToken
}

async function main() {
  const ts = String(Date.now()).slice(-8)
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')

  const report = {
    purpose: 'Retest métier BAL-009 — prorata calendaire arrivée/départ',
    rule: {
      base: 'jours calendaires réels du mois',
      formula: 'MONTHLY_ACCRUAL_RATE × jours de présence / jours calendaires du mois',
      arrivalIncluded: true,
      departureIncluded: true,
      exitDateMeaning: 'dernier jour de présence dans l’entreprise',
      rounding: 'arrondi mathématique à 2 décimales',
      monthlyAccrualRate: 2.5,
      correctionRh: 'CORRECTION_POSITIVE / CORRECTION_NEGATIVE, jamais de réécriture de l’acquisition',
    },
    dateRetest: DATE,
    apiUserTests: {},
    cases: {},
    idempotence: {},
    correctionRh: {},
    executed: true,
  }

  // Service dédié
  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SRV BAL009 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data

  async function createUser(slug, { hireDate = null, exitDate = null } = {}) {
    const email = `bal009-${slug}.${ts}@gmes.fr`
    const r = await apiRequest('/users', {
      method: 'POST',
      token: admin,
      body: {
        nom: `BAL009-${slug.toUpperCase()}`,
        prenom: 'Recette',
        email,
        role: 'COLLABORATEUR',
        employmentType: 'INTERNE',
        serviceId: svc.id,
        ...(hireDate ? { hireDate } : {}),
        ...(exitDate ? { exitDate } : {}),
      },
    })
    if (r.status !== 201) throw new Error(`create ${slug} HTTP ${r.status} ${JSON.stringify(r.data)}`)
    return r.data
  }

  const users = {}
  users.A = await createUser('a', { hireDate: '2026-07-16' })
  users.B = await createUser('b', { hireDate: '2026-07-01', exitDate: '2026-07-15' })
  users.C = await createUser('c', { hireDate: '2026-07-01', exitDate: '2026-07-31' })
  users.D = await createUser('d', { hireDate: '2026-07-31' })
  users.E = await createUser('e', { hireDate: '2026-07-16', exitDate: '2026-07-20' })
  users.H = await createUser('h', { hireDate: '2026-01-01', exitDate: '2026-06-30' })
  users.I = await createUser('i', { hireDate: '2026-01-01', exitDate: '2026-07-15' })
  // I doit être inactif avant l'acquisition (départ en cours de mois).
  const disableI = await apiRequest(`/users/${users.I.id}/disable`, { method: 'PATCH', token: admin })
  report.apiUserTests.disableForCaseI = disableI.status

  // === ÉTAPE 13 — API utilisateur exitDate ===
  const apiTestUser = await createUser('api', { hireDate: '2026-07-01', exitDate: '2026-07-15' })
  report.apiUserTests.create = {
    status: 201,
    hireDate: apiTestUser.hireDate,
    exitDate: apiTestUser.exitDate,
    persisted: apiTestUser.exitDate === '2026-07-15',
  }
  const getAfterCreate = (await apiRequest(`/users/${apiTestUser.id}`, { token: admin })).data
  report.apiUserTests.get = { exitDate: getAfterCreate.exitDate, persisted: getAfterCreate.exitDate === '2026-07-15' }
  const patchExit = await apiRequest(`/users/${apiTestUser.id}`, { method: 'PATCH', token: admin, body: { exitDate: '2026-07-20' } })
  report.apiUserTests.patch = { status: patchExit.status, exitDate: patchExit.data?.exitDate, persisted: patchExit.data?.exitDate === '2026-07-20' }
  const patchNull = await apiRequest(`/users/${apiTestUser.id}`, { method: 'PATCH', token: admin, body: { exitDate: null } })
  report.apiUserTests.patchNull = { status: patchNull.status, exitDate: patchNull.data?.exitDate, isNull: patchNull.data?.exitDate === null }
  const patchInvalid = await apiRequest(`/users/${apiTestUser.id}`, { method: 'PATCH', token: admin, body: { hireDate: '2026-07-20', exitDate: '2026-07-15' } })
  report.apiUserTests.invalid = { status: patchInvalid.status, rejected: patchInvalid.status === 400, message: Array.isArray(patchInvalid.data?.message) ? patchInvalid.data.message.join(' ') : patchInvalid.data?.message }

  async function balanceAndHistory(userId) {
    const bal = await apiRequest(`/leave-balances/employee/${userId}`, { token: rh })
    const balances = Array.isArray(bal.data) ? bal.data : []
    const n = balances.find((b) => b.counterType === 'N' && b.referencePeriod === '2026-2027')
    const hist = await apiRequest(`/leave-balances/employee/${userId}/history`, { token: rh })
    const movements = Array.isArray(hist.data) ? hist.data : []
    return { balance: n ?? null, movements }
  }

  // === ÉTAPE 15 — acquisition juillet 2026 (run 1) ===
  const run1 = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rh, body: { accrualMonth: '2026-07' } })
  report.run1Status = run1.status
  const credited1 = Array.isArray(run1.data?.creditedEmployees) ? run1.data.creditedEmployees : []

  async function checkCase(key, expectedDays, expectedDaysPresent, expectedDaysInMonth) {
    const { balance, movements } = await balanceAndHistory(users[key].id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    const ok = acquired === expectedDays && acq.length === 1
    report.cases[key] = {
      expectedDays,
      observedDays: acquired,
      movementCount: acq.length,
      movementDays: acq[0] ? Number(acq[0].days) : null,
      movementReason: acq[0]?.reason ?? null,
      ok,
    }
    return ok
  }

  // A : arrivée 16/07 → 1,29
  report.cases.A = report.cases.A ?? {}
  {
    const { balance, movements } = await balanceAndHistory(users.A.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.A = {
      expectedDays: 1.29, observedDays: acquired,
      movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null,
      movementReason: acq[0]?.reason ?? null,
      presenceExpected: '16/31',
      ok: acquired === 1.29 && acq.length === 1,
    }
  }
  report.cases.B = report.cases.B ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.B.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.B = { expectedDays: 1.21, observedDays: acquired, movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null, movementReason: acq[0]?.reason ?? null, ok: acquired === 1.21 && acq.length === 1 }
  }
  report.cases.C = report.cases.C ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.C.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.C = { expectedDays: 2.5, observedDays: acquired, movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null, movementReason: acq[0]?.reason ?? null, ok: acquired === 2.5 && acq.length === 1 }
  }
  report.cases.D = report.cases.D ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.D.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.D = { expectedDays: 0.08, observedDays: acquired, movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null, movementReason: acq[0]?.reason ?? null, ok: acquired === 0.08 && acq.length === 1 }
  }
  report.cases.E = report.cases.E ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.E.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.E = { expectedDays: 0.4, observedDays: acquired, movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null, movementReason: acq[0]?.reason ?? null, ok: acquired === 0.4 && acq.length === 1 }
  }
  report.cases.H = report.cases.H ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.H.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.H = { expectedDays: 0, observedDays: acquired, movementCount: acq.length, ok: acquired === 0 && acq.length === 0 }
  }
  report.cases.I = report.cases.I ?? {}; {
    const { balance, movements } = await balanceAndHistory(users.I.id)
    const acquired = balance ? Number(balance.acquiredDays) : 0
    const acq = movements.filter((m) => m.movementType === 'ACQUISITION')
    report.cases.I = { expectedDays: 1.21, observedDays: acquired, movementCount: acq.length, movementDays: acq[0] ? Number(acq[0].days) : null, ok: acquired === 1.21 && acq.length === 1 }
  }

  // === ÉTAPE 12/15-F — idempotence (run 2) ===
  const snapshotA = (await balanceAndHistory(users.A.id))
  const run2 = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rh, body: { accrualMonth: '2026-07' } })
  const afterA = (await balanceAndHistory(users.A.id))
  const acqA2 = afterA.movements.filter((m) => m.movementType === 'ACQUISITION')
  report.idempotence = {
    run2Status: run2.status,
    caseA: {
      acquiredBefore: Number(snapshotA.balance?.acquiredDays ?? 0),
      acquiredAfter: Number(afterA.balance?.acquiredDays ?? 0),
      movementCountBefore: snapshotA.movements.filter((m) => m.movementType === 'ACQUISITION').length,
      movementCountAfter: acqA2.length,
      ok: Number(afterA.balance?.acquiredDays ?? 0) === 1.29 && acqA2.length === 1,
    },
    fullMonth: null,
  }
  {
    const c2 = (await balanceAndHistory(users.C.id))
    const acqC2 = c2.movements.filter((m) => m.movementType === 'ACQUISITION')
    report.idempotence.fullMonth = { acquired: Number(c2.balance?.acquiredDays ?? 0), movementCount: acqC2.length, ok: Number(c2.balance?.acquiredDays ?? 0) === 2.5 && acqC2.length === 1 }
  }

  // === ÉTAPE 9/15-G — correction RH (+0,21 sur A : 1,29 → 1,50) ===
  const balA = (await balanceAndHistory(users.A.id)).balance
  const corr = await apiRequest(`/leave-balances/${balA.id}/correction`, { method: 'POST', token: rh, body: { days: 0.21, reason: `Correction RH BAL-009-G ${ts}`, notifyEmployee: false } })
  const afterCorr = (await balanceAndHistory(users.A.id))
  const acqAfterCorr = afterCorr.movements.filter((m) => m.movementType === 'ACQUISITION')
  const corrMovs = afterCorr.movements.filter((m) => m.movementType === 'CORRECTION_POSITIVE' || m.movementType === 'CORRECTION_NEGATIVE')
  report.correctionRh = {
    status: corr.status,
    acquisitionPreserved: acqAfterCorr.length === 1 && Number(acqAfterCorr[0].days) === 1.29,
    correctionSeparated: corrMovs.length === 1 && Number(corrMovs[0].days) === 0.21,
    correctionType: corrMovs[0]?.movementType ?? null,
    finalBalance: Number(afterCorr.balance?.acquiredDays ?? 0),
    expectedFinal: 1.5,
    reason: corrMovs[0]?.reason ?? null,
    ok: acqAfterCorr.length === 1 && Number(acqAfterCorr[0].days) === 1.29 && corrMovs.length === 1 && Number(corrMovs[0].days) === 0.21 && Number(afterCorr.balance?.acquiredDays ?? 0) === 1.5,
  }

  const caseKeys = ['A', 'B', 'C', 'D', 'E', 'H', 'I']
  const allOk = caseKeys.every((k) => report.cases[k]?.ok) && report.idempotence.caseA.ok && report.idempotence.fullMonth.ok && report.correctionRh.ok && report.apiUserTests.invalid.rejected
  report.conclusion = allOk ? 'Conforme' : 'Non conforme'

  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(REPORTS_DIR, 'retest-bal009-prorata.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== RETEST BAL-009 ===')
  console.log('cases:', JSON.stringify(report.cases, null, 1))
  console.log('idempotence:', JSON.stringify(report.idempotence))
  console.log('correctionRh:', JSON.stringify(report.correctionRh))
  console.log('apiUserTests:', JSON.stringify(report.apiUserTests))
  console.log('CONCLUSION:', report.conclusion)
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1) })
