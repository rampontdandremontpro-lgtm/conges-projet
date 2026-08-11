import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/config/navigation'
import { useClickOutside } from '@/hooks/useClickOutside'

export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false), open)

  if (!user) {
    return null
  }

  const initials = `${user.prenom?.[0] ?? ''}${user.nom?.[0] ?? ''}`.toUpperCase()
  const roleLabel = ROLE_LABELS[user.role] ?? user.role

  function handleLogout() {
    setOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

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
          {initials}
        </span>
        <span className="user-menu__info">
          <span className="user-menu__name">
            {user.prenom} {user.nom}
          </span>
          <span className="user-menu__role">{roleLabel}</span>
        </span>
        <Icon name="chevronDown" className="user-menu__chevron" size={16} />
      </button>
      {open && (
        <div className="dropdown__panel dropdown__panel--user" role="menu">
          <Link to="/app/profile" className="user-menu__item" onClick={() => setOpen(false)}>
            <Icon name="user" size={16} />
            Mon profil
          </Link>
          <Link to="/app/settings" className="user-menu__item" onClick={() => setOpen(false)}>
            <Icon name="settings" size={16} />
            Paramètres
          </Link>
          <div className="user-menu__divider" />
          <button
            type="button"
            className="user-menu__item user-menu__item--danger"
            onClick={handleLogout}
          >
            <Icon name="logout" size={16} />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  )
}
