import { apiClient } from '@/services/apiClient'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function buildPriorities(requests) {
  const rolePriority = {
    RH: 0,
    RESPONSABLE_SERVICE: 1,
    COLLABORATEUR: 2,
  }

  return [...requests]
    .sort((left, right) => {
      const leftPriority = rolePriority[left.employee?.role] ?? 3
      const rightPriority = rolePriority[right.employee?.role] ?? 3
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      const leftDate = dateValue(left.submittedAt ?? left.createdAt)
      const rightDate = dateValue(right.submittedAt ?? right.createdAt)
      if (leftDate !== rightDate) return leftDate - rightDate

      return Number(left.id ?? 0) - Number(right.id ?? 0)
    })
    .slice(0, 4)
}

function buildAttentionItems(requests, presence) {
  const items = []

  const rhRequests = requests.filter(
    (request) => request.employee?.role === 'RH',
  )
  if (rhRequests.length > 0) {
    items.push({
      id: 'rh-requests',
      tone: 'warning',
      text: `${rhRequests.length} demande${rhRequests.length > 1 ? 's' : ''} RH attend${rhRequests.length > 1 ? 'ent' : ''} votre décision.`,
      to: '/app/director-requests',
    })
  }

  const relayRequests = requests.filter(
    (request) => request.decisionAccess?.kind === 'RELAIS',
  )
  if (relayRequests.length > 0) {
    items.push({
      id: 'relay-requests',
      tone: 'info',
      text: `${relayRequests.length} demande${relayRequests.length > 1 ? 's' : ''} nécessite${relayRequests.length > 1 ? 'nt' : ''} actuellement un relais de validation.`,
      to: '/app/director-requests',
    })
  }

  const riskyServices = asArray(presence?.services).filter(
    (service) => service.minimumRespected === false,
  )
  for (const service of riskyServices.slice(0, 3)) {
    items.push({
      id: `service-${service.id ?? service.name}`,
      tone: 'danger',
      text: `${service.name} est sous le minimum de présence (${service.present}/${service.minimumPresence}).`,
      to: '/app/director-presence',
    })
  }

  return items.slice(0, 4)
}

export async function getDirectorDashboardData() {
  const [requestsResult, presenceResult] = await Promise.allSettled([
    apiClient.get('/leave-requests/director/pending'),
    apiClient.get('/users/management/global-presence'),
  ])

  const requests =
    requestsResult.status === 'fulfilled'
      ? asArray(requestsResult.value?.data)
      : []

  const presence =
    presenceResult.status === 'fulfilled'
      ? presenceResult.value?.data ?? null
      : null

  const responsibleRequests = requests.filter(
    (request) => request.employee?.role === 'RESPONSABLE_SERVICE',
  ).length
  const rhRequests = requests.filter(
    (request) => request.employee?.role === 'RH',
  ).length

  return {
    decisions: {
      total: requests.length,
      responsible: responsibleRequests,
      rh: rhRequests,
      others: Math.max(
        0,
        requests.length - responsibleRequests - rhRequests,
      ),
    },
    priorities: buildPriorities(requests),
    presence,
    attention: buildAttentionItems(requests, presence),
    partialErrors: [
      requestsResult.status === 'rejected' ? 'demandes à traiter' : null,
      presenceResult.status === 'rejected' ? 'présence globale' : null,
    ].filter(Boolean),
  }
}
