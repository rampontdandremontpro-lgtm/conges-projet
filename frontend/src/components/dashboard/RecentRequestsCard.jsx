import { Icon } from '@/components/ui/Icon'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { CardSkeleton, CardError } from '@/components/dashboard/DashboardStates'
import { formatDateRangeFR, formatDays } from '@/utils/format'

export function RecentRequestsCard({ requests, loading, error, onRetry, onViewAll }) {
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
      <>
        <ul className="recent-list">
          {requests.map((request) => (
            <li key={request.id} className="recent-row">
              <span className="recent-row__dot" aria-hidden="true" />
              <div className="recent-row__main">
                <span className="recent-row__type">{request.leaveType.name}</span>
                <span className="recent-row__period">
                  {formatDateRangeFR(request.startDate, request.endDate)} ·{' '}
                  {formatDays(request.deductedDays)} j
                </span>
              </div>
              <StatusBadge status={request.status} />
            </li>
          ))}
        </ul>
        <button type="button" className="dash-link-btn" onClick={onViewAll}>
          Voir tout
          <Icon name="arrowRight" size={16} />
        </button>
      </>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Demandes récentes</h2>
      </header>
      {content}
    </section>
  )
}
