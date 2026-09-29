// Retest LOT 1 — Absences collaborateur (ANO-008 / ANO-010)
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

function scenario(id, priority, scenario, type, status, resultText, proof, error, comment) {
  return { id, priority, module: 'ABS', scenario, type, status, result: resultText, date: new Date().toISOString(), proof, error, comment, executed: true }
}

async function run() {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const out = []

  const [colBToken, colCToken, rhToken, adminToken] = await Promise.all([
    login('col-b.recette@gmes.fr'),
    login('col-c.recette@gmes.fr'),
    login('rh.recette@gmes.fr'),
    login('admin.recette@gmes.fr'),
  ])

  if (!colBToken || !colCToken || !rhToken || !adminToken) {
    throw new Error('Connexion impossible pour un ou plusieurs comptes ABS.')
  }

  const usersAll = await apiRequest('/users', { token: rhToken })
  const users = Array.isArray(usersAll.data) ? usersAll.data : []
  const colB = users.find((u) => u.email === 'col-b.recette@gmes.fr')
  const colC = users.find((u) => u.email === 'col-c.recette@gmes.fr')

  // Fixture types
  const baseType = {
    category: 'DECLARATION_ABSENCE',
    deductsPaidLeaveBalance: false,
    documentRequired: false,
    documentCanBeAddedLater: false,
    allowsDays: true,
    allowsHalfDays: true,
    allowsHours: false,
    requiresValidation: false,
  }
  const allowedCreate = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: { ...baseType, name: 'Absence collaborateur ABS', employeeCanCreate: true, rhOnly: false },
  })
  const rhOnlyCreate = await apiRequest('/leave-types', {
    method: 'POST',
    token: adminToken,
    body: { ...baseType, name: 'Absence RH ABS', employeeCanCreate: false, rhOnly: true },
  })
  const allowedTypeId = allowedCreate.data?.id
  const rhOnlyTypeId = rhOnlyCreate.data?.id

  // Service + affectation (précondition absence)
  const svcCreate = await apiRequest('/services', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Service ABS', serviceType: 'INTERNE' },
  })
  let serviceId = svcCreate.data?.id
  if (!serviceId) {
    const svcList = await apiRequest('/services', { token: adminToken })
    serviceId = (Array.isArray(svcList.data) ? svcList.data : []).find((s) => s.name === 'Service ABS')?.id
  }
  await apiRequest(`/users/${colB.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })
  await apiRequest(`/users/${colC.id}`, { method: 'PATCH', token: rhToken, body: { serviceId } })

  const browser = await chromium.launch({ headless: true })

  // ===== ABS-001 : création propre collaborateur =====
  {
    try {
      const before = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations`)
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: {
          leaveTypeId: allowedTypeId,
          startDate: '2026-12-10',
          endDate: '2026-12-10',
          startPeriod: 'MATIN',
          endPeriod: 'APRES_MIDI',
          comment: 'RETEST LOT1 ABS-001 COL-B',
        },
      })
      const after = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations`)
      let uiTitle = false
      try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
        await page.fill('#login-email', 'col-b.recette@gmes.fr')
        await page.fill('#login-password', 'RecetteGMES@2026!')
        await page.click('.login-submit')
        await page.waitForURL('**/app/**', { timeout: 10000 })
        await page.goto(`${config.FRONTEND_URL}/app/new-absence`, { waitUntil: 'networkidle' })
        uiTitle = (await page.locator('h1').first().textContent().catch(() => ''))?.includes('Déclarer une absence') ?? false
        await page.close()
      } catch { uiTitle = false }
      const created = res.status === 201 || res.status === 200
      const empSelf = res.data?.employeeId === colB.id || res.data?.employee?.id === colB.id
      const draft = res.data?.status === 'BROUILLON'
      const ok = created && empSelf && draft && before[0].n + 1 === after[0].n
      out.push(scenario('ABS-001', 'P1', 'Collaborateur B crée une déclaration d’absence', 'C - UI + API',
        ok ? 'Conforme' : 'Non conforme',
        `POST /absence-declarations HTTP=${res.status} | created=${created} | employeeId=self=${empSelf} | status=${res.data?.status} | BDD avant=${before[0].n} après=${after[0].n} | UI NewAbsence=${uiTitle}`,
        'api+ui', ok ? '' : 'Écart constaté lors du retest ABS-001.', `allowedTypeId=${allowedTypeId}`))
    } catch (e) {
      out.push(scenario('ABS-001', 'P1', 'Collaborateur B crée une déclaration d’absence', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  // ===== ABS-002 : création pour autrui refusée =====
  {
    try {
      const before = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations WHERE employee_id = ?`, [colC.id])
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { employeeId: colC.id, leaveTypeId: allowedTypeId, startDate: '2026-12-11', endDate: '2026-12-11' },
      })
      const after = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations WHERE employee_id = ?`, [colC.id])
      const ruleReached = res.status === 403 && String(res.data?.message ?? '').includes('Seule la RH')
      const noMutation = before[0].n === after[0].n
      out.push(scenario('ABS-002', 'P2', 'Collaborateur ne déclare pas pour un collègue', 'C - UI + API',
        ruleReached && noMutation ? 'Conforme' : 'Non conforme',
        `POST HTTP=${res.status} message="${res.data?.message ?? ''}" | règleFine=${ruleReached} | mutationBDD=${!noMutation}`,
        'api+db', ruleReached && noMutation ? '' : 'Règle fine ou absence de mutation non vérifiée.', `employeeId=${colC.id}`))
    } catch (e) {
      out.push(scenario('ABS-002', 'P2', 'Collaborateur ne déclare pas pour un collègue', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  // ===== ABS-003 : type rhOnly refusé =====
  {
    try {
      const before = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations`)
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId: rhOnlyTypeId, startDate: '2026-12-12', endDate: '2026-12-12' },
      })
      const after = await dbQuery(`SELECT COUNT(*) AS n FROM absence_declarations`)
      const ruleReached = res.status === 403 && /uniquement par la RH/i.test(String(res.data?.message ?? ''))
      const noMutation = before[0].n === after[0].n
      out.push(scenario('ABS-003', 'P1', 'Type réservé à la RH refusé au collaborateur', 'C - UI + API',
        ruleReached && noMutation ? 'Conforme' : 'Non conforme',
        `POST HTTP=${res.status} message="${res.data?.message ?? ''}" | règleRhOnly=${ruleReached} | mutationBDD=${!noMutation}`,
        'api+db', ruleReached && noMutation ? '' : 'Règle rhOnly non atteinte.', `rhOnlyTypeId=${rhOnlyTypeId}`))
    } catch (e) {
      out.push(scenario('ABS-003', 'P1', 'Type réservé à la RH refusé au collaborateur', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  // ===== ABS-004 : soumission propre =====
  {
    try {
      const draft = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId: allowedTypeId, startDate: '2026-12-15', endDate: '2026-12-15', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' },
      })
      const draftId = draft.data?.id
      const statusBefore = draft.data?.status
      const res = await apiRequest(`/absence-declarations/${draftId}/submit`, {
        method: 'POST',
        token: colBToken,
        body: { certifiedAccurate: true },
      })
      const statusAfter = res.data?.status
      let uiSubmit = false
      try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
        await page.fill('#login-email', 'col-b.recette@gmes.fr')
        await page.fill('#login-password', 'RecetteGMES@2026!')
        await page.click('.login-submit')
        await page.waitForURL('**/app/**', { timeout: 10000 })
        await page.goto(`${config.FRONTEND_URL}/app/my-requests/absence/${draftId}`, { waitUntil: 'networkidle' })
        uiSubmit = await page.getByText('Soumettre la déclaration').count().catch(() => 0) > 0
        await page.close()
      } catch { uiSubmit = false }
      const ok = res.status === 200 && statusBefore === 'BROUILLON' && ['A_VERIFIER_PAR_RH', 'JUSTIFICATIF_EN_ATTENTE', 'ENREGISTREE'].includes(statusAfter)
      out.push(scenario('ABS-004', 'P1', 'Collaborateur B soumet sa déclaration', 'C - UI + API',
        ok ? 'Conforme' : 'Non conforme',
        `submit HTTP=${res.status} | avant=${statusBefore} | après=${statusAfter} | UI bouton=${uiSubmit}`,
        'api+ui', ok ? '' : 'Soumission non conforme.', `draftId=${draftId}`))
    } catch (e) {
      out.push(scenario('ABS-004', 'P1', 'Collaborateur B soumet sa déclaration', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  // ===== ABS-017 : annulation brouillon propre + négatif =====
  {
    try {
      const draft = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colBToken,
        body: { leaveTypeId: allowedTypeId, startDate: '2026-12-16', endDate: '2026-12-16' },
      })
      const draftId = draft.data?.id
      const statusBefore = draft.data?.status
      const res = await apiRequest(`/absence-declarations/${draftId}/cancel`, { method: 'POST', token: colBToken })
      const statusAfter = res.data?.status

      // négatif : colB tente d'annuler le brouillon de colC
      const colCDraft = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: colCToken,
        body: { leaveTypeId: allowedTypeId, startDate: '2026-12-17', endDate: '2026-12-17' },
      })
      const neg = await apiRequest(`/absence-declarations/${colCDraft.data?.id}/cancel`, { method: 'POST', token: colBToken })

      const ok = res.status === 200 && statusBefore === 'BROUILLON' && statusAfter === 'ANNULEE'
      const negOk = neg.status === 403
      out.push(scenario('ABS-017', 'P1', 'Collaborateur annule son brouillon d’absence', 'C - UI + API',
        ok && negOk ? 'Conforme' : 'Non conforme',
        `cancel HTTP=${res.status} | avant=${statusBefore} | après=${statusAfter} | ownership négatif HTTP=${neg.status} message="${neg.data?.message ?? ''}"`,
        'api', ok && negOk ? '' : 'Annulation ou contrôle ownership en échec.', `draftId=${draftId}`))
    } catch (e) {
      out.push(scenario('ABS-017', 'P1', 'Collaborateur annule son brouillon d’absence', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  await browser.close()

  // Non-régression légère : ABS-016 (RH crée pour collaborateur) via API
  {
    try {
      const res = await apiRequest('/absence-declarations', {
        method: 'POST',
        token: rhToken,
        body: { employeeId: colC.id, leaveTypeId: allowedTypeId, startDate: '2026-12-18', endDate: '2026-12-18' },
      })
      out.push(scenario('ABS-016', 'P1', 'RH crée une absence pour un collaborateur', 'C - UI + API',
        res.status === 201 || res.status === 200 ? 'Conforme' : 'Non conforme',
        `POST RH HTTP=${res.status} | employeeId=${res.data?.employeeId ?? res.data?.employee?.id}`,
        'api', '', ''))
    } catch (e) {
      out.push(scenario('ABS-016', 'P1', 'RH crée une absence pour un collaborateur', 'C - UI + API', 'Bloqué', e.message, '', e.message, ''))
    }
  }

  writeFileSync(path.join(REPORTS_DIR, 'retest-lot1-absences.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log('RETEST_LOT1 terminé. Scénarios observés :')
  for (const s of out) {
    console.log(`  ${s.id}: ${s.status} — ${s.result}`)
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
