import { apiRequest } from '../helpers/api.mjs'

export const BALANCE_FIXTURE = {
  rh: { email: 'rh.recette@gmes.fr', password: 'RecetteGMES@2026!' },
  colA: { email: 'col-a.recette@gmes.fr', password: 'RecetteGMES@2026!' },
  colB: { email: 'col-b.recette@gmes.fr', password: 'RecetteGMES@2026!' },
}

export async function loginRecette(email, password) {
  const { status, data } = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  if (status !== 200 || !data?.accessToken) {
    throw new Error(`Connexion impossible pour ${email} (HTTP ${status})`)
  }
  return data
}

export async function findUserByEmail(token, email) {
  const { status, data } = await apiRequest('/users', { token })
  if (status !== 200) {
    throw new Error(`Impossible de lister les utilisateurs (HTTP ${status})`)
  }
  const user = (Array.isArray(data) ? data : []).find((item) => item.email === email)
  if (!user) {
    throw new Error(`Utilisateur introuvable : ${email}`)
  }
  return user
}

export async function setupBalancesFixture() {
  const rhLogin = await loginRecette(BALANCE_FIXTURE.rh.email, BALANCE_FIXTURE.rh.password)
  const rhToken = rhLogin.accessToken

  const colA = await findUserByEmail(rhToken, BALANCE_FIXTURE.colA.email)
  const colB = await findUserByEmail(rhToken, BALANCE_FIXTURE.colB.email)

  // Tous les compteurs partagent la même période de référence cadre 2026-2027.
  // Le service calcule la période de droits affichée en décalant selon counterType.
  const periods = [
    { referencePeriod: '2026-2027', counterType: 'N-1', acquiredDays: 10 },
    { referencePeriod: '2026-2027', counterType: 'N', acquiredDays: 15 },
    { referencePeriod: '2026-2027', counterType: 'N+1', acquiredDays: 20 },
  ]

  const initialized = []
  for (const period of periods) {
    const { status, data } = await apiRequest('/leave-balances/initialize', {
      method: 'POST',
      token: rhToken,
      body: {
        employeeId: colA.id,
        referencePeriod: period.referencePeriod,
        counterType: period.counterType,
        acquiredDays: period.acquiredDays,
        reason: 'Fixture recette BAL — précondition de consultation.',
      },
    })
    if (status !== 201 && status !== 200) {
      // 409 = déjà initialisé lors d'une exécution précédente : la fixture reste valide.
      if (status !== 409) {
        throw new Error(`Initialisation échouée pour ${period.referencePeriod} ${period.counterType} (HTTP ${status}) : ${JSON.stringify(data)}`)
      }
    }
    initialized.push({ ...period, status })
  }

  return {
    rh: { id: rhLogin.user?.id, email: rhLogin.user?.email },
    colA: { id: colA.id, email: colA.email },
    colB: { id: colB.id, email: colB.email },
    periods,
    initialized,
  }
}

export async function readEmployeeBalancesAsRh(rhToken, employeeId) {
  return apiRequest(`/leave-balances/employee/${employeeId}`, { token: rhToken })
}
