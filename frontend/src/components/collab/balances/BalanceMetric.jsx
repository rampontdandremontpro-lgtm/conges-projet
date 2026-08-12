import { Icon } from '@/components/ui/Icon'
import { formatDays } from '@/utils/format'

export function BalanceMetric({ label, value, subtitle, tone, icon }) {
  return (
    <article className={`balances-metric-card balances-metric-card--${tone}`}>
      <span className="balances-metric-card__icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <span className="balances-metric-card__label">{label}</span>
        <strong className="balances-metric-card__value">{formatDays(value)}</strong>
        <span className="balances-metric-card__subtitle">{subtitle}</span>
      </div>
    </article>
  )
}
