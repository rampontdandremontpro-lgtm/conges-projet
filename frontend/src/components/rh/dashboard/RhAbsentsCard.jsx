import { Icon } from '@/components/ui/Icon'

function initials(user) {
  return `${user?.nom?.[0] ?? ''}${user?.prenom?.[0] ?? ''}`.toUpperCase() || '—'
}

function statusLabel(status) {
  if (status === 'EN_VACANCES') return 'En vacances'
  if (status === 'ABSENT') return 'Absent'
  return 'Présent'
}

export function RhAbsentsCard({ presence, onNavigate }) {
  const members = Array.isArray(presence?.members) ? presence.members : []

  return (
    <section className="dash-card rh-absents-card">
      <header className="dash-card__header">
        <div className="dash-card__heading">
          <h2 className="dash-card__title dash-card__title--lg">Absents aujourd&apos;hui</h2>
          <span className="dash-card__period">{presence?.unavailable ?? 0} indisponible(s)</span>
        </div>
        <button type="button" className="dash-card__view-all" onClick={() => onNavigate('/app/rh-authorized-absences')}>
          Voir tout <Icon name="arrowRight" size={14} />
        </button>
      </header>

      {members.length === 0 ? (
        <div className="dash-empty dash-empty--compact">
          <span className="dash-empty__icon">
            <Icon name="users" size={22} />
          </span>
          <p className="dash-empty__title">Tout le monde est présent</p>
          <p className="dash-empty__text">Aucune indisponibilité enregistrée aujourd&apos;hui.</p>
        </div>
      ) : (
        <div className="rh-absents-list">
          {members.map((member) => (
            <div key={member.id} className="rh-absent-row">
              <span className="rh-absent-avatar">{initials(member)}</span>
              <span className="rh-absent-identity">
                <strong>{member.nom} {member.prenom}</strong>
                <small>{member.service?.name ?? 'Service non renseigné'}</small>
              </span>
              <span className={`rh-absent-status rh-absent-status--${String(member.presenceStatus ?? '').toLowerCase()}`}>
                {statusLabel(member.presenceStatus)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
