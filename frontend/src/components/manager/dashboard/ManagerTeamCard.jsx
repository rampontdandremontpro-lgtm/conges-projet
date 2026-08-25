import { Icon } from '@/components/ui/Icon'

const STATUS_LABELS = {
  PRESENT: 'Présent',
  EN_VACANCES: 'En vacances',
  ABSENT: 'Absent',
}

function initials(member) {
  return `${member.nom?.[0] ?? ''}${member.prenom?.[0] ?? ''}`.toUpperCase() || '—'
}

export function ManagerTeamCard({ presence, loading, error, onRetry, onOpenPresence }) {
  const members = presence?.members ?? []

  return (
    <section className="dash-card manager-team-card">
      <div className="dash-card__header">
        <div className="dash-card__heading">
          <span className="dash-card__title dash-card__title--lg">Équipe aujourd’hui</span>
        </div>
        <button className="dash-card__view-all" type="button" onClick={onOpenPresence}>
          Voir tout
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      {loading ? (
        <div className="manager-team-list">
          {[0, 1, 2].map((item) => (
            <div className="manager-team-row" key={item}>
              <span className="manager-team-avatar" />
              <span className="manager-card-state__skeleton" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="manager-card-state manager-card-state--compact">
          <Icon name="alert" size={22} />
          <strong>Impossible de charger l’équipe.</strong>
          <button type="button" onClick={onRetry}>Réessayer</button>
        </div>
      ) : members.length === 0 ? (
        <div className="manager-empty-state manager-empty-state--small">
          <span className="manager-empty-state__icon"><Icon name="users" size={21} /></span>
          <strong>Aucun membre actif</strong>
        </div>
      ) : (
        <div className="manager-team-list">
          {members.slice(0, 6).map((member) => (
            <div className="manager-team-row" key={member.id}>
              <span className="manager-team-avatar">{initials(member)}</span>
              <span className="manager-team-identity">
                <strong>{member.nom} {member.prenom}</strong>
                <small>{member.role === 'RESPONSABLE_SERVICE' ? 'Responsable de service' : 'Collaborateur'}</small>
              </span>
              <span className={`manager-team-status manager-team-status--${member.presenceStatus.toLowerCase()}`}>
                {STATUS_LABELS[member.presenceStatus] ?? member.presenceStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
