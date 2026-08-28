import { Icon } from '@/components/ui/Icon'
import { formatDays } from '@/utils/format'
import { CardSkeleton, CardError } from '@/components/collab/dashboard/DashboardStates'

function periodRange(referencePeriod) {
  const match = String(referencePeriod ?? '').match(/^(\d{4})-(\d{4})$/)
  if (!match) return null
  return `Du 1er juin ${match[1]} au 31 mai ${match[2]}`
}

export function LeaveBalanceCard({
  summary, loading, error, onRetry, periodOptions = [], selectedPeriod, onPeriodChange, actionLabel, actionIcon = 'arrowRight', onAction,
}) {
  const effectivePeriod = selectedPeriod ?? summary?.referencePeriod ?? ''
  const option = periodOptions.find((item) => item.value === effectivePeriod)
  const range = periodRange(effectivePeriod)

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
          <div className="balance-period-kpi balance-period-kpi--acquired">
            <span className="balance-period-kpi__icon"><Icon name="plus" size={19} /></span>
            <div><span>Acquis</span><strong>{formatDays(summary.acquiredDays)} j</strong></div>
          </div>
          <div className="balance-period-kpi balance-period-kpi--pending">
            <span className="balance-period-kpi__icon"><Icon name="clock" size={19} /></span>
            <div><span>En attente</span><strong>{formatDays(summary.pendingDays)} j</strong></div>
          </div>
          <div className={`balance-period-kpi balance-period-kpi--balance balance-period-kpi--${tone}`}>
            <span className="balance-period-kpi__icon"><Icon name="wallet" size={19} /></span>
            <div><span>Solde</span><strong>{formatDays(balance)} j</strong></div>
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
          <span className="balance-card-period-static">{option?.label ?? `Période ${String(summary.referencePeriod).replace('-', '/')}`}</span>
        ) : null}
      </header>
      {content}
    </section>
  )
}
