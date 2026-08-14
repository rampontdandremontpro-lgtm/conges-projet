import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/config/navigation'

const STATUS_LABELS = {
  PRESENT: 'Présent',
  EN_VACANCES: 'En vacances',
  ABSENT: 'Absent',
}

function initials(member) {
  return `${member.prenom?.[0] ?? ''}${member.nom?.[0] ?? ''}`.toUpperCase() || '—'
}

function statusClass(status) {
  return String(status ?? 'PRESENT').toLocaleLowerCase('fr-FR')
}

function SlotStatus({ label, slot, active }) {
  const status = slot?.status ?? 'PRESENT'

  return (
    <span className={`manager-presence-slot manager-presence-slot--${statusClass(status)}${active ? ' is-current' : ''}`}>
      <span>{label}</span>
      <strong>{STATUS_LABELS[status] ?? status}</strong>
    </span>
  )
}

export function ManagerPresenceMemberCard({ member, currentPeriod }) {
  const status = member.presenceStatus ?? 'PRESENT'
  const roleLabel = ROLE_LABELS[member.role] ?? member.role
  const daily = member.dailyAvailability

  return (
    <article className="manager-presence-member-card">
      <div className="manager-presence-member-card__identity">
        <span className="manager-presence-member-card__avatar">{initials(member)}</span>
        <span className="manager-presence-member-card__name">
          <strong>{member.prenom} {member.nom}</strong>
          <small>{roleLabel}</small>
        </span>
      </div>

      <span className={`manager-presence-member-card__status manager-presence-member-card__status--${statusClass(status)}`}>
        {status === 'PRESENT' ? <Icon name="check" size={13} /> : <Icon name={status === 'ABSENT' ? 'alert' : 'calendar'} size={13} />}
        {STATUS_LABELS[status] ?? status}
      </span>

      <div className="manager-presence-member-card__slots">
        <SlotStatus
          label="Matin"
          slot={daily?.morning}
          active={currentPeriod === 'MATIN'}
        />
        <SlotStatus
          label="Après-midi"
          slot={daily?.afternoon}
          active={currentPeriod === 'APRES_MIDI'}
        />
      </div>
    </article>
  )
}
