import { Icon } from '@/components/ui/Icon'
import { RequestStatusBadge } from '@/components/collab/requests/RequestStatusBadge'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

function formatDuration(item) {
  if (item.durationUnit === 'h') {
    return `${formatDays(item.duration)} h`
  }

  return `${formatDays(item.duration)} j`
}

function actionMeta(item) {
  if (item.status === 'BROUILLON' && item.source === 'leave') {
    return { type: 'delete', icon: 'trash', label: 'Supprimer le brouillon' }
  }

  if (item.source === 'leave' && ['EN_ATTENTE_VALIDATION', 'EN_COURS_TRAITEMENT'].includes(item.status)) {
    return { type: 'summary', icon: 'download', label: 'Télécharger le récapitulatif' }
  }

  if (
    item.source === 'leave' &&
    item.canDownloadPdf &&
    ['VALIDEE', 'ANNULATION_EN_ATTENTE_ACCORD', 'ANNULEE_APRES_VALIDATION'].includes(item.status)
  ) {
    return { type: 'download', icon: 'download', label: 'Télécharger le PDF' }
  }

  return { type: 'open', icon: 'chevronRight', label: 'Ouvrir le détail' }
}

export function MyRequestCard({ item, busy = false, onOpen, onAction }) {
  const action = actionMeta(item)

  const handleOpen = () => {
    if (!busy) onOpen?.(item)
  }

  const handleKeyDown = (event) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpen()
    }
  }

  return (
    <article
      className={`my-request-card${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir ${item.type}`}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      <span className="my-request-card__icon" aria-hidden="true">
        <Icon name="calendar" size={18} />
      </span>

      <div className="my-request-card__content">
        <div className="my-request-card__topline">
          <h2 className="my-request-card__title">{item.type}</h2>
          <div className="my-request-card__badges">
            {item.isAnticipatedLeave && <span className="my-request-card__anticipated">Congé anticipé</span>}
            {item.preparedByRh && <span className="my-request-card__prepared">Préparée par la RH</span>}
            <RequestStatusBadge status={item.status} />
          </div>
        </div>

        <p className="my-request-card__meta">
          <span>{formatRangeNumericFR(item.startDate, item.endDate)}</span>
          <span aria-hidden="true">·</span>
          <strong>{formatDuration(item)}</strong>
        </p>
      </div>

      <button
        type="button"
        className={`my-request-card__action my-request-card__action--${action.type}`}
        title={action.label}
        aria-label={action.label}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation()
          if (action.type === 'open') {
            onOpen?.(item)
          } else {
            onAction?.(item, action.type)
          }
        }}
      >
        <Icon name={action.icon} size={17} />
      </button>
    </article>
  )
}
