import { Icon } from '@/components/ui/Icon'
import { StatusBadge } from '@/components/collab/dashboard/StatusBadge'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'
import {
  formatDays,
  daysBetween,
  formatRangeCompactFR,
  todayISO,
} from '@/utils/format'

function countdownLabel(startIso) {
  const days = daysBetween(todayISO(), startIso)
  if (days <= 0) return "Aujourd'hui"
  if (days === 1) return 'Demain'
  return `J-${days}`
}

function daysSplit(startIso) {
  const days = daysBetween(todayISO(), startIso)
  if (days <= 0) return { value: "Aujourd'hui", unit: null }
  if (days === 1) return { value: 'Demain', unit: null }
  return { value: String(days), unit: 'jours' }
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
    const dans = daysSplit(nextLeave.startDate)
    content = (
      <div className="next-leave">
        <div className="next-leave__stats">
          <div className="next-leave__stat">
            <span className="next-leave__stat-label">Dans</span>
            <span className="next-leave__stat-value">
              <strong className="next-leave__stat-figure">{dans.value}</strong>
              {dans.unit && <span className="next-leave__stat-unit">{dans.unit}</span>}
            </span>
          </div>
          <div className="next-leave__stat">
            <span className="next-leave__stat-label">Durée</span>
            <span className="next-leave__stat-value">
              <strong className="next-leave__stat-figure">{formatDays(nextLeave.deductedDays)}</strong>
              <span className="next-leave__stat-unit">jours ouvrables</span>
            </span>
          </div>
        </div>
        <div className="next-leave__panel">
          <span className="next-leave__dates">
            {formatRangeCompactFR(nextLeave.startDate, nextLeave.endDate)}
          </span>
          <span className="next-leave__type">{nextLeave.leaveType.name}</span>
        </div>
        <div className="next-leave__progress-row">
          <div className="next-leave__progress" aria-hidden="true">
            <div className="next-leave__progress-fill" />
          </div>
          <span className="next-leave__countdown">{countdownLabel(nextLeave.startDate)}</span>
        </div>
      </div>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Prochain congé</h2>
        {nextLeave && !loading && !error && <StatusBadge status={nextLeave.status} />}
      </header>
      {content}
    </section>
  )
}
