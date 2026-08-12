export function LeaveTypeSelector({ leaveTypes, selectedId, onSelect }) {
  if (leaveTypes.length === 0) {
    return (
      <div className="nr-types-empty">
        Aucun type de congé n’est disponible pour votre profil.
      </div>
    )
  }

  return (
    <div className="nr-types">
      {leaveTypes.map((type) => (
        <button
          type="button"
          key={type.id}
          className={`nr-types__pill${selectedId === type.id ? ' nr-types__pill--active' : ''}`}
          aria-pressed={selectedId === type.id}
          onClick={() => onSelect(type.id)}
        >
          {type.name}
        </button>
      ))}
    </div>
  )
}
