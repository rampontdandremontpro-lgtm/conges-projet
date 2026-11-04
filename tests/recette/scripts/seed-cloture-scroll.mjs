// Seed isolé : 25 collaborateurs avec soldes 2025-2026 pour tester le
// défilement de la page et le défilement interne de la fenêtre de clôture.
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const rh = await login('rh.recette@gmes.fr')
const admin = await login('admin.recette@gmes.fr')
if (!rh || !admin) throw new Error('Connexion impossible')

const TAG = 'SC' + Date.now().toString(36)

const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: 'SVC-' + TAG, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data

const db = await dbConn()

for (let i = 1; i <= 25; i += 1) {
  const email = `col-scroll-${i}.recette@gmes.fr`
  const created = await apiRequest('/users', {
    method: 'POST',
    token: admin,
    body: {
      nom: `COLS${String(i).padStart(2, '0')}`,
      prenom: 'Recette',
      email,
      role: 'COLLABORATEUR',
      employmentType: 'INTERNE',
      serviceId: svc.id,
      hireDate: '2026-01-06',
    },
  })
  if (created.status !== 201 && created.status !== 200) {
    console.log('KO create', email, created.status, created.data?.message)
    continue
  }
  const id = created.data?.id ?? created.data?.user?.id
  if (!id) { console.log('no id', email); continue }

  const reliquat = i % 3 === 0 ? 8 : i % 2 === 0 ? 5 : 0
  const negative = i === 25 ? -3 : 0
  const nMinus1 = negative !== 0 ? negative : reliquat
  await db.query(
    `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2025-2026', 'N-1', 10, 0, ?, ?)`,
    [id, nMinus1 < 0 ? 10 + Math.abs(nMinus1) : 10 - nMinus1, nMinus1],
  )
  await db.query(
    `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days) VALUES (?, '2025-2026', 'N', ?, 0, 0, ?)`,
    [id, 12 + (i % 5), 12 + (i % 5)],
  )
}

await db.end()
console.log('SEED SCROLL OK — 25 collaborateurs avec soldes 2025-2026')
