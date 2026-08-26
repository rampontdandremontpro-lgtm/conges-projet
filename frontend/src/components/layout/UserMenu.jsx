import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/config/navigation'
import { useClickOutside } from '@/hooks/useClickOutside'
import { getMyPreferences } from '@/services/profile'

export function UserMenu() {
  const { user, effectiveRole, profileMode, availableProfiles, switchProfile, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [profileImage, setProfileImage] = useState(null)
  const userId = user?.id
  const ref = useClickOutside(() => setOpen(false), open)

  useEffect(() => {
    if (!userId) return undefined
    let active = true
    const load = async () => {
      try {
        const data = await getMyPreferences()
        if (active) setProfileImage(data?.profileImageData ?? null)
      } catch {
        if (active) setProfileImage(null)
      }
    }
    load()
    const handleUpdate = (event) => setProfileImage(event.detail?.profileImageData ?? null)
    window.addEventListener('gmes:profile-preferences-updated', handleUpdate)
    return () => {
      active = false
      window.removeEventListener('gmes:profile-preferences-updated', handleUpdate)
    }
  }, [userId])

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
          {profileImage ? <img src={profileImage} alt="" /> : initials}
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
