import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'
import { UserMenu } from '@/components/layout/UserMenu'
import { getSectionLabel } from '@/config/navigation'

function headerTitle(pathname) {
  if (pathname === '/app/dashboard') return 'Tableau de bord'
  if (pathname === '/app/new-request') return 'Nouvelle demande'
  if (pathname === '/app/rh-prepare-request') return 'Préparer une demande'
  if (/^\/app\/new-request\/\d+$/.test(pathname)) return 'Modifier la demande'
  if (pathname === '/app/declare-absence') return 'Déclarer une absence'
  if (/^\/app\/declare-absence\/\d+$/.test(pathname)) return 'Modifier la déclaration'
  if (/^\/app\/my-requests\/leave\/\d+$/.test(pathname)) return 'Détail de la demande'
  if (/^\/app\/my-requests\/absence\/\d+$/.test(pathname)) return 'Détail de l’absence'
  if (/^\/app\/requests\/\d+$/.test(pathname)) return 'Détail de la demande'
  if (/^\/app\/rh-(?:all-requests|requests)\/\d+$/.test(pathname)) return 'Détail de la demande'
  if (/^\/app\/director-all-requests\/\d+$/.test(pathname)) return 'Détail de la demande'
  if (pathname === '/app/profile') return 'Mon profil'
  if (pathname === '/app/settings') return 'Paramètres'
  if (/^\/app\/director-availability\/(leave|absence)\/\d+$/.test(pathname)) return 'Modifier mon indisponibilité'
  if (pathname === '/app/history') return 'Historique'

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

export function Header({ onOpenMobile, mobileOpen = false }) {
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const title = headerTitle(pathname)
  const hideSearch =
    ['/app/dashboard', '/app/new-request', '/app/rh-prepare-request', '/app/rh-exports', '/app/rh-holidays', '/app/rh-summer-period', '/app/admin-summer-period', '/app/admin-holidays', '/app/admin-minimum-presence', '/app/director-statistics', '/app/rh-statistics', '/app/director-exports', '/app/director-availability', '/app/history', '/app/my-balance', '/app/my-balances', '/app/declare-absence', '/app/profile', '/app/settings'].includes(pathname) ||
    /^\/app\/(new-request|declare-absence)\/\d+$/.test(pathname) ||
    /^\/app\/director-availability\/(leave|absence)\/\d+$/.test(pathname) ||
    /^\/app\/my-requests\/(leave|absence)\/\d+$/.test(pathname) ||
    /^\/app\/requests\/\d+$/.test(pathname) ||
    /^\/app\/rh-(?:all-requests|requests)\/\d+$/.test(pathname) ||
    /^\/app\/director-(?:all-requests|requests)\/\d+$/.test(pathname)
  const showSearch = !hideSearch
  const searchEnabled = ['/app/my-requests', '/app/notifications', '/app/requests', '/app/alerts', '/app/service-presence', '/app/rh-all-requests', '/app/rh-absences', '/app/rh-derogations', '/app/rh-balances', '/app/rh-pdf-documents', '/app/rh-leave-types', '/app/admin-leave-types', '/app/admin-users', '/app/admin-services', '/app/admin-technical-logs', '/app/rh-validators', '/app/director-all-requests', '/app/director-presence', '/app/director-unavailability', '/app/my-documents'].includes(pathname)
  const searchValue = searchEnabled ? searchParams.get('q') ?? '' : undefined

  useEffect(() => {
    setMobileSearchOpen(false)
  }, [pathname])

  const handleSearchChange = (event) => {
    if (!searchEnabled) {
      return
    }

    const value = event.target.value
    const nextParams = new URLSearchParams(searchParams)

    if (value.trim()) {
      nextParams.set('q', value)
    } else {
      nextParams.delete('q')
    }

    setSearchParams(nextParams, { replace: true })
  }

  return (
    <header className="header">
      <button
        type="button"
        className="header__mobile-menu"
        onClick={onOpenMobile}
        aria-label={mobileOpen ? 'Fermer le menu principal' : 'Ouvrir le menu principal'}
        aria-expanded={mobileOpen}
        aria-controls="gmes-main-sidebar"
      >
        <span aria-hidden="true" className="header__mobile-menu-lines">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div className="header__page-meta">
        <h1 className="header__page-title">{title}</h1>
      </div>

      {showSearch && searchEnabled && (
        <button
          type="button"
          className="header__mobile-search-toggle"
          onClick={() => setMobileSearchOpen((value) => !value)}
          aria-label={mobileSearchOpen ? 'Fermer la recherche' : 'Ouvrir la recherche'}
          aria-expanded={mobileSearchOpen}
        >
          <SearchIcon />
        </button>
      )}

      {showSearch && (
        <label className={`header__search${mobileSearchOpen ? ' header__search--mobile-open' : ''}`}>
          <SearchIcon />
          <input
            key={pathname}
            type="search"
            placeholder="Rechercher…"
            aria-label="Rechercher"
            value={searchValue}
            onChange={handleSearchChange}
          />
        </label>
      )}

      <NotificationsDropdown />
      <UserMenu />
    </header>
  )
}
