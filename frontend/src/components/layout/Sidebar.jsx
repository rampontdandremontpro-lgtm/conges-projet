import { NavLink } from 'react-router-dom'

import gmesLogo from '@/assets/logo-gmes.png'
import { Icon } from '@/components/ui/Icon'
import {
  NEW_REQUEST_ITEM,
  NEW_REQUEST_ROLES,
  PREVIEW_ROLES,
  getNavigationForRole,
} from '@/config/navigation'

export function Sidebar({ role, onRoleChange, collapsed, onCloseMobile }) {
  const navigation = getNavigationForRole(role)
  const showNewRequest = NEW_REQUEST_ROLES.includes(role)

  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <NavLink to="/" className="sidebar__brand" onClick={onCloseMobile}>
        <img src={gmesLogo} alt="GMES" className="sidebar__logo-img" />
        <span className="sidebar__brand-text">
          <strong>GMES</strong>
          <small>Congés &amp; absences</small>
        </span>
      </NavLink>

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
          {navigation.map((item) => (
            <li key={item.id}>
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
          ))}
        </ul>
      </nav>

      {!collapsed && (
        <div className="sidebar__footer">
          <span className="sidebar__footer-label">Aperçu du rôle</span>
          <select
            className="sidebar__role-select"
            value={role}
            onChange={(event) => onRoleChange(event.target.value)}
            aria-label="Aperçu du rôle"
          >
            {PREVIEW_ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  )
}
