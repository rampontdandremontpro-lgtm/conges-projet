import { NavLink } from 'react-router-dom'

import { PREVIEW_ROLES, getNavigationForRole } from '@/config/navigation'
import { Icon } from '@/components/ui/Icon'

export function Sidebar({ role, onRoleChange, collapsed, onCloseMobile }) {
  const navigation = getNavigationForRole(role)

  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <NavLink to="/" className="sidebar__brand" onClick={onCloseMobile}>
        <span className="sidebar__logo">G</span>
        <span className="sidebar__brand-text">
          <strong>GMES</strong>
          <small>Congés &amp; absences</small>
        </span>
      </NavLink>

      <nav className="sidebar__nav">
        <ul className="sidebar__nav-group">
          {navigation.main.map((item) => (
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
        {navigation.footer.length > 0 && (
          <ul className="sidebar__nav-group">
            {navigation.footer.map((item) => (
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
        )}
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
