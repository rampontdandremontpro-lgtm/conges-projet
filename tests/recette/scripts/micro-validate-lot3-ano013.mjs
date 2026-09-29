// Micro-validation LOT 3 — ANO-013 / DIR-013 : cas exact d'un jour + atomicité.
import mysql from 'mysql2/promise'

import { apiRequest } from '../helpers/api.mjs'

const DB = {
  host: '127.0.0.1',
  port: 3307,
  user: 'recette',
  password: 'recette',
  database: 'gestion_conges_gmes_test',
}

async function dbQuery(sql, params = []) {
  const c = await mysql.createConnection(DB)
  try {
    const [rows] = await c.query(sql, params)
    return rows
  } finally {
    await c.end()
  }
}

async function login(email) {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password: 'RecetteGMES@2026!' } })
  return r.data?.accessToken
}

function isoAddDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function utcWeekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

// jours ouvrables non-vendredi (évite la règle du samedi) : lundi→jeudi
function findNonFridayWeekday(offsetStart) {
  for (let i = 0; i < 90; i += 1) {
    const d = isoAddDays(todayIso(), offsetStart + i)
    const wd = utcWeekday(d)
    if (wd >= 1 && wd <= 4) return d
  }
  throw new Error('aucun jour ouvrable non-vendredi trouvé')
}

async function run() {
  const [adminToken, rhToken, dirToken] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
  ])
  if (!adminToken || !rhToken || !dirToken) throw new Error('Connexion impossible.')

  const dirMe = (await apiRequest('/users/me', { token: dirToken })).data
  const referencePeriod = '2026-2027'

  const conge = (await apiRequest('/leave-types', {
    method: 'POST', token: adminToken,
    body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true },
  })).data
  const svc = (await apiRequest('/services', {
    method: 'POST', token: adminToken, body: { name: 'Service DIR micro', serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
  })).data
  await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })

  const getBalances = async () => {
    const r = await apiRequest(`/leave-balances/employee/${dirMe.id}`, { token: rhToken })
    const list = Array.isArray(r.data) ? r.data : []
    return {
      nMinus1: list.find((b) => b.referencePeriod === referencePeriod && b.counterType === 'N-1'),
      n: list.find((b) => b.referencePeriod === referencePeriod && b.counterType === 'N'),
    }
  }
  const reqCount = () => dbQuery('SELECT COUNT(*) AS n FROM leave_requests WHERE employee_id = ?', [dirMe.id])
  const dedCount = () => dbQuery(`SELECT COUNT(*) AS n, COALESCE(SUM(days),0) AS d FROM balance_movements WHERE employee_id = ? AND movement_type = 'DEDUCTION'`, [dirMe.id])

  const out = { anomalyId: 'ANO-013', exactOneDay: {}, insufficient: {}, concurrency: {} }

  // ===== Fixture : N-1 = 30, N = 0 =====
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: dirMe.id, referencePeriod, counterType: 'N-1', acquiredDays: 30, reason: 'Micro DIR-013.' } })
  await apiRequest('/leave-balances/initialize', { method: 'POST', token: rhToken, body: { employeeId: dirMe.id, referencePeriod, counterType: 'N', acquiredDays: 0, reason: 'Micro DIR-013 N.' } })

  // ===== DIR-013 : demande EXACTEMENT d'un jour =====
  const d1 = findNonFridayWeekday(20)
  {
    const before = await getBalances()
    const bReq = await reqCount()
    const bDed = await dedCount()
    const r = await apiRequest('/leave-requests/director', {
      method: 'POST', token: dirToken,
      body: { leaveTypeId: conge.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
    })
    const after = await getBalances()
    const aReq = await reqCount()
    const aDed = await dedCount()
    const deltaNMinus1 = Number(before.nMinus1?.availableDays) - Number(after.nMinus1?.availableDays)
    const deltaN = Number(before.n?.availableDays) - Number(after.n?.availableDays)
    out.exactOneDay = {
      date: d1,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
      http: r.status,
      status: r.data?.status,
      deductedDays: Number(r.data?.deductedDays),
      balanceProcessingStatus: r.data?.balanceProcessingStatus,
      nMinus1Before: Number(before.nMinus1?.availableDays),
      nMinus1After: Number(after.nMinus1?.availableDays),
      deltaNMinus1,
      nBefore: Number(before.n?.availableDays),
      nAfter: Number(after.n?.availableDays),
      deltaN,
      deductionMovements: Number(aDed[0].n) - Number(bDed[0].n),
      deductionSum: Number(aDed[0].d) - Number(bDed[0].d),
      requestsCreated: Number(aReq[0].n) - Number(bReq[0].n),
      dir013Conforme: r.status === 201 && r.data?.status === 'VALIDEE' && Number(r.data?.deductedDays) === 1 && deltaNMinus1 === 1 && deltaN === 0,
    }
  }

  // ===== DIR-006/007 : solde insuffisant (N-1=0, N=0) sur 1 jour =====
  {
    // remettre N-1 à 0
    const b = (await getBalances()).nMinus1
    await apiRequest(`/leave-balances/${b.id}/correction`, { method: 'POST', token: rhToken, body: { days: -Number(b.availableDays), reason: 'Micro DIR-006.' } })
    const before = await getBalances()
    const bReq = await reqCount()
    const bDed = await dedCount()
    const d2 = findNonFridayWeekday(35)
    const r = await apiRequest('/leave-requests/director', {
      method: 'POST', token: dirToken,
      body: { leaveTypeId: conge.id, startDate: d2, endDate: d2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
    })
    const after = await getBalances()
    const aReq = await reqCount()
    const aDed = await dedCount()
    out.insufficient = {
      date: d2,
      http: r.status,
      requestsCreated: Number(aReq[0].n) - Number(bReq[0].n),
      movementsCreated: Number(aDed[0].n) - Number(bDed[0].n),
      nMinus1Before: Number(before.nMinus1?.availableDays),
      nMinus1After: Number(after.nMinus1?.availableDays),
      nBefore: Number(before.n?.availableDays),
      nAfter: Number(after.n?.availableDays),
      dir006Conforme: r.status === 400,
      dir007Conforme: (Number(aReq[0].n) - Number(bReq[0].n)) === 0 && (Number(aDed[0].n) - Number(bDed[0].n)) === 0,
    }
  }

  // ===== Concurrence : solde total = 1, deux créations simultanées de 1 jour =====
  {
    // N-1 = 1, N = 0
    const b1 = (await getBalances()).nMinus1
    const b2 = (await getBalances()).n
    if (b1 && Number(b1.availableDays) !== 1) {
      await apiRequest(`/leave-balances/${b1.id}/correction`, { method: 'POST', token: rhToken, body: { days: 1 - Number(b1.availableDays), reason: 'Micro concurrence N-1.' } })
    }
    if (b2 && Number(b2.availableDays) !== 0) {
      await apiRequest(`/leave-balances/${b2.id}/correction`, { method: 'POST', token: rhToken, body: { days: -Number(b2.availableDays), reason: 'Micro concurrence N.' } })
    }
    const before = await getBalances()
    const bReq = await reqCount()
    const bDed = await dedCount()
    const dA = findNonFridayWeekday(50)
    const dB = findNonFridayWeekday(55)
    const [ra, rb] = await Promise.all([
      apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: dA, endDate: dA, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }),
      apiRequest('/leave-requests/director', { method: 'POST', token: dirToken, body: { leaveTypeId: conge.id, startDate: dB, endDate: dB, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } }),
    ])
    const after = await getBalances()
    const aReq = await reqCount()
    const aDed = await dedCount()
    const statuses = [ra.status, rb.status].sort()
    out.concurrency = {
      httpStatuses: [ra.status, rb.status],
      requestsCreated: Number(aReq[0].n) - Number(bReq[0].n),
      movementsCreated: Number(aDed[0].n) - Number(bDed[0].n),
      nMinus1Before: Number(before.nMinus1?.availableDays),
      nMinus1After: Number(after.nMinus1?.availableDays),
      nAfter: Number(after.n?.availableDays),
      oneSucceededOneRefused: statuses[0] === 201 && statuses[1] === 400,
      balanceNeverNegative: Number(after.nMinus1?.availableDays) >= 0 && Number(after.n?.availableDays) >= 0,
    }
  }

  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
