import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
import { todayISO } from '@/utils/format'

function presenceStatus(percentage) {
  return percentage > 50
    ? { label: 'Situation stable', tone: 'is-ok' }
    : { label: 'À surveiller', tone: 'is-warning' }
}

export function RhPresenceCard({ presence, onNavigate }) {
  const total = presence?.total ?? 0
  const present = presence?.present ?? 0
  const percentage = presence?.percentage ?? 100
  const status = presenceStatus(percentage)
  const today = todayISO()

  return (
    <section className="dash-card rh-global-presence-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <div className="rh-presence-title-row">
            <h2 className="dash-card__title">Présence aujourd&apos;hui</h2>
            <StatisticInfoButton title="Présence aujourd’hui">
              <p><strong>Calcul :</strong> nombre de collaborateurs présents au moment de la consultation ÷ nombre total de collaborateurs actifs pris en compte × 100.</p>
              <p>Le statut correspond à la demi-journée en cours en Martinique. Les collaborateurs en congé validé ou enregistrés absents ne sont pas comptés comme présents. Les comptes Admin sont exclus de cette vue.</p>
            </StatisticInfoButton>
          </div>
          <span className="dash-card__period">Vue globale de l&apos;organisation</span>
        </div>
        <span className={`rh-workload-status ${status.tone}`}>
          {status.label}
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
        <button type="button" onClick={() => onNavigate('/app/rh-statistics')}>
          <span>Présents</span>
          <strong>{present}</strong>
        </button>
        <button type="button" onClick={() => onNavigate(`/app/rh-all-requests?status=approved&from=${today}&to=${today}`)}>
          <span>En vacances</span>
          <strong>{presence?.onLeave ?? 0}</strong>
        </button>
        <button type="button" onClick={() => onNavigate('/app/rh-absences')}>
          <span>Absents</span>
          <strong>{presence?.absent ?? 0}</strong>
        </button>
      </div>
    </section>
  )
}
