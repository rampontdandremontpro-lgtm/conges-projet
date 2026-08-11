import { Icon } from '@/components/ui/Icon'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { CardSkeleton, CardError } from '@/components/dashboard/DashboardStates'
import { formatDateFR, formatDays, daysBetween, todayISO } from '@/utils/format'

function countdownLabel(startIso) {
  const days = daysBetween(todayISO(), startIso)
  if (days <= 0) return "Aujourd'hui"
  if (days === 1) return 'Demain'
  return `J-${days}`
}

export function NextLeaveCard({ nextLeave, loading, error, onRetry }) {
  let content

  if (loading) {
    content = <CardSkeleton rows={2} />
  } else if (error) {
    content = <CardError onRetry={onRetry} />
  } else if (!nextLeave) {
    content = (
      <div className="dash-empty">
        <span className="dash-empty__icon">
          <Icon name="sun" size={24} />
        </span>
        <p className="dash-empty__title">Aucun congé à venir</p>
        <p className="dash-empty__text">
          Planifiez votre prochaine période de congé.
        </p>
      </div>
    )
  } else {
    content = (
      <div className="next-leave">
        <div className="next-leave__countdown">
          <span className="next-leave__countdown-value">{countdownLabel(nextLeave.startDate)}</span>
          <span className="next-leave__countdown-label">avant le départ</span>
        </div>
        <div className="next-leave__info">
          <span className="next-leave__type">{nextLeave.leaveType.name}</span>
          <span className="next-leave__dates">
            {formatDateFR(nextLeave.startDate)} – {formatDateFR(nextLeave.endDate)}
          </span>
          <span className="next-leave__duration">
            {nextLeave.calendarDuration} jour{nextLeave.calendarDuration > 1 ? 's' : ''} ·{' '}
            {formatDays(nextLeave.deductedDays)} jour{nextLeave.deductedDays > 1 ? 's' : ''} déduit
            {nextLeave.deductedDays > 1 ? 's' : ''}
          </span>
          <div className="next-leave__status">
            <StatusBadge status={nextLeave.status} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Prochain congé</h2>
      </header>
      {content}
    </section>
  )
}
