import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/config/navigation'
import { useClickOutside } from '@/hooks/useClickOutside'

export function UserMenu() {
  const { user, effectiveRole, profileMode, availableProfiles, switchProfile, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false), open)

  if (!user) {
    return null
  }

  const initials = `${user.nom?.[0] ?? ''}${user.prenom?.[0] ?? ''}`.toUpperCase()
  const roleLabel = ROLE_LABELS[effectiveRole] ?? effectiveRole

  function handleProfileSwitch(mode) {
    switchProfile(mode)
    setOpen(false)
    navigate('/app/dashboard', { replace: true })
  }

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
            {user.nom} {user.prenom}
          </span>
          <span className="user-menu__role">{roleLabel}</span>
        </span>
        <Icon name="chevronDown" className="user-menu__chevron" size={16} />
      </button>
      {open && (
        <div className="dropdown__panel dropdown__panel--user" role="menu">
          {availableProfiles.length > 0 && (
            <>
              {availableProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="user-menu__item"
                  onClick={() => handleProfileSwitch(profile.id)}
                >
                  <Icon name={profile.id === 'COLLABORATOR' ? 'user' : 'shield'} size={16} />
                  {profile.label}
                  {profileMode === profile.id && <Icon name="check" size={14} />}
                </button>
              ))}
              <div className="user-menu__divider" />
            </>
          )}
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
