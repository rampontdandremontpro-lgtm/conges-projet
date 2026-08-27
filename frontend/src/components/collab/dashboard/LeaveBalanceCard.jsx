import { Icon } from '@/components/ui/Icon'
import { formatDays } from '@/utils/format'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'

export function LeaveBalanceCard({
  summary, loading, error, onRetry, periodOptions = [], selectedPeriod, onPeriodChange, actionLabel, actionIcon = 'arrowRight', onAction,
}) {
  let content
  if (loading) {
    content = <CardSkeleton rows={3} />
  } else if (error) {
    content = <CardError onRetry={onRetry} />
  } else if (!summary) {
    content = (
      <div className="dash-empty">
        <span className="dash-empty__icon dash-empty__icon--muted"><Icon name="wallet" size={24} /></span>
        <p className="dash-empty__title">Aucune donnée pour cette période</p>
        <p className="dash-empty__text">Les informations apparaîtront ici dès que les droits seront alimentés.</p>
      </div>
    )
  } else {
    const balance = Number(summary.balanceDays ?? 0)
    const tone = balance < 0 ? 'negative' : balance === 0 ? 'neutral' : 'positive'
    content = (
      <>
        <div className="balance-period-grid">
          <div className="balance-period-kpi">
            <span>Acquis</span><strong>{formatDays(summary.acquiredDays)} j</strong>
          </div>
          <div className="balance-period-kpi">
            <span>En attente</span><strong>{formatDays(summary.pendingDays)} j</strong>
          </div>
          <div className={`balance-period-kpi balance-period-kpi--${tone}`}>
            <span>Solde</span><strong>{formatDays(balance)} j</strong>
          </div>
        </div>
        {balance < 0 && (
          <p className="balance-negative-note"><Icon name="info" size={15} /> Solde anticipé : les prochaines acquisitions viendront le compenser.</p>
        )}
        {actionLabel && onAction && (
          <button type="button" className="balance-card__action" onClick={onAction}>
            <Icon name={actionIcon} size={17} /><span>{actionLabel}</span><Icon name="arrowRight" size={15} />
          </button>
        )}
      </>
    )
  }

  return (
    <section className="dash-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Mes congés</h2>
          {!loading && !error && periodOptions.length > 0 && onPeriodChange ? (
            <label className="dash-card__period-select">
              <select aria-label="Période de référence" value={selectedPeriod ?? summary?.referencePeriod ?? ''} onChange={(event) => onPeriodChange(event.target.value)}>
                {periodOptions.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
            </label>
          ) : summary && !loading && !error ? (
            <span className="dash-card__period">Période {String(summary.referencePeriod).replace('-', '/')}</span>
          ) : null}
        </div>
      </header>
      {content}
    </section>
  )
}
