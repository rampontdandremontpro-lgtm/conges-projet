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

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`)
}

function dateKey(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function businessDaysForUser(startDate, endDate, hireDate, holidayDates) {
  const effectiveStart = hireDate && hireDate > startDate ? hireDate : startDate
  if (effectiveStart > endDate) return 0

  const current = utcDate(effectiveStart)
  const end = utcDate(endDate)
  let total = 0

  while (current.getTime() <= end.getTime()) {
    const weekday = current.getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !holidayDates.has(dateKey(current))) {
      total += 1
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return total
}

function roundRate(value, total) {
  if (total <= 0) return 0
  return Math.round(Math.max(0, (value / total) * 100) * 10) / 10
}

function buildAbsenteeism({ absences, absenceTypes, users, holidays, startDate, endDate }) {
  const holidayDates = new Set(
    holidays
      .filter((holiday) => holiday?.isActive !== false && holiday?.deductible === false)
      .map((holiday) => holiday.date)
      .filter(Boolean),
  )

  const capacityDays = users.reduce(
    (total, user) => total + businessDaysForUser(startDate, endDate, user.hireDate, holidayDates),
    0,
  )

  const byType = new Map(
    absenceTypes
      .filter((type) => type?.category === 'DECLARATION_ABSENCE')
      .map((type) => [String(type.name ?? 'Absence').trim() || 'Absence', 0]),
  )
  let absenceDays = 0

  for (const absence of absences) {
    if (
      absence?.status !== 'ENREGISTREE' ||
      !absence.startDate ||
      !absence.endDate ||
      absence.startDate > endDate ||
      absence.endDate < startDate
    ) {
      continue
    }

    const days = Number(absence.durationDays ?? 0)
    if (!Number.isFinite(days) || days <= 0) continue

    absenceDays += days
    const label = absence.leaveType?.name ?? 'Absence'
    byType.set(label, (byType.get(label) ?? 0) + days)
  }

  return {
    periodStart: startDate,
    periodEnd: endDate,
    globalRate: roundRate(absenceDays, capacityDays),
    absenceDays: Math.round(absenceDays * 100) / 100,
    capacityDays,
    byType: [...byType.entries()]
      .map(([label, days]) => ({
        label,
        days: Math.round(days * 100) / 100,
        rate: roundRate(days, capacityDays),
      }))
      .sort((left, right) => right.days - left.days || left.label.localeCompare(right.label, 'fr')),
  }
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
    urgencyRank: request.isUrgent ? 650 : request.finalDeciderId ? 500 : 300,
    dueDate: request.startDate ?? null,
    to: '/app/rh-all-requests',
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
    urgencyRank: 250,
    dueDate: absence.startDate ?? null,
    to: '/app/rh-absences',
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
    urgencyRank: 200,
    dueDate: null,
    to: '/app/rh-pdf-documents?tab=justificatifs',
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
    urgencyRank: 700,
    dueDate: derogation.requestedStartDate ?? null,
    to: '/app/rh-derogations?filter=pending',
  }))

  return [...leaveItems, ...absenceItems, ...documentItems, ...derogationItems]
    .sort((a, b) => {
      if ((b.urgencyRank ?? 0) !== (a.urgencyRank ?? 0)) {
        return (b.urgencyRank ?? 0) - (a.urgencyRank ?? 0)
      }
      const aDue = dateValue(a.dueDate)
      const bDue = dateValue(b.dueDate)
      if (aDue && bDue && aDue !== bDue) return aDue - bDue
      if (aDue && !bDue) return -1
      if (!aDue && bDue) return 1
      return dateValue(a.date) - dateValue(b.date)
    })
    .slice(0, 6)
}

export async function getRhDashboardData() {
  const today = martiniqueToday()
  const currentYearStart = `${today.slice(0, 4)}-01-01`

  const [
    leaveResult,
    absenceResult,
    documentsResult,
    derogationsResult,
    usersResult,
    holidaysResult,
    leaveTypesResult,
  ] = await Promise.allSettled([
    apiClient.get('/leave-requests/pending'),
    apiClient.get('/absence-declarations/management'),
    apiClient.get('/documents/management'),
    apiClient.get('/derogations/management'),
    apiClient.get('/users'),
    apiClient.get('/holidays', { params: { year: Number(today.slice(0, 4)) } }),
    apiClient.get('/leave-types/management'),
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
    (item) => item.status === RH_PENDING_DEROGATION_STATUS && !item.decidedByRhId,
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
    documentsToVerify.length +
    derogationsPending.length

  const absenteeism = buildAbsenteeism({
    absences: allAbsences,
    absenceTypes: resultValue(leaveTypesResult),
    users: activeUsers,
    holidays: resultValue(holidaysResult),
    startDate: currentYearStart,
    endDate: today,
  })

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
    absenteeism,
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
      resultFailed(holidaysResult) ? 'jours fériés (taux d’absentéisme)' : null,
      resultFailed(leaveTypesResult) ? 'types d’absence (taux d’absentéisme)' : null,
    ].filter(Boolean),
  }
}
