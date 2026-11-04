// Vérification du supplément L3141-7 dans la prévisualisation :
// acquisition réelle 26,29 → supplément 0,71 → nToTransfer = 27.
import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'PREVL3' + Date.now().toString(36)
const PERIOD = '2024-2025'

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
if (!rh || !admin) throw new Error('Connexion impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
const emp = (await apiRequest('/users', { method: 'POST', token: rh, body: {
  nom: 'ARRONDI', prenom: 'Preview', email: `prevl3.${TAG}@recette.fr`,
  role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2024-07-16', serviceId: svc.id,
} })).data

// Acquisition réelle 2024-07 → 2025-05 (1,29 + 25 = 26,29).
for (let y = 2024; y <= 2025; y++) {
  const lo = y === 2024 ? 7 : 1
  const hi = y === 2024 ? 12 : 5
  for (let m = lo; m <= hi; m++) {
    const month = `${y}-${String(m).padStart(2, '0')}`
    const r = await apiRequest('/leave-balances/accrual/run', { method: 'POST', token: rh, body: { accrualMonth: month } })
    if (r.status !== 201 && r.status !== 200) {
      throw new Error(`accrual ${month} HTTP ${r.status} ${JSON.stringify(r.data)}`)
    }
  }
}

const prev = await apiRequest(`/leave-balances/period/${PERIOD}/preview`, { token: rh })
rec('prévisualisation 200', prev.status === 200, `HTTP ${prev.status}`)
const byId = Object.fromEntries((prev.data?.employees ?? []).map((e) => [e.employeeId, e]))
const row = byId[emp.id]
rec('supplément L3141-7 = 0,71', Number(row?.roundingSupplement) === 0.71, `supplement=${row?.roundingSupplement}`)
rec('nToTransfer = 27 (26,29 + 0,71 → 27)', Number(row?.nToTransfer) === 27, `nToTransfer=${row?.nToTransfer}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
