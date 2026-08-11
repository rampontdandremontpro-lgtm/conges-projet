import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { useClickOutside } from '@/hooks/useClickOutside'

const DEMO_USER = {
  prenom: 'Jean',
  nom: 'Dupont',
  role: 'Collaborateur',
}

function getUserInitials() {
  return `${DEMO_USER.prenom[0]}${DEMO_USER.nom[0]}`.toUpperCase()
}

export function UserMenu() {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false), open)

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="user-menu__button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Menu utilisateur"
        aria-expanded={open}
      >
        <span className="user-menu__avatar" aria-hidden="true">
          {getUserInitials()}
        </span>
        <span className="user-menu__info">
          <span className="user-menu__name">
            {DEMO_USER.prenom} {DEMO_USER.nom}
          </span>
          <span className="user-menu__role">{DEMO_USER.role}</span>
        </span>
        <Icon name="chevronDown" className="user-menu__chevron" size={16} />
      </button>
      {open && (
        <div className="dropdown__panel dropdown__panel--user" role="menu">
          <Link to="/app/my-profile" className="user-menu__item" onClick={() => setOpen(false)}>
            <Icon name="user" size={16} />
            Mon profil
          </Link>
          <button
            type="button"
            className="user-menu__item"
            onClick={() => setOpen(false)}
          >
            <Icon name="settings" size={16} />
            Paramètres
          </button>
          <div className="user-menu__divider" />
          <button
            type="button"
            className="user-menu__item user-menu__item--danger"
            onClick={() => setOpen(false)}
          >
            <Icon name="logout" size={16} />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  )
}
