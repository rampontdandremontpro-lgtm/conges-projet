import { Icon } from '@/components/ui/Icon'
import { formatDays } from '@/utils/format'
import { formatReferencePeriodRange } from '@/utils/referencePeriods'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'

export function LeaveBalanceCard({
  summary, loading, error, onRetry, periodOptions = [], selectedPeriod, onPeriodChange, actionLabel, actionIcon = 'arrowRight', onAction,
}) {
  const effectivePeriod = selectedPeriod ?? summary?.referencePeriod ?? ''
  const option = periodOptions.find((item) => item.value === effectivePeriod)
  const range = effectivePeriod ? formatReferencePeriodRange(effectivePeriod) : null

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
    content = (
      <>
        <div className="balance-period-grid">
          <div className="balance-period-kpi balance-period-kpi--taken">
            <span className="balance-period-kpi__icon"><Icon name="calendar" size={20} /></span>
            <div><span>Pris</span><strong>{formatDays(summary.takenDays)} j</strong></div>
          </div>
          <div className="balance-period-kpi balance-period-kpi--pending">
            <span className="balance-period-kpi__icon"><Icon name="clock" size={20} /></span>
            <div><span>En attente</span><strong>{formatDays(summary.pendingDays)} j</strong></div>
          </div>
          <div className="balance-period-kpi balance-period-kpi--validated">
            <span className="balance-period-kpi__icon"><Icon name="check" size={20} /></span>
            <div><span>Validées</span><strong>{formatDays(summary.validatedDays)} j</strong></div>
          </div>
        </div>
        {actionLabel && onAction && (
          <button type="button" className="balance-card__action" onClick={onAction}>
            <Icon name={actionIcon} size={17} /><span>{actionLabel}</span><Icon name="arrowRight" size={15} />
          </button>
        )}
      </>
    )
  }

  return (
    <section className="dash-card dash-card--leave-balance">
      <header className="balance-card-head">
        <div className="balance-card-head__copy">
          <span className="balance-card-head__eyebrow">Mes congés</span>
          <h2>Situation de mes droits</h2>
          {range && <p>{range}</p>}
        </div>
        {!loading && !error && periodOptions.length > 0 && onPeriodChange ? (
          <label className="balance-card-period-select">
            <span>Période</span>
            <select aria-label="Période de référence" value={effectivePeriod} onChange={(event) => onPeriodChange(event.target.value)}>
              {periodOptions.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
        ) : summary && !loading && !error ? (
          <span className="balance-card-period-static">{option?.label ?? formatReferencePeriodRange(summary.referencePeriod)}</span>
        ) : null}
      </header>
      {content}
    </section>
  )
}
