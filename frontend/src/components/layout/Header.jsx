import { useLocation } from 'react-router-dom'

import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'
import { UserMenu } from '@/components/layout/UserMenu'
import { getSectionLabel } from '@/config/navigation'

function headerTitle(pathname) {
  if (pathname === '/app/dashboard') {
    return 'Tableau de bord'
  }
  if (pathname === '/app/new-request') {
    return 'Nouvelle demande'
  }
  if (pathname === '/app/profile') {
    return 'Mon profil'
  }
  if (pathname === '/app/settings') {
    return 'Paramètres'
  }

  const section = pathname.startsWith('/app/') ? pathname.slice('/app/'.length) : ''
  return (section ? getSectionLabel(section) : null) ?? 'GMES'
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
  const title = headerTitle(pathname)

  return (
    <header className="header">
      <div className="header__page-meta">
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
