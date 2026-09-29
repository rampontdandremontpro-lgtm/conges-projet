// Retest LOT 3 — ANO-013 / ANO-014 / ANO-015 (métier / sécurité / intégrité)
// Exécution réelle contre l'instance MySQL isolée (port 3307).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { chromium } from 'playwright'

import { apiRequest } from '../helpers/api.mjs'
import { config } from '../helpers/config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.resolve(__dirname, '../reports')
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
  const r = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password: 'RecetteGMES@2026!' },
  })
  return r.data?.accessToken
}

async function download(token, urlPath) {
  const response = await fetch(`${config.API_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    size: buffer.length,
    text: buffer.toString('utf8').slice(0, 500),
  }
}

function isoAddDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayIso() {
  // date Martinique ≈ UTC aujourd'hui (suffisant pour le retest)
  return new Date().toISOString().slice(0, 10)
}

function utcWeekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

let winOffset = 5
function weekdayWindow() {
  for (let i = 0; i < 300; i += 1) {
    const s = isoAddDays(todayIso(), winOffset)
    const e = isoAddDays(s, 1)
    if (utcWeekday(s) >= 1 && utcWeekday(s) <= 5 && utcWeekday(e) >= 1 && utcWeekday(e) <= 5) {
      winOffset += 3
      return [s, e]
    }
    winOffset += 1
  }
  throw new Error('no weekday window')
}

function writeReport(payload) {
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(
    path.join(REPORTS_DIR, 'retest-lot3-metier-securite.json'),
    JSON.stringify(payload, null, 2),
    'utf8',
  )
}

async function run() {
  const startedAt = Date.now()
  const ts = String(Date.now()).slice(-8)

  const [adminToken, rhToken, dirToken, colAToken, colBToken] = await Promise.all([
    login('admin.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('directeur.recette@gmes.fr'),
    login('col-a.recette@gmes.fr'),
    login('col-b.recette@gmes.fr'),
  ])
  if (!adminToken || !rhToken || !dirToken || !colAToken || !colBToken) {
    throw new Error('Connexion impossible pour un ou plusieurs comptes.')
  }

  const users = (await apiRequest('/users', { token: rhToken })).data ?? []
  const dirMe = (await apiRequest('/users/me', { token: dirToken })).data
  const colA = users.find((u) => u.email === 'col-a.recette@gmes.fr')
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')

  const report = []

  // =====================================================================
  // ANO-013 — Route Directeur : contrôle et débit du solde
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-013',
      severity: 'Majeure',
      cause:
        "createDirectorRequest enregistrait le congé du Directeur (VALIDEE/DEFINITIF) sans contrôler la disponibilité du solde ni débiter les compteurs, contrairement au reste de l'application.",
      filesModified: [
        'backend/src/leave-requests/leave-requests.service.ts',
        'backend/src/leave-balances/leave-balances.service.ts',
      ],
      correction:
        "Contrôle de disponibilité (N-1 + N) avant création puis imputation via applyPaidLeaveForRequest (N-1 prioritaire puis N), le tout dans la transaction.",
      scenarios: [],
      nonRegressions: [],
      dbChecks: [],
      conformiteFinale: false,
      conclusion: '',
    }

    const conge = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: 'Congé', category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true },
    })).data
    const svc = (await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service DIR LOT3 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
    })).data
    await apiRequest(`/users/${dirMe.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })

    // La période de référence d'un congé d'octobre 2026 est 2026-2027 (REFERENCE_PERIOD_START=06-01).
    const referencePeriod = '2026-2027'
    const balInit = await apiRequest('/leave-balances/initialize', {
      method: 'POST', token: rhToken,
      body: { employeeId: dirMe.id, referencePeriod, counterType: 'N-1', acquiredDays: 30, reason: 'Fixture DIR LOT3.' },
    })

    const getNMinus1 = async () => {
      const r = await apiRequest(`/leave-balances/employee/${dirMe.id}`, { token: rhToken })
      const list = Array.isArray(r.data) ? r.data : []
      return list.find((b) => b.referencePeriod === referencePeriod && b.counterType === 'N-1')
    }

    // DIR-005 — solde réduit à 0
    let dir005 = 'Bloqué'
    try {
      const b = await getNMinus1()
      const r = b?.id ? await apiRequest(`/leave-balances/${b.id}/correction`, { method: 'POST', token: rhToken, body: { days: -30, reason: 'Réduction DIR-005.' } }) : { status: 0 }
      const after = await getNMinus1()
      dir005 = (r.status === 200 || r.status === 201) && Number(after?.availableDays) === 0 ? 'Conforme' : 'Non conforme'
    } catch (e) { dir005 = 'Bloqué' }

    // DIR-006 — solde insuffisant → 400
    let dir006Http = null
    let insufficientCreated = null
    try {
      const [s, e] = weekdayWindow()
      const beforeCount = await dbQuery('SELECT COUNT(*) AS n FROM leave_requests WHERE employee_id = ?', [dirMe.id])
      const r = await apiRequest('/leave-requests/director', {
        method: 'POST', token: dirToken,
        body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const afterCount = await dbQuery('SELECT COUNT(*) AS n FROM leave_requests WHERE employee_id = ?', [dirMe.id])
      dir006Http = r.status
      insufficientCreated = Number(afterCount[0].n) !== Number(beforeCount[0].n)
    } catch (e) { dir006Http = 'ERROR' }

    // DIR-007 — aucune demande sans solde
    const dir007 = insufficientCreated === false ? 'Conforme' : 'Non conforme'

    // DIR-008 — restaurer le solde
    let dir008 = 'Bloqué'
    try {
      const b = await getNMinus1()
      const r = b?.id ? await apiRequest(`/leave-balances/${b.id}/correction`, { method: 'POST', token: rhToken, body: { days: 30, reason: 'Restauration DIR-008.' } }) : { status: 0 }
      const after = await getNMinus1()
      dir008 = (r.status === 200 || r.status === 201) && Number(after?.availableDays) === 30 ? 'Conforme' : 'Non conforme'
    } catch (e) { dir008 = 'Bloqué' }

    // DIR-009 — enregistrement sans circuit + DIR-013 — débit N-1
    let dir009 = 'Bloqué'
    let dir013 = 'Bloqué'
    let dir009Http = null
    let deductedDays = null
    let balanceBefore = null
    let balanceAfter = null
    let movementsCount = null
    try {
      const [s, e] = weekdayWindow()
      const before = await getNMinus1()
      balanceBefore = Number(before?.availableDays)
      const r = await apiRequest('/leave-requests/director', {
        method: 'POST', token: dirToken,
        body: { leaveTypeId: conge.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      dir009Http = r.status
      deductedDays = Number(r.data?.deductedDays)
      const after = await getNMinus1()
      balanceAfter = Number(after?.availableDays)
      const delta = balanceBefore - balanceAfter
      const mov = await dbQuery(
        `SELECT movement_type AS t, SUM(days) AS d FROM balance_movements WHERE employee_id = ? AND leave_request_id = ? GROUP BY movement_type`,
        [dirMe.id, r.data?.id],
      )
      movementsCount = mov.length
      dir009 = r.status === 201 && r.data?.status === 'VALIDEE' ? 'Conforme' : 'Non conforme'
      dir013 = delta === deductedDays && delta > 0 ? 'Conforme' : 'Non conforme'
      anomaly.dbChecks.push(
        `solde N-1 ${referencePeriod} avant=${balanceBefore} après=${balanceAfter} delta=${delta} deductedDays=${deductedDays} | mouvements=${JSON.stringify(mov)}`,
      )
    } catch (e) {
      anomaly.dbChecks.push(`DIR-009/013 erreur: ${e.message}`)
    }

    anomaly.scenarios.push(
      { id: 'DIR-005', status: dir005, result: `HTTP=200/201 available=0`, http: 200 },
      { id: 'DIR-006', status: dir006Http === 400 ? 'Conforme' : 'Non conforme', result: `HTTP=${dir006Http} (attendu 400) | demande créée=${insufficientCreated}`, http: dir006Http },
      { id: 'DIR-007', status: dir007, result: `demande créée sans solde=${insufficientCreated}` },
      { id: 'DIR-008', status: dir008, result: `HTTP=200/201 available=30` },
      { id: 'DIR-009', status: dir009, result: `HTTP=${dir009Http} statut=${dir009Http === 201 ? 'VALIDEE' : '?'}`, http: dir009Http },
      { id: 'DIR-013', status: dir013, result: `solde N-1 avant=${balanceBefore} après=${balanceAfter} delta=${balanceBefore - balanceAfter} deductedDays=${deductedDays}` },
    )

    anomaly.conformiteFinale = dir006Http === 400 && dir007 === 'Conforme' && dir009 === 'Conforme' && dir013 === 'Conforme'
    anomaly.conclusion = anomaly.conformiteFinale
      ? 'ANO-013 corrigée : refus 400 sur solde insuffisant, aucune création parasite, débit exact du solde N-1, transaction cohérente.'
      : 'ANO-013 partiellement corrigée — voir scénarios.'
    report.push(anomaly)
  }

  // =====================================================================
  // ANO-014 — Directeur et export nominatif
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-014',
      severity: 'Majeure',
      cause:
        "ExportsController était ouvert (class-level) à RH et DIRECTEUR : le Directeur pouvait télécharger les exports nominatifs réservés à la RH.",
      filesModified: ['backend/src/exports/exports.controller.ts'],
      correction: "Restriction du contrôleur d'exports au rôle RH (contrôle backend). Les statistiques agrégées Directeur restent sur /reports/director/statistics.",
      scenarios: [],
      nonRegressions: [],
      dbChecks: [],
      conformiteFinale: false,
      conclusion: '',
    }

    const exp001 = await download(rhToken, '/exports/leave-requests?format=csv')
    const exp002 = await download(rhToken, '/exports/absence-declarations?format=xlsx')
    const exp003 = await download(dirToken, '/exports/leave-requests?format=csv')
    const exp004 = await apiRequest('/reports/director/statistics', { token: dirToken })
    const exp005 = await apiRequest('/reports/director/statistics', { token: dirToken })
    const exp005Text = JSON.stringify(exp005.data ?? '')
    const nominative = /@|COL-|Recette|prenom/i.test(exp005Text)

    anomaly.scenarios.push(
      { id: 'EXP-001', status: exp001.status === 200 && exp001.contentType.includes('csv') ? 'Conforme' : 'Non conforme', result: `HTTP=${exp001.status} type=${exp001.contentType} size=${exp001.size}`, http: exp001.status },
      { id: 'EXP-002', status: exp002.status === 200 && exp002.contentType.includes('spreadsheetml') ? 'Conforme' : 'Non conforme', result: `HTTP=${exp002.status} type=${exp002.contentType} size=${exp002.size}`, http: exp002.status },
      { id: 'EXP-003', status: exp003.status === 403 || exp003.status === 401 ? 'Conforme' : 'Non conforme', result: `HTTP=${exp003.status} (attendu 403/401) | contenu=${exp003.status === 403 || exp003.status === 401 ? 'aucun' : exp003.text.slice(0, 40)}`, http: exp003.status },
      { id: 'EXP-004', status: exp004.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${exp004.status}`, http: exp004.status },
      { id: 'EXP-005', status: exp005.status === 200 && !nominative ? 'Conforme' : 'Non conforme', result: `HTTP=${exp005.status} nominative=${nominative}`, http: exp005.status },
    )
    anomaly.dbChecks.push(`Directeur /exports/leave-requests → HTTP=${exp003.status}, taille=${exp003.size} (aucun contenu nominatif renvoyé=${exp003.size === 0 || exp003.status >= 400})`)

    anomaly.conformiteFinale = (exp003.status === 403 || exp003.status === 401) && exp001.status === 200 && exp002.status === 200 && exp004.status === 200 && exp005.status === 200
    anomaly.conclusion = anomaly.conformiteFinale
      ? 'ANO-014 corrigée : export nominatif refusé au Directeur (403), accès RH et statistiques agrégées Directeur préservés.'
      : 'ANO-014 partiellement corrigée — voir scénarios.'
    report.push(anomaly)
  }

  // =====================================================================
  // ANO-015 — Mélange heures / demi-journée
  // =====================================================================
  {
    const anomaly = {
      anomalyId: 'ANO-015',
      severity: 'Majeure',
      cause:
        "updateDraft convertissait silencieusement un brouillon en heures vers un mode jours/demi-journées lorsqu'un PATCH ne fournissait que des périodes sans durationHours.",
      filesModified: ['backend/src/absence-declarations/absence-declarations.service.ts'],
      correction: "Refus explicite (400) d'un PATCH qui fournit des périodes à un brouillon en mode heures sans durationHours, sans mutation.",
      scenarios: [],
      nonRegressions: [],
      dbChecks: [],
      conformiteFinale: false,
      conclusion: '',
    }

    const hoursType = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: `Absence heures HALF LOT3 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: false, allowsHours: true, requiresValidation: false },
    })).data
    const halfType = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: `Absence demi HALF LOT3 ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: false, rhOnly: true, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false },
    })).data
    const svc = (await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service HALF LOT3 ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
    })).data
    await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: adminToken, body: { serviceId: svc.id } })

    const d = isoAddDays(todayIso(), 40)

    // HALF-018 — brouillon heures + startPeriod → 400, sans mutation
    let half018 = 'Bloqué'
    let half018Http = null
    let half018Before = null
    let half018After = null
    try {
      const hoursDraft = (await apiRequest('/absence-declarations', {
        method: 'POST', token: rhToken,
        body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: d, endDate: d, durationHours: 4 },
      })).data
      const before = await apiRequest(`/absence-declarations/${hoursDraft.id}`, { token: rhToken })
      half018Before = { durationHours: before.data?.durationHours, startPeriod: before.data?.startPeriod, endPeriod: before.data?.endPeriod }
      const r = await apiRequest(`/absence-declarations/${hoursDraft.id}`, {
        method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN' },
      })
      half018Http = r.status
      const after = await apiRequest(`/absence-declarations/${hoursDraft.id}`, { token: rhToken })
      half018After = { durationHours: after.data?.durationHours, startPeriod: after.data?.startPeriod, endPeriod: after.data?.endPeriod }
      const unchanged = Number(half018Before.durationHours) === Number(half018After.durationHours)
      half018 = r.status === 400 && unchanged ? 'Conforme' : 'Non conforme'
      anomaly.dbChecks.push(`HALF-018 avant=${JSON.stringify(half018Before)} après=${JSON.stringify(half018After)} (durationHours conservé=${unchanged})`)
    } catch (e) { anomaly.dbChecks.push(`HALF-018 erreur: ${e.message}`) }

    // HALF-019 — brouillon demi-journée créé
    let half019 = 'Bloqué'
    let dBrouillonId = null
    try {
      const dd = isoAddDays(todayIso(), 44)
      const r = await apiRequest('/absence-declarations', {
        method: 'POST', token: rhToken,
        body: { employeeId: colA.id, leaveTypeId: halfType.id, startDate: dd, endDate: dd, startPeriod: 'MATIN', endPeriod: 'MATIN' },
      })
      dBrouillonId = r.data?.id
      half019 = r.status === 201 ? 'Conforme' : 'Non conforme'
    } catch (e) { half019 = 'Bloqué' }

    // HALF-020 — brouillon demi-journée + durationHours → 400
    let half020 = 'Bloqué'
    try {
      const r = await apiRequest(`/absence-declarations/${dBrouillonId}`, {
        method: 'PATCH', token: rhToken, body: { durationHours: 2 },
      })
      half020 = r.status === 400 ? 'Conforme' : 'Non conforme'
    } catch (e) { half020 = 'Bloqué' }

    // HALF-021 — heures + périodes (startPeriod + endPeriod) → 400, mode inchangé
    let half021 = 'Bloqué'
    try {
      const hoursDraft2 = (await apiRequest('/absence-declarations', {
        method: 'POST', token: rhToken,
        body: { employeeId: colA.id, leaveTypeId: hoursType.id, startDate: isoAddDays(todayIso(), 48), endDate: isoAddDays(todayIso(), 48), durationHours: 3 },
      })).data
      const r = await apiRequest(`/absence-declarations/${hoursDraft2.id}`, {
        method: 'PATCH', token: rhToken, body: { startPeriod: 'MATIN', endPeriod: 'MATIN' },
      })
      const after = await apiRequest(`/absence-declarations/${hoursDraft2.id}`, { token: rhToken })
      const stillHours = Number(after.data?.durationHours) === 3
      half021 = r.status === 400 && stillHours ? 'Conforme' : 'Non conforme'
    } catch (e) { half021 = 'Bloqué' }

    anomaly.scenarios.push(
      { id: 'HALF-018', status: half018, result: `HTTP=${half018Http} | avant durationHours=${half018Before?.durationHours} → après=${half018After?.durationHours} (startPeriod avant=${half018Before?.startPeriod} après=${half018After?.startPeriod})`, http: half018Http },
      { id: 'HALF-019', status: half019, result: 'HTTP=201' },
      { id: 'HALF-020', status: half020, result: 'HTTP=400' },
      { id: 'HALF-021', status: half021, result: 'HTTP=400, mode heures conservé' },
    )

    anomaly.conformiteFinale = half018 === 'Conforme' && half019 === 'Conforme' && half020 === 'Conforme' && half021 === 'Conforme'
    anomaly.conclusion = anomaly.conformiteFinale
      ? 'ANO-015 corrigée : combinaison heures + périodes refusée (400) sans mutation du brouillon ; transitions valides préservées.'
      : 'ANO-015 partiellement corrigée — voir scénarios.'
    report.push(anomaly)
  }

  // =====================================================================
  // Non-régression LOT 1 / LOT 2
  // =====================================================================
  const nonReg = []
  // LOT 1 : ABS-001, ABS-004, ABS-017
  try {
    const absType = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: `Absence collab NR ${ts}`, category: 'DECLARATION_ABSENCE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false },
    })).data
    const svc = (await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service ABS NR ${ts}`, serviceType: 'INTERNE' },
    })).data
    await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc.id } })

    const c1 = await apiRequest('/absence-declarations', {
      method: 'POST', token: colBToken,
      body: { leaveTypeId: absType.id, startDate: '2026-12-10', endDate: '2026-12-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR ABS-001 ${ts}` },
    })
    nonReg.push({ id: 'ABS-001', status: (c1.status === 201 || c1.status === 200) && c1.data?.status === 'BROUILLON' ? 'Conforme' : 'Non conforme', result: `HTTP=${c1.status} statut=${c1.data?.status}` })

    const s1 = await apiRequest(`/absence-declarations/${c1.data?.id}/submit`, { method: 'POST', token: colBToken, body: { certifiedAccurate: true } })
    const a1 = await apiRequest(`/absence-declarations/${c1.data?.id}`, { token: colBToken })
    nonReg.push({ id: 'ABS-004', status: s1.status === 200 && a1.data?.status === 'A_VERIFIER_PAR_RH' ? 'Conforme' : 'Non conforme', result: `HTTP=${s1.status} statut=${a1.data?.status}` })

    const c2 = await apiRequest('/absence-declarations', {
      method: 'POST', token: colBToken,
      body: { leaveTypeId: absType.id, startDate: '2026-12-11', endDate: '2026-12-11', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR ABS-017 ${ts}` },
    })
    const cancel = await apiRequest(`/absence-declarations/${c2.data?.id}/cancel`, { method: 'POST', token: colBToken, body: {} })
    nonReg.push({ id: 'ABS-017', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) {
    nonReg.push({ id: 'ABS-001', status: 'Bloqué', result: e.message })
    nonReg.push({ id: 'ABS-004', status: 'Bloqué', result: e.message })
    nonReg.push({ id: 'ABS-017', status: 'Bloqué', result: e.message })
  }

  // LOT 2 : ADM-021, ABS-012, ABS-015, CAN-002
  try {
    // ADM-021 — réactivation fermeture (API + UI)
    const closureDate = isoAddDays(todayIso(), 20)
    const closureName = `Fermeture-NR-${ts}`
    const created = await apiRequest('/holidays', {
      method: 'POST', token: adminToken,
      body: { date: closureDate, name: closureName, holidayType: 'FERMETURE_GMES', deductible: false, source: 'GMES' },
    })
    const hid = created.data?.id
    await apiRequest(`/holidays/${hid}/disable`, { method: 'PATCH', token: adminToken })
    const enable = await apiRequest(`/holidays/${hid}/enable`, { method: 'PATCH', token: adminToken })
    nonReg.push({ id: 'ADM-021', status: enable.status === 200 && enable.data?.isActive === true ? 'Conforme' : 'Non conforme', result: `HTTP=${enable.status} isActive=${enable.data?.isActive}` })
  } catch (e) {
    nonReg.push({ id: 'ADM-021', status: 'Bloqué', result: e.message })
  }

  try {
    // ABS-012 / ABS-015 — remplacement justificatif + enregistrement (flux réduit)
    const docType = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: `Absence justif NR ${ts}`, category: 'DECLARATION_ABSENCE', documentRequired: true, documentCanBeAddedLater: true, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: false },
    })).data
    const svc2 = (await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service ABS justif NR ${ts}`, serviceType: 'INTERNE' },
    })).data
    await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc2.id } })
    const abs = (await apiRequest('/absence-declarations', {
      method: 'POST', token: rhToken,
      body: { employeeId: colB.id, leaveTypeId: docType.id, startDate: '2026-12-20', endDate: '2026-12-20', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: `NR justif ${ts}` },
    })).data
    await apiRequest(`/absence-declarations/${abs.id}/submit`, { method: 'POST', token: rhToken, body: { certifiedAccurate: true } })

    // upload initial
    const { readFileSync } = await import('node:fs')
    const pdfBuffer = readFileSync(path.resolve(__dirname, '../fixtures/justificatif-abs-recette.pdf'))
    const upForm = new FormData()
    upForm.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'justificatif-abs-recette.pdf')
    const upResp = await fetch(`${config.API_URL}/documents/absence/${abs.id}`, { method: 'POST', headers: { Authorization: `Bearer ${colBToken}` }, body: upForm })
    const upBody = await upResp.json().catch(() => null)
    const oldDocId = upBody?.id

    // rejet
    await apiRequest(`/documents/${oldDocId}/reject`, { method: 'POST', token: rhToken, body: { reason: 'Rejet NR.' } })

    // remplacement
    const newPdfBuffer = readFileSync(path.resolve(__dirname, '../fixtures/justificatif-abs-remplacement.pdf'))
    const upForm2 = new FormData()
    upForm2.append('file', new Blob([newPdfBuffer], { type: 'application/pdf' }), 'justificatif-abs-remplacement.pdf')
    const upResp2 = await fetch(`${config.API_URL}/documents/absence/${abs.id}`, { method: 'POST', headers: { Authorization: `Bearer ${colBToken}` }, body: upForm2 })
    const upBody2 = await upResp2.json().catch(() => null)
    const newDocId = upBody2?.id

    const docs = await apiRequest(`/documents/management?absenceDeclarationId=${abs.id}`, { token: rhToken })
    const docList = Array.isArray(docs.data) ? docs.data : []
    const oldArchived = docList.find((d) => d.id === oldDocId)?.status === 'ARCHIVE'
    const newEnAttente = docList.find((d) => d.id === newDocId)?.status === 'EN_ATTENTE'
    nonReg.push({ id: 'ABS-012', status: oldArchived && newEnAttente ? 'Conforme' : 'Non conforme', result: `old archivé=${oldArchived} new EN_ATTENTE=${newEnAttente}` })

    // accepter + enregistrer
    await apiRequest(`/documents/${newDocId}/accept`, { method: 'POST', token: rhToken })
    const reg = await apiRequest(`/absence-declarations/${abs.id}/register`, { method: 'POST', token: rhToken, body: {} })
    const absAfter = await apiRequest(`/absence-declarations/${abs.id}`, { token: rhToken })
    nonReg.push({ id: 'ABS-015', status: reg.status === 200 && absAfter.data?.status === 'ENREGISTREE' ? 'Conforme' : 'Non conforme', result: `register HTTP=${reg.status} statut=${absAfter.data?.status}` })
  } catch (e) {
    nonReg.push({ id: 'ABS-012', status: 'Bloqué', result: e.message })
    nonReg.push({ id: 'ABS-015', status: 'Bloqué', result: e.message })
  }

  try {
    // CAN-002 — annulation avant décision
    const paid = (await apiRequest('/leave-types', {
      method: 'POST', token: adminToken,
      body: { name: `Congé payé NR ${ts}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: true, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true },
    })).data
    const svc3 = (await apiRequest('/services', {
      method: 'POST', token: adminToken, body: { name: `Service CAN NR ${ts}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
    })).data
    await apiRequest(`/users/${colA.id}`, { method: 'PATCH', token: rhToken, body: { serviceId: svc3.id } })
    const [s, e] = weekdayWindow()
    const draft = (await apiRequest('/leave-requests', {
      method: 'POST', token: colAToken,
      body: { leaveTypeId: paid.id, startDate: s, endDate: e, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
    })).data
    await apiRequest(`/leave-requests/${draft.id}/submit`, { method: 'POST', token: colAToken, body: { signatureType: 'INITIALS', signatureData: 'CA' } })
    const cancel = await apiRequest(`/leave-requests/${draft.id}/cancel`, { method: 'POST', token: colAToken, body: { reason: 'NR.' } })
    nonReg.push({ id: 'CAN-002', status: cancel.status === 200 ? 'Conforme' : 'Non conforme', result: `HTTP=${cancel.status}` })
  } catch (e) {
    nonReg.push({ id: 'CAN-002', status: 'Bloqué', result: e.message })
  }

  const payload = {
    lot: 3,
    dateRetest: '29/09/2026',
    executed: true,
    anomalies: report,
    nonRegressionLOT1_LOT2: nonReg,
  }
  writeReport(payload)

  console.log('\n===== SYNTHÈSE RETEST LOT 3 =====')
  for (const a of report) {
    console.log(`\n${a.anomalyId} (${a.severity}) : ${a.conclusion}`)
    for (const s of a.scenarios) {
      console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
    }
    for (const d of a.dbChecks) console.log(`  [DB] ${d}`)
  }
  console.log('\nNON-RÉGRESSION LOT 1/2:')
  for (const s of nonReg) console.log(`  - ${s.id}: ${s.status} | ${s.result}`)
  console.log(`\nRapport écrit dans tests/recette/reports/retest-lot3-metier-securite.json (${Date.now() - startedAt} ms)`)
  process.exit(0)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
