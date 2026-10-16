// Retest — arrondi légal L3141-7 à la clôture de période (cycle réel).
// Scénario : collaborateur embauché le 16/07/2024, période 2024-2025.
//   Juillet 2024 : 2,5 × 16/31 = 1,29 j ; août 2024 → mai 2025 : 10 × 2,5 = 25 j.
//   Total brut : 26,29 jours ouvrables → droit définitif attendu : 27 (entier sup.).
import { apiRequest, login } from '../helpers/runner-utils.mjs'

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api'
const TAG = 'L3141' + Date.now().toString(36)
const PERIOD = '2024-2025'

const rh = await login('rh.recette@gmes.fr')
if (!rh) throw new Error('Connexion RH impossible')
const admin = await login('admin.recette@gmes.fr')
if (!admin) throw new Error('Connexion ADMIN impossible')

const results = []
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function createUser(suffix, hireDate, exitDate) {
  const r = await apiRequest('/users', {
    method: 'POST', token: rh,
    body: {
      nom: 'ARRO', prenom: suffix, email: `arro.${suffix}.${TAG}@recette.fr`,
      role: 'COLLABORATEUR', employmentType: 'INTERNE',
      hireDate, serviceId: svc.id, ...(exitDate ? { exitDate } : {}),
    },
  })
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`createUser ${suffix} HTTP ${r.status} ${JSON.stringify(r.data)}`)
  }
  return r.data
}

const svc = (await apiRequest('/services', {
  method: 'POST', token: admin,
  body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false },
})).data

const mid = await createUser('mid', '2024-07-16', null)
const full = await createUser('full', '2024-06-01', null)
const exit = await createUser('exit', '2024-06-01', '2025-02-16')

// 1. Acquisition mensuelle 2024-07 → 2025-05.
const months = []
for (let y = 2024; y <= 2025; y++) {
  const lo = y === 2024 ? 6 : 1
  const hi = y === 2024 ? 12 : 5
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

async function balance(userId, counterType = 'N') {
  const r = await apiRequest(
    `/leave-balances/employee/${userId}?referencePeriod=${PERIOD}&counterType=${counterType}`,
    { token: rh },
  )
  return r.data?.[0] ?? null
}

const midBefore = await balance(mid.id, 'N')
const fullBefore = await balance(full.id, 'N')
const exitBefore = await balance(exit.id, 'N')
rec('avant clôture — embauche 16/07 : acquiredDays = 26,29',
  Number(midBefore?.acquiredDays) === 26.29, `acquiredDays=${midBefore?.acquiredDays}`)
rec('avant clôture — année pleine : acquiredDays = 30',
  Number(fullBefore?.acquiredDays) === 30, `acquiredDays=${fullBefore?.acquiredDays}`)
rec('avant clôture — départ 16/02/2025 : acquiredDays = 21,43',
  Number(exitBefore?.acquiredDays) === 21.43, `acquiredDays=${exitBefore?.acquiredDays}`)

// 2. Clôture de la période 2024-2025.
const close = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: PERIOD, confirm: true },
})
rec('clôture 2024-2025 acceptée', close.status === 201 || close.status === 200,
  `HTTP ${close.status}${close.data?.message ? ' ' + close.data.message : ''}`)

const byEmp = Object.fromEntries((close.data?.employees ?? []).map((e) => [e.employeeId, e]))
const midClose = byEmp[mid.id]
const fullClose = byEmp[full.id]
const exitClose = byEmp[exit.id]
rec('embauche 16/07 : supplément d’arrondi = 0,71',
  Number(midClose?.roundingSupplement) === 0.71, `supplement=${midClose?.roundingSupplement}`)
rec('embauche 16/07 : transfert N→N-1 = 27',
  Number(midClose?.transferredFromN) === 27, `transferred=${midClose?.transferredFromN}`)
rec('année pleine : supplément = 0 (30 → 30)',
  Number(fullClose?.roundingSupplement) === 0, `supplement=${fullClose?.roundingSupplement}`)
rec('départ 16/02/2025 : supplément = 0,57 (21,43 → 22)',
  Number(exitClose?.roundingSupplement) === 0.57, `supplement=${exitClose?.roundingSupplement}`)

// 3. Soldes après clôture.
const midTarget = await apiRequest(
  `/leave-balances/employee/${mid.id}?referencePeriod=2025-2026&counterType=N-1`,
  { token: rh },
)
rec('après clôture — N-1 2025-2026 reçoit 27 jours',
  Number(midTarget?.data?.[0]?.availableDays) === 27,
  `availableDays=${midTarget?.data?.[0]?.availableDays}`)

// 4. Traçabilité du mouvement d'arrondi.
const history = await apiRequest(
  `/leave-balances/employee/${mid.id}/history?referencePeriod=${PERIOD}`,
  { token: rh },
)
const arrondiMovement = (history.data ?? []).find((m) =>
  String(m.reason ?? '').startsWith('CLOTURE_ARRONDI_L3141_7'))
rec('mouvement tracé CLOTURE_ARRONDI_L3141_7 (+0,71)',
  Number(arrondiMovement?.days) === 0.71,
  `days=${arrondiMovement?.days} type=${arrondiMovement?.movementType}`)

// 5. Idempotence : une seconde clôture est refusée.
const closeAgain = await apiRequest('/leave-balances/period/close', {
  method: 'POST', token: rh, body: { referencePeriod: PERIOD, confirm: true },
})
rec('idempotence : seconde clôture refusée (409)',
  closeAgain.status === 409, `HTTP ${closeAgain.status}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\nRÉSULTAT : ${results.length - failed}/${results.length} OK, ${failed} KO`)
process.exitCode = failed > 0 ? 1 : 0
