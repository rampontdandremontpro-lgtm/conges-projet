import { Icon } from '@/components/ui/Icon'
import { StatusBadge } from '@/components/collab/dashboard/StatusBadge'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'
import { formatDays, formatRangeNumericFR } from '@/utils/format'

export function RecentRequestsCard({ requests, loading, error, onRetry, onViewAll, onOpenRequest }) {
  let content

  if (loading) {
    content = <CardSkeleton rows={4} />
  } else if (error) {
    content = <CardError onRetry={onRetry} />
  } else if (!requests || requests.length === 0) {
    content = (
      <div className="dash-empty dash-empty--compact">
        <span className="dash-empty__icon">
          <Icon name="list" size={24} />
        </span>
        <p className="dash-empty__title">Aucune demande récente</p>
        <p className="dash-empty__text">Vos demandes de congé apparaîtront ici.</p>
      </div>
    )
  } else {
    content = (
      <ul className="recent-list">
        {requests.map((request) => (
          <li
            key={request.id}
            className="recent-row recent-row--clickable"
            role="button"
            tabIndex={0}
            aria-label={`Ouvrir le détail de ${request.leaveType?.name || 'la demande'}`}
            onClick={() => onOpenRequest?.(request)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenRequest?.(request)
              }
            }}
          >
            <span className="recent-row__icon" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
            <div className="recent-row__main">
              <div className="recent-row__top">
                <span className="recent-row__type">{request.leaveType.name}</span>
                <StatusBadge status={request.status} />
              </div>
              <span className="recent-row__period">
                {formatRangeNumericFR(request.startDate, request.endDate)}
                <span className="recent-row__duration"> · {formatDays(request.deductedDays)} j</span>
              </span>
            </div>
            <span className="recent-row__more" aria-hidden="true">
              <Icon name="chevronRight" size={17} />
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title dash-card__title--lg">Demandes récentes</h2>
        {!loading && !error && requests.length > 0 && (
          <button type="button" className="dash-card__view-all" onClick={onViewAll}>
            Voir tout
            <Icon name="arrowRight" size={14} />
          </button>
        )}
      </header>
      {content}
    </section>
  )
}
