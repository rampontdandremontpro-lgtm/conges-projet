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
  if (pathname === '/app/profile') return 'Mon profil'
  if (pathname === '/app/settings') return 'Paramètres'
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

export function Header() {
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const title = headerTitle(pathname)
  const hideSearch =
    ['/app/dashboard', '/app/new-request', '/app/rh-prepare-request', '/app/history', '/app/my-balance', '/app/my-balances', '/app/declare-absence', '/app/my-documents', '/app/profile', '/app/settings'].includes(pathname) ||
    /^\/app\/(new-request|declare-absence)\/\d+$/.test(pathname) ||
    /^\/app\/my-requests\/(leave|absence)\/\d+$/.test(pathname) ||
    /^\/app\/requests\/\d+$/.test(pathname) ||
    /^\/app\/rh-(?:all-requests|requests)\/\d+$/.test(pathname)
  const showSearch = !hideSearch
  const searchEnabled = ['/app/my-requests', '/app/notifications', '/app/requests', '/app/alerts', '/app/service-presence', '/app/rh-all-requests', '/app/rh-absences', '/app/rh-derogations'].includes(pathname)
  const searchValue = searchEnabled ? searchParams.get('q') ?? '' : undefined

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
      <div className="header__page-meta">
        <h1 className="header__page-title">{title}</h1>
      </div>

      {showSearch && (
        <label className="header__search">
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
