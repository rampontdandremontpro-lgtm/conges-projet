import { Icon } from '@/components/ui/Icon'

function typeIcon(typeName) {
  const normalized = String(typeName ?? '').toLocaleLowerCase('fr-FR')
  if (normalized.includes('maladie')) return 'alert'
  if (normalized.includes('matern') || normalized.includes('patern')) return 'users'
  if (normalized.includes('famil')) return 'user'
  return 'calendar'
}

export function AbsenceTypeSelector({ types, selectedId, onSelect }) {
  return (
    <section className="absence-card absence-type-card">
      <div className="absence-card__heading">
        <div>
          <span className="absence-card__eyebrow">Étape 1</span>
          <h2>Type d’absence</h2>
          <p>Sélectionnez le motif correspondant à votre situation.</p>
        </div>
      </div>

      <div className="absence-type-grid">
        {types.map((type) => {
          const selected = Number(type.id) === Number(selectedId)
          return (
            <button
              key={type.id}
              type="button"
              className={`absence-type-option${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(type.id)}
              aria-pressed={selected}
            >
              <span className="absence-type-option__icon">
                <Icon name={typeIcon(type.name)} size={20} />
              </span>
              <span className="absence-type-option__content">
                <strong>{type.name}</strong>
                <small>
                  {type.documentRequired
                    ? 'Justificatif requis'
                    : 'Justificatif non obligatoire'}
                </small>
              </span>
              <span className="absence-type-option__check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
