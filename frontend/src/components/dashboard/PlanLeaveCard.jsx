import { Icon } from '@/components/ui/Icon'
import { formatDays } from '@/utils/format'

export function PlanLeaveCard({ availableDays, onNewRequest }) {
  return (
    <section className="plan-card">
      <span className="plan-card__icon" aria-hidden="true">
        <Icon name="sparkles" size={28} />
      </span>
      <h2 className="plan-card__title">Planifier un congé</h2>
      {availableDays !== null && (
        <p className="plan-card__balance">{formatDays(availableDays)} jours disponibles</p>
      )}
      <p className="plan-card__text">
        Préparez votre prochaine période de congés en quelques clics.
      </p>
      <button type="button" className="plan-card__cta" onClick={onNewRequest}>
        Nouvelle demande
        <Icon name="arrowRight" size={18} />
      </button>
    </section>
  )
}
