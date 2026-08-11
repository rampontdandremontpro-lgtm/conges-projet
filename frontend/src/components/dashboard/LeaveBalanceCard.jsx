import { Icon } from '@/components/ui/Icon'
import { formatDays, formatPeriod } from '@/utils/format'
import { CardSkeleton, CardError } from '@/components/dashboard/DashboardStates'

export function LeaveBalanceCard({ balance, loading, error, onRetry }) {
  let content

  if (loading) {
    content = <CardSkeleton rows={4} />
  } else if (error) {
    content = <CardError onRetry={onRetry} />
  } else if (!balance) {
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
    const acquired = balance.acquiredDays || 0
    const progress = acquired > 0 ? Math.min(100, (balance.availableDays / acquired) * 100) : 0
    content = (
      <>
        <div className="balance-hero">
          <span className="balance-hero__number">{formatDays(balance.availableDays)}</span>
          <span className="balance-hero__label">jours disponibles</span>
        </div>
        <div
          className="balance-progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(progress)}
          aria-label="Solde disponible"
        >
          <div className="balance-progress__fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="balance-pills">
          <div className="balance-pill balance-pill--brand">
            <span className="balance-pill__label">Disponible</span>
            <strong>{formatDays(balance.availableDays)}</strong>
            <em>jours</em>
          </div>
          <div className="balance-pill balance-pill--accent">
            <span className="balance-pill__label">Acquis</span>
            <strong>{formatDays(balance.acquiredDays)}</strong>
            <em>jours</em>
          </div>
          <div className="balance-pill balance-pill--warning">
            <span className="balance-pill__label">Réservé</span>
            <strong>{formatDays(balance.reservedDays)}</strong>
            <em>jours</em>
          </div>
          <div className="balance-pill balance-pill--success">
            <span className="balance-pill__label">Potentiel</span>
            <strong>{formatDays(balance.potentialDays)}</strong>
            <em>jours</em>
          </div>
        </div>
      </>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title">Congés à utiliser</h2>
        {balance && !loading && !error && (
          <span className="dash-card__period">Période {formatPeriod(balance.referencePeriod)}</span>
        )}
      </header>
      {content}
    </section>
  )
}
