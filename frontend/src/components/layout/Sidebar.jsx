import { NavLink } from 'react-router-dom'

import gmesLogo from '@/assets/logo-gmes.png'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import { NEW_REQUEST_ITEM, NEW_REQUEST_ROLES, getNavigationForRole } from '@/config/navigation'

export function Sidebar({ collapsed, onCloseMobile }) {
  const { effectiveRole } = useAuth()
  const role = effectiveRole
  const navigation = getNavigationForRole(role)
  const showNewRequest = NEW_REQUEST_ROLES.includes(role)

  return (
    <aside id="gmes-main-sidebar" className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__mobile-head">
        <NavLink to="/" className="sidebar__brand" onClick={onCloseMobile}>
          <img src={gmesLogo} alt="G Congés & Absences" className="sidebar__logo-img" />
          <span className="sidebar__brand-text">
            <strong>G Congés &amp; Absences</strong>
          </span>
        </NavLink>
        <button
          type="button"
          className="sidebar__mobile-close"
          onClick={onCloseMobile}
          aria-label="Fermer le menu principal"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {showNewRequest && (
        <NavLink
          to={NEW_REQUEST_ITEM.to}
          onClick={onCloseMobile}
          className="sidebar__cta"
          title={collapsed ? NEW_REQUEST_ITEM.label : undefined}
        >
          <Icon name={NEW_REQUEST_ITEM.icon} size={18} />
          <span>{NEW_REQUEST_ITEM.label}</span>
        </NavLink>
      )}

      <nav className="sidebar__nav">
        <ul className="sidebar__nav-group">
          {navigation.map((item, index) => {
            const previousGroup = index > 0 ? navigation[index - 1]?.group : null
            const showGroupTitle = Boolean(item.group) && item.group !== previousGroup

            return (
              <li key={item.id} className="sidebar__nav-entry">
                {showGroupTitle && (
                  <span className="sidebar__section-title" aria-hidden={collapsed ? 'true' : undefined}>
                    {item.group}
                  </span>
                )}
                <NavLink
                  to={item.to}
                  onClick={onCloseMobile}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `sidebar__nav-item${isActive ? ' is-active' : ''}`
                  }
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
