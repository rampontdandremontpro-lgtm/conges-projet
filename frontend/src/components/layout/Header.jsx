import { useLocation } from 'react-router-dom'

import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'
import { UserMenu } from '@/components/layout/UserMenu'
import { getSectionLabel } from '@/config/navigation'

function headerMeta(pathname) {
  if (pathname === '/app/dashboard') {
    return { title: 'Tableau de bord', crumbs: ['GMES', 'Tableau de bord'] }
  }
  if (pathname === '/app/new-request') {
    return { title: 'Nouvelle demande', crumbs: ['GMES', 'Nouvelle demande'] }
  }
  if (pathname === '/app/profile') {
    return { title: 'Mon profil', crumbs: ['GMES', 'Mon profil'] }
  }
  if (pathname === '/app/settings') {
    return { title: 'Paramètres', crumbs: ['GMES', 'Paramètres'] }
  }

  const section = pathname.startsWith('/app/') ? pathname.slice('/app/'.length) : ''
  const label = section ? getSectionLabel(section) : null
  const title = label ?? 'GMES'
  return { title, crumbs: ['GMES', title] }
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

export function Header() {
  const { pathname } = useLocation()
  const { title, crumbs } = headerMeta(pathname)

  return (
    <header className="header">
      <div className="header__page-meta">
        <div className="header__breadcrumbs" aria-label="Fil d’Ariane">
          {crumbs.map((crumb, index) => (
            <span className="header__breadcrumb" key={`${crumb}-${index}`}>
              {index > 0 && <span className="header__breadcrumb-separator">›</span>}
              <span className={index === crumbs.length - 1 ? 'is-current' : ''}>{crumb}</span>
            </span>
          ))}
        </div>
        <h1 className="header__page-title">{title}</h1>
      </div>

      <label className="header__search">
        <SearchIcon />
        <input type="search" placeholder="Rechercher…" aria-label="Rechercher" />
      </label>

      <NotificationsDropdown />
      <UserMenu />
    </header>
  )
}
