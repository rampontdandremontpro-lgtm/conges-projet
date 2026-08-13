import { Icon } from '@/components/ui/Icon'

export function ManagerPresenceCard({ presence, loading, error, onRetry, onOpenPresence }) {
  const summary = presence?.summary
  const service = presence?.service
  const total = summary?.total ?? 0
  const present = summary?.present ?? 0
  const unavailable = (summary?.onLeave ?? 0) + (summary?.absent ?? 0)
  const percentage = total > 0 ? Math.round((present / total) * 100) : 0
  const threshold = service?.hasMinimumPresenceRule ? service.minimumPresence : null
  const thresholdOk = threshold == null || present >= threshold

  return (
    <section className="dash-card manager-presence-card">
      <div className="dash-card__header">
        <div className="dash-card__heading">
          <span className="dash-card__title">Présence du service</span>
          <span className="dash-card__period">{service?.name ?? 'Votre service'}</span>
        </div>
        {!loading && !error && (
          <span className={`manager-presence-status ${thresholdOk ? 'is-ok' : 'is-warning'}`}>
            {thresholdOk ? 'Seuil OK' : 'Seuil à surveiller'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="manager-card-state" aria-label="Chargement de la présence">
          <span className="manager-card-state__skeleton manager-card-state__skeleton--hero" />
          <span className="manager-card-state__skeleton" />
        </div>
      ) : error ? (
        <div className="manager-card-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger la présence du service.</strong>
          <button type="button" onClick={onRetry}>Réessayer</button>
        </div>
      ) : (
        <>
          <div className="manager-presence-hero">
            <strong>{percentage}%</strong>
            <span>{present} présent{present > 1 ? 's' : ''} sur {total}</span>
          </div>

          <div className="manager-presence-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(percentage, 100)}%` }} />
          </div>

          <div className="manager-presence-stats">
            <div>
              <span>Présents</span>
              <strong>{present}</strong>
            </div>
            <div>
              <span>Indisponibles</span>
              <strong>{unavailable}</strong>
            </div>
            <div>
              <span>Minimum requis</span>
              <strong>{threshold ?? '—'}</strong>
            </div>
          </div>

          <button className="manager-presence-link" type="button" onClick={onOpenPresence}>
            Voir la présence du service
            <Icon name="chevronRight" size={17} />
          </button>
        </>
      )}
    </section>
  )
}
