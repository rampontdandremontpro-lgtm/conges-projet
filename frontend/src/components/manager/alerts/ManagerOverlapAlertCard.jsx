import { Icon } from '@/components/ui/Icon'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

function initials(person) {
  return `${person?.prenom?.[0] ?? ''}${person?.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function overlapSourceLabel(source) {
  return source === 'DECLARATION_ABSENCE' ? 'Absence' : 'Demande de congé'
}

function overlapStatusLabel(status) {
  const labels = {
    EN_ATTENTE_VALIDATION: 'En attente',
    VALIDEE: 'Validée',
    DECLAREE: 'Déclarée',
    JUSTIFICATIF_EN_ATTENTE: 'Justificatif en attente',
    A_VERIFIER_PAR_RH: 'À vérifier par RH',
    JUSTIFICATIF_REJETE: 'Justificatif rejeté',
    ENREGISTREE: 'Enregistrée',
  }
  return labels[status] ?? status ?? '—'
}

function handleCardKeyDown(event, onOpen) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onOpen()
  }
}

export function ManagerOverlapAlertCard({ request, availability, onOpen }) {
  const overlaps = availability?.overlaps ?? []
  const hasPresenceAlert = Boolean(availability?.minimumPresenceBreached)

  return (
    <article
      className="manager-overlap-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(request.id)}
      onKeyDown={(event) => handleCardKeyDown(event, () => onOpen(request.id))}
      aria-label={`Voir la demande de ${request.employee?.prenom ?? ''} ${request.employee?.nom ?? ''}`}
    >
      <div className="manager-overlap-card__request">
        <span className="manager-overlap-card__avatar">{initials(request.employee)}</span>
        <div className="manager-overlap-card__request-content">
          <div className="manager-overlap-card__topline">
            <strong>{request.employee?.prenom} {request.employee?.nom}</strong>
            <span className="manager-overlap-badge manager-overlap-badge--warning">
              <Icon name="alert" size={12} />
              {overlaps.length} chevauchement{overlaps.length > 1 ? 's' : ''}
            </span>
            {hasPresenceAlert && (
              <span className="manager-overlap-badge manager-overlap-badge--presence">
                Présence minimale
              </span>
            )}
          </div>
          <div className="manager-overlap-card__request-meta">
            <span>{request.leaveType?.name ?? 'Demande de congé'}</span>
            <span>•</span>
            <span>{formatRangeNumericFR(request.startDate, request.endDate)}</span>
            <span>•</span>
            <strong>{formatDays(Number(request.deductedDays) || 0)} j</strong>
          </div>
        </div>
        <span className="manager-overlap-card__chevron" aria-hidden="true">›</span>
      </div>

      <div className="manager-overlap-card__divider" />

      <div className="manager-overlap-card__overlaps">
        <div className="manager-overlap-card__section-title">
          <span className="manager-overlap-card__section-icon"><Icon name="users" size={15} /></span>
          <div>
            <strong>Personnes déjà absentes ou en attente</strong>
            <small>Même service et période concomitante</small>
          </div>
        </div>

        <div className="manager-overlap-card__people">
          {overlaps.map((item) => (
            <div className="manager-overlap-person" key={`${item.source}-${item.sourceId}`}>
              <span className="manager-overlap-person__avatar">{initials(item)}</span>
              <span className="manager-overlap-person__identity">
                <strong>{item.prenom} {item.nom}</strong>
                <small>{overlapSourceLabel(item.source)} · {overlapStatusLabel(item.status)}</small>
              </span>
              <span className="manager-overlap-person__period">
                {formatRangeNumericFR(item.startDate, item.endDate)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {hasPresenceAlert && (
        <div className="manager-overlap-card__presence-warning">
          <Icon name="alert" size={14} />
          <span>
            Si cette demande est validée, il restera au minimum <strong>{availability.minimumRemainingEmployees}</strong> personne(s)
            présente(s), pour un seuil de <strong>{availability.minimumPresence}</strong>.
          </span>
        </div>
      )}
    </article>
  )
}
