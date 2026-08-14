import { apiClient } from '@/services/apiClient'

const RH_ABSENCE_ACTION_STATUSES = new Set(['A_VERIFIER_PAR_RH'])
const RH_PENDING_DOCUMENT_STATUS = 'EN_ATTENTE'
const RH_PENDING_DEROGATION_STATUS = 'EN_ATTENTE_RH'
const RH_PENDING_LEAVE_STATUS = 'EN_ATTENTE_VALIDATION'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function resultValue(result) {
  return result.status === 'fulfilled' ? asArray(result.value?.data) : []
}

function resultFailed(result) {
  return result.status === 'rejected'
}

function itemDate(item) {
  return (
    item.submittedAt ??
    item.declaredAt ??
    item.uploadedAt ??
    item.requestedAt ??
    item.createdAt ??
    null
  )
}

function dateValue(value) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function buildPriorityItems({
  leaveRequests,
  absences,
  documents,
  derogations,
}) {
  const leaveItems = leaveRequests.map((request) => ({
    id: `leave-${request.id}`,
    kind: 'leave',
    sourceId: request.id,
    label: request.leaveType?.name ?? 'Demande de congé',
    title: `${request.employee?.prenom ?? ''} ${request.employee?.nom ?? ''}`.trim() || 'Collaborateur',
    subtitle: request.service?.name ?? 'Service non renseigné',
    meta: request.startDate && request.endDate
      ? `${request.startDate} → ${request.endDate}`
      : 'Demande en attente',
    date: itemDate(request),
    urgent: Boolean(request.isUrgent),
    to: '/app/rh-requests',
  }))

  const absenceItems = absences.map((absence) => ({
    id: `absence-${absence.id}`,
    kind: 'absence',
    sourceId: absence.id,
    label: absence.leaveType?.name ?? 'Déclaration d’absence',
    title: `${absence.employee?.prenom ?? ''} ${absence.employee?.nom ?? ''}`.trim() || 'Collaborateur',
    subtitle: absence.service?.name ?? 'Service non renseigné',
    meta: absence.startDate && absence.endDate
      ? `${absence.startDate} → ${absence.endDate}`
      : 'À vérifier par la RH',
    date: itemDate(absence),
    urgent: false,
    to: '/app/absences',
  }))

  const documentItems = documents.map((document) => ({
    id: `document-${document.id}`,
    kind: 'document',
    sourceId: document.id,
    label: 'Justificatif à vérifier',
    title: document.originalName ?? `Justificatif n°${document.id}`,
    subtitle: document.absenceDeclarationId
      ? `Déclaration d’absence n°${document.absenceDeclarationId}`
      : document.leaveRequestId
        ? `Demande n°${document.leaveRequestId}`
        : 'Document',
    meta: 'En attente de vérification RH',
    date: itemDate(document),
    urgent: false,
    to: '/app/documents-exports',
  }))

  const derogationItems = derogations.map((derogation) => ({
    id: `derogation-${derogation.id}`,
    kind: 'derogation',
    sourceId: derogation.id,
    label: 'Dérogation à traiter',
    title: `${derogation.employee?.prenom ?? ''} ${derogation.employee?.nom ?? ''}`.trim() || 'Collaborateur',
    subtitle: derogation.leaveType?.name ?? 'Demande de dérogation',
    meta: derogation.requestedStartDate && derogation.requestedEndDate
      ? `${derogation.requestedStartDate} → ${derogation.requestedEndDate}`
      : 'Décision RH requise',
    date: itemDate(derogation),
    urgent: true,
    to: '/app/derogations',
  }))

  return [...leaveItems, ...absenceItems, ...documentItems, ...derogationItems]
    .sort((a, b) => dateValue(b.date) - dateValue(a.date))
    .slice(0, 6)
}

export async function getRhDashboardData() {
  const [
    leaveResult,
    absenceResult,
    documentsResult,
    derogationsResult,
    usersResult,
  ] = await Promise.allSettled([
    apiClient.get('/leave-requests/pending'),
    apiClient.get('/absence-declarations/management'),
    apiClient.get('/documents/management'),
    apiClient.get('/derogations/management'),
    apiClient.get('/users'),
  ])

  const leaveRequests = resultValue(leaveResult).filter(
    (item) => item.status === RH_PENDING_LEAVE_STATUS,
  )
  const allAbsences = resultValue(absenceResult)
  const absencesToVerify = allAbsences.filter((item) =>
    RH_ABSENCE_ACTION_STATUSES.has(item.status),
  )
  const waitingJustificatifs = allAbsences.filter(
    (item) => item.status === 'JUSTIFICATIF_EN_ATTENTE',
  )
  const documentsToVerify = resultValue(documentsResult).filter(
    (item) =>
      item.documentKind === 'JUSTIFICATIF' &&
      item.status === RH_PENDING_DOCUMENT_STATUS &&
      !item.deletedAt,
  )
  const derogationsPending = resultValue(derogationsResult).filter(
    (item) => item.status === RH_PENDING_DEROGATION_STATUS,
  )

  const activeUsers = resultValue(usersResult).filter(
    (user) => user.isActive !== false && user.role !== 'ADMIN',
  )
  const presentUsers = activeUsers.filter(
    (user) => user.presenceStatus === 'PRESENT',
  )
  const onLeaveUsers = activeUsers.filter(
    (user) => user.presenceStatus === 'EN_VACANCES',
  )
  const absentUsers = activeUsers.filter(
    (user) => user.presenceStatus === 'ABSENT',
  )
  const unavailableUsers = [...onLeaveUsers, ...absentUsers].sort((a, b) => {
    const lastName = String(a.nom ?? '').localeCompare(String(b.nom ?? ''), 'fr')
    if (lastName !== 0) return lastName
    return String(a.prenom ?? '').localeCompare(String(b.prenom ?? ''), 'fr')
  })

  const urgentLeaveRequests = leaveRequests.filter(
    (item) => item.isUrgent,
  )

  const totalToProcess =
    leaveRequests.length +
    absencesToVerify.length +
    documentsToVerify.length +
    derogationsPending.length

  return {
    generatedAt: new Date().toISOString(),
    workload: {
      total: totalToProcess,
      leaveRequests: leaveRequests.length,
      absences: absencesToVerify.length,
      documents: documentsToVerify.length,
      derogations: derogationsPending.length,
      urgentLeaveRequests: urgentLeaveRequests.length,
    },
    presence: {
      total: activeUsers.length,
      present: presentUsers.length,
      onLeave: onLeaveUsers.length,
      absent: absentUsers.length,
      unavailable: unavailableUsers.length,
      percentage:
        activeUsers.length > 0
          ? Math.round((presentUsers.length / activeUsers.length) * 100)
          : 100,
      members: unavailableUsers.slice(0, 5),
    },
    priorities: buildPriorityItems({
      leaveRequests,
      absences: absencesToVerify,
      documents: documentsToVerify,
      derogations: derogationsPending,
    }),
    alerts: {
      urgentRequests: urgentLeaveRequests.length,
      waitingJustificatifs: waitingJustificatifs.length,
      documentsToVerify: documentsToVerify.length,
      derogationsPending: derogationsPending.length,
    },
    partialErrors: [
      resultFailed(leaveResult) ? 'demandes' : null,
      resultFailed(absenceResult) ? 'absences' : null,
      resultFailed(documentsResult) ? 'documents' : null,
      resultFailed(derogationsResult) ? 'dérogations' : null,
      resultFailed(usersResult) ? 'utilisateurs' : null,
    ].filter(Boolean),
  }
}
