import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

function initials(employee) {
  return `${employee?.nom?.[0] ?? ''}${employee?.prenom?.[0] ?? ''}`.toUpperCase() || '—'
}

function formatSubmittedAt(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ManagerRequestCard({ request, availability, onOpen }) {
  const overlapCount = availability?.overlaps?.length ?? 0
  const hasPresenceAlert = Boolean(availability?.minimumPresenceBreached)
  const hasAlert = overlapCount > 0 || hasPresenceAlert

  return (
    <button
      type="button"
      className="manager-requests-card"
      onClick={() => onOpen(request.id)}
    >
      <span className="manager-requests-card__avatar">{initials(request.employee)}</span>

      <span className="manager-requests-card__content">
        <span className="manager-requests-card__topline">
          <strong>{request.employee?.nom} {request.employee?.prenom}</strong>
          {request.isUrgent ? (
            <span className="manager-requests-badge manager-requests-badge--urgent">
              <Icon name="alert" size={12} />
              Urgente
            </span>
          ) : (
            <span className="manager-requests-badge manager-requests-badge--pending">
              <Icon name="clock" size={12} />
              En attente
            </span>
          )}
          {hasAlert && (
            <span className="manager-requests-badge manager-requests-badge--alert">
              <Icon name="alert" size={12} />
              Alerte service
            </span>
          )}
        </span>

        <span className="manager-requests-card__subtitle">
          {request.leaveType?.name ?? 'Demande de congé'}
        </span>

        <span className="manager-requests-card__meta-grid">
          <span>
            <small>Période</small>
            <b>{formatRangeNumericFR(request.startDate, request.endDate)}</b>
          </span>
          <span>
            <small>Durée</small>
            <b>{formatDays(Number(request.deductedDays) || 0)} j</b>
          </span>
          <span>
            <small>Soumise le</small>
            <b>{formatSubmittedAt(request.submittedAt)}</b>
          </span>
        </span>

        {hasAlert && (
          <span className="manager-requests-card__alert-line">
            <Icon name="alert" size={13} />
            {hasPresenceAlert
              ? `Présence minimale non respectée : ${availability.minimumRemainingEmployees} personne(s) restante(s) pour un minimum de ${availability.minimumPresence}.`
              : `${overlapCount} absence(s) ou demande(s) concomitante(s) sur la période.`}
          </span>
        )}
      </span>

      <span className="manager-requests-card__chevron" aria-hidden="true">
        <Icon name="chevronRight" size={18} />
      </span>
    </button>
  )
}
