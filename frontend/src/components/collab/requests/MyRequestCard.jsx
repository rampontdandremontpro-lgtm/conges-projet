import { Icon } from '@/components/ui/Icon'
import { RequestStatusBadge } from '@/components/collab/requests/RequestStatusBadge'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

function formatDuration(item) {
  if (item.durationUnit === 'h') {
    return `${formatDays(item.duration)} h`
  }

  return `${formatDays(item.duration)} j`
}

export function MyRequestCard({ item }) {
  return (
    <article className="my-request-card">
      <span className="my-request-card__icon" aria-hidden="true">
        <Icon name="calendar" size={18} />
      </span>

      <div className="my-request-card__content">
        <div className="my-request-card__topline">
          <h2 className="my-request-card__title">{item.type}</h2>
          <RequestStatusBadge status={item.status} />
        </div>

        <p className="my-request-card__meta">
          <span>{formatRangeNumericFR(item.startDate, item.endDate)}</span>
          <span aria-hidden="true">·</span>
          <strong>{formatDuration(item)}</strong>
        </p>
      </div>

      <span className="my-request-card__more" aria-hidden="true">
        <Icon name="dots" size={17} />
      </span>
    </article>
  )
}
