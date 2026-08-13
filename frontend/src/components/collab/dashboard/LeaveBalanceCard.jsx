import { Icon } from '@/components/ui/Icon'
import { formatDays, formatPeriod } from '@/utils/format'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'

export function LeaveBalanceCard({ summary, loading, error, onRetry }) {
  let content

  if (loading) {
    content = <CardSkeleton rows={4} />
  } else if (error) {
    content = <CardError onRetry={onRetry} />
  } else if (!summary) {
    content = (
      <div className="dash-empty">
        <span className="dash-empty__icon dash-empty__icon--muted">
          <Icon name="wallet" size={24} />
        </span>
        <p className="dash-empty__title">Aucun solde disponible</p>
        <p className="dash-empty__text">
          Votre solde de congés apparaîtra ici dès qu&apos;il sera initialisé.
        </p>
      </div>
    )
  } else {
    const realBalance = Number(summary.availableDays) || 0
    const reserved = Number(summary.reservedDays) || 0
    const potential = Number(summary.potentialDays) || 0
    const acquisition = Number(summary.currentAccrualDays) || 0
    const progress = realBalance > 0 ? Math.min(100, (potential / realBalance) * 100) : 0
    const reservedLabel = reserved > 0 ? `-${formatDays(reserved)} j` : `${formatDays(reserved)} j`

    content = (
      <>
        <div className="balance-hero">
          <span className="balance-hero__number">{formatDays(realBalance)}</span>
          <span className="balance-hero__label">
            <span>jours</span>
            <span>à utiliser</span>
          </span>
        </div>
        <div
          className="balance-progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(progress)}
          aria-label="Disponible après réservations"
        >
          <div className="balance-progress__fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="balance-summary">
          <span>
            <strong>{formatDays(realBalance)}</strong> disponibles aujourd&apos;hui
          </span>
          <span>
            <strong>{formatDays(acquisition)}</strong> en cours d&apos;acquisition
          </span>
        </div>
        <div className="balance-pills">
          <div className="balance-pill balance-pill--cyan">
            <span className="balance-pill__label">En acquisition</span>
            <strong>{formatDays(acquisition)} j</strong>
          </div>
          <div className="balance-pill balance-pill--orange">
            <span className="balance-pill__label">Réservé</span>
            <strong>{reservedLabel}</strong>
          </div>
          <div className="balance-pill balance-pill--green">
            <span className="balance-pill__label">Après réservations</span>
            <strong>{formatDays(potential)} j</strong>
          </div>
        </div>
      </>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Congés à utiliser</h2>
          {summary && !loading && !error && (
            <span className="dash-card__period">Période {formatPeriod(summary.referencePeriod)}</span>
          )}
        </div>
        {summary && !loading && !error && <span className="dash-card__status-ok">Solde OK</span>}
      </header>
      {content}
    </section>
  )
}
