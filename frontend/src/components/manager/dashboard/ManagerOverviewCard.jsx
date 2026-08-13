import { Icon } from '@/components/ui/Icon'

function CountPill({ label, value, tone }) {
  return (
    <div className={`manager-overview-pill manager-overview-pill--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function ManagerOverviewCard({ requests, loading, error, onRetry, onViewRequests }) {
  const pending = requests ?? []
  const urgentCount = pending.filter((request) => request.isUrgent).length
  const paidLeaveCount = pending.filter(
    (request) => request.leaveType?.name === 'Congés payés',
  ).length
  const unpaidLeaveCount = pending.filter(
    (request) => request.leaveType?.name === 'Congé sans solde',
  ).length

  return (
    <section className="dash-card manager-overview-card">
      <div className="dash-card__header">
        <div className="dash-card__heading">
          <span className="dash-card__title">Demandes à traiter</span>
          <span className="dash-card__period">Votre périmètre de validation</span>
        </div>
        {!loading && !error && pending.length === 0 && (
          <span className="dash-card__status-ok">À jour</span>
        )}
      </div>

      {loading ? (
        <div className="manager-card-state" aria-label="Chargement des demandes">
          <span className="manager-card-state__skeleton manager-card-state__skeleton--hero" />
          <span className="manager-card-state__skeleton" />
        </div>
      ) : error ? (
        <div className="manager-card-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger les demandes.</strong>
          <button type="button" onClick={onRetry}>Réessayer</button>
        </div>
      ) : (
        <>
          <div className="manager-overview-hero">
            <strong>{pending.length}</strong>
            <span>{pending.length > 1 ? 'demandes en attente' : 'demande en attente'}</span>
          </div>

          <div className="manager-overview-pills">
            <CountPill label="Urgentes" value={urgentCount} tone="orange" />
            <CountPill label="Congés payés" value={paidLeaveCount} tone="cyan" />
            <CountPill label="Sans solde" value={unpaidLeaveCount} tone="green" />
          </div>

          <button className="manager-overview-link" type="button" onClick={onViewRequests}>
            Voir les demandes à traiter
            <Icon name="chevronRight" size={17} />
          </button>
        </>
      )}
    </section>
  )
}
