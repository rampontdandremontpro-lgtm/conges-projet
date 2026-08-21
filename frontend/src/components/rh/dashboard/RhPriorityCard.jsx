import { Icon } from '@/components/ui/Icon'

const KIND_CONFIG = {
  leave: { icon: 'calendar', label: 'Demande de congé', tone: 'blue' },
  absence: { icon: 'alert', label: 'Absence à vérifier', tone: 'cyan' },
  document: { icon: 'doc', label: 'Justificatif', tone: 'orange' },
  derogation: { icon: 'shield', label: 'Dérogation', tone: 'green' },
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Martinique',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function RhPriorityCard({ items, onNavigate }) {
  const list = Array.isArray(items) ? items : []

  return (
    <section className="dash-card rh-priority-card">
      <header className="dash-card__header">
        <h2 className="dash-card__title dash-card__title--lg">Demandes à traiter en priorité</h2>
        <button type="button" className="dash-card__view-all" onClick={() => onNavigate('/app/rh-all-requests')}>
          Voir tout <Icon name="arrowRight" size={14} />
        </button>
      </header>

      {list.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty__icon">
            <Icon name="check" size={22} />
          </span>
          <p className="dash-empty__title">Aucune demande prioritaire</p>
          <p className="dash-empty__text">Les demandes à traiter apparaîtront ici, de la plus urgente à la moins urgente.</p>
        </div>
      ) : (
        <div className="rh-priority-list">
          {list.map((item) => {
            const config = KIND_CONFIG[item.kind] ?? KIND_CONFIG.leave
            return (
              <button
                type="button"
                key={item.id}
                className="rh-priority-row"
                onClick={() => onNavigate(item.to)}
              >
                <span className={`rh-priority-icon rh-priority-icon--${config.tone}`}>
                  <Icon name={config.icon} size={18} />
                </span>
                <span className="rh-priority-main">
                  <span className="rh-priority-topline">
                    <strong>{item.title}</strong>
                    {item.urgent && <span className="rh-priority-urgent">Urgent</span>}
                  </span>
                  <span className="rh-priority-label">{item.label}</span>
                  <span className="rh-priority-meta">{item.subtitle} · {item.meta}</span>
                </span>
                <span className="rh-priority-date">{formatDateTime(item.date)}</span>
                <Icon name="chevronRight" size={17} className="rh-priority-chevron" />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
