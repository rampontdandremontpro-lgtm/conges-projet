import { Icon } from '@/components/ui/Icon'

export function RhWorkloadCard({ workload, onNavigate }) {
  const total = workload?.total ?? 0

  return (
    <section className="dash-card rh-workload-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title">Dossiers à traiter</h2>
          <span className="dash-card__period">Votre file d&apos;action RH</span>
        </div>
        <span className={`rh-workload-status ${total > 0 ? 'is-warning' : 'is-ok'}`}>
          {total > 0 ? 'Action requise' : 'À jour'}
        </span>
      </header>

      <div className="rh-workload-hero">
        <strong>{total}</strong>
        <span>{total > 1 ? 'dossiers en attente' : 'dossier en attente'}</span>
      </div>

      <div className="rh-workload-grid">
        <button type="button" className="rh-workload-metric rh-workload-metric--blue" onClick={() => onNavigate('/app/rh-requests')}>
          <span>Demandes</span>
          <strong>{workload?.leaveRequests ?? 0}</strong>
        </button>
        <button type="button" className="rh-workload-metric rh-workload-metric--cyan" onClick={() => onNavigate('/app/rh-absences')}>
          <span>Absences</span>
          <strong>{workload?.absences ?? 0}</strong>
        </button>
        <button type="button" className="rh-workload-metric rh-workload-metric--orange" onClick={() => onNavigate('/app/rh-justificatifs')}>
          <span>Justificatifs</span>
          <strong>{workload?.documents ?? 0}</strong>
        </button>
        <button type="button" className="rh-workload-metric rh-workload-metric--green" onClick={() => onNavigate('/app/rh-derogations')}>
          <span>Dérogations</span>
          <strong>{workload?.derogations ?? 0}</strong>
        </button>
      </div>

      <button type="button" className="rh-dashboard-primary-link" onClick={() => onNavigate('/app/rh-requests')}>
        <Icon name="list" size={17} />
        <span>Voir les demandes</span>
        <Icon name="arrowRight" size={15} />
      </button>
    </section>
  )
}
