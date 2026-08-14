import { Icon } from '@/components/ui/Icon'

export function RhPresenceCard({ presence, onNavigate }) {
  const total = presence?.total ?? 0
  const present = presence?.present ?? 0
  const percentage = presence?.percentage ?? 100

  return (
    <section className="dash-card rh-global-presence-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Présence aujourd&apos;hui</h2>
          <span className="dash-card__period">Vue globale de l&apos;organisation</span>
        </div>
        <span className={`rh-workload-status ${percentage >= 80 ? 'is-ok' : 'is-warning'}`}>
          {percentage >= 80 ? 'Situation stable' : 'À surveiller'}
        </span>
      </header>

      <div className="rh-presence-hero">
        <strong>{percentage}%</strong>
        <span>{present} présent{present > 1 ? 's' : ''} sur {total}</span>
      </div>

      <div className="rh-presence-progress" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
      </div>

      <div className="rh-presence-stats">
        <div>
          <span>Présents</span>
          <strong>{present}</strong>
        </div>
        <div>
          <span>En vacances</span>
          <strong>{presence?.onLeave ?? 0}</strong>
        </div>
        <div>
          <span>Absents</span>
          <strong>{presence?.absent ?? 0}</strong>
        </div>
      </div>

      <button type="button" className="rh-dashboard-primary-link" onClick={() => onNavigate('/app/absences')}>
        <Icon name="users" size={17} />
        <span>Voir les absences</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}
