import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { PageContainer } from '@/components/ui/PageContainer'
import { ROLES } from '@/config/navigation'

function getCollaboratorBackgroundVariant(pathname, role) {
  if (role !== ROLES.COLLABORATEUR) return null

  if (pathname === '/app/dashboard') return 'dashboard'

  if (
    pathname === '/app/new-request' ||
    pathname.startsWith('/app/new-request/')
  ) {
    return 'form'
  }


  if (pathname.startsWith('/app/my-requests/')) return 'detail'

  if (pathname === '/app/my-requests') return 'requests'
  if (pathname === '/app/my-documents') return 'documents'
  if (pathname === '/app/notifications') return 'notifications'
  if (pathname === '/app/history') return 'list'

  if (pathname === '/app/profile' || pathname === '/app/settings') return 'profile'

  return 'default'
}

function getManagerBackgroundVariant(pathname, role) {
  if (role !== ROLES.RESPONSABLE_SERVICE) return null

  if (pathname === '/app/dashboard') return 'dashboard'
  if (pathname === '/app/requests') return 'requests'
  if (pathname.startsWith('/app/requests/')) return 'decision'
  if (pathname === '/app/alerts') return 'alerts'
  if (pathname === '/app/service-presence') return 'calendar'

  if (
    pathname === '/app/new-request' ||
    pathname.startsWith('/app/new-request/')
  ) {
    return 'form'
  }


  if (pathname.startsWith('/app/my-requests/')) return 'personal-detail'
  if (pathname === '/app/my-requests') return 'personal-requests'
  if (pathname === '/app/my-balance') return 'balance'
  if (pathname === '/app/my-documents') return 'documents'
  if (pathname === '/app/notifications') return 'notifications'
  if (pathname === '/app/history') return 'personal-list'
  if (pathname === '/app/profile' || pathname === '/app/settings') return 'profile'

  return 'default'
}

function ManagerBackgroundDecor() {
  return (
    <div className="gmes-manager-bg__decor" aria-hidden="true">
      <span className="gmes-manager-bg__shape gmes-manager-bg__shape--orb" />
      <span className="gmes-manager-bg__shape gmes-manager-bg__shape--ring" />
      <span className="gmes-manager-bg__shape gmes-manager-bg__shape--blob" />
      <span className="gmes-manager-bg__shape gmes-manager-bg__shape--arc" />
      <span className="gmes-manager-bg__shape gmes-manager-bg__shape--dots" />
    </div>
  )
}

function getRhBackgroundVariant(pathname, role) {
  if (role !== ROLES.RH) return null

  if (pathname === '/app/dashboard') return 'dashboard'
  if (pathname === '/app/rh-leaves-absences') return 'requests'
  if (pathname === '/app/rh-all-requests') return 'requests'
  if (pathname.startsWith('/app/rh-all-requests/')) return 'request-detail'
  if (pathname === '/app/rh-prepare-request') return 'prepare'
  if (pathname === '/app/rh-absences') return 'absences'
  if (pathname === '/app/rh-derogations') return 'derogations'

  if (pathname === '/app/rh-balances') return 'balances'
  if (pathname === '/app/rh-statistics') return 'statistics'
  if (pathname === '/app/rh-exports') return 'exports'
  if (pathname === '/app/rh-pdf-documents') return 'documents'

  if (pathname === '/app/rh-leave-types') return 'leave-types'
  if (pathname === '/app/rh-holidays') return 'holidays'
  if (pathname === '/app/rh-summer-period') return 'summer'
  if (pathname === '/app/rh-validators') return 'validators'
  if (pathname === '/app/rh-history') return 'history'

  if (
    pathname === '/app/new-request' ||
    pathname.startsWith('/app/new-request/')
  ) {
    return 'personal-form'
  }


  if (pathname.startsWith('/app/my-requests/')) return 'personal-detail'
  if (pathname === '/app/my-requests') return 'personal-requests'
  if (pathname === '/app/my-balance') return 'personal-balance'
  if (pathname === '/app/my-documents') return 'personal-documents'
  if (pathname === '/app/notifications') return 'notifications'
  if (pathname === '/app/history') return 'personal-list'
  if (pathname === '/app/profile' || pathname === '/app/settings') return 'profile'

  return 'default'
}

function RhBackgroundDecor() {
  return (
    <div className="gmes-rh-bg__decor" aria-hidden="true">
      <span className="gmes-rh-bg__shape gmes-rh-bg__shape--orb" />
      <span className="gmes-rh-bg__shape gmes-rh-bg__shape--ring" />
      <span className="gmes-rh-bg__shape gmes-rh-bg__shape--blob" />
      <span className="gmes-rh-bg__shape gmes-rh-bg__shape--arc" />
      <span className="gmes-rh-bg__shape gmes-rh-bg__shape--dots" />
    </div>
  )
}

function getDirectorBackgroundVariant(pathname, role) {
  if (role !== ROLES.DIRECTEUR) return null

  if (pathname === '/app/dashboard') return 'dashboard'
  if (pathname === '/app/director-all-requests') return 'requests'
  if (pathname.startsWith('/app/director-all-requests/')) return 'request-detail'
  if (pathname === '/app/director-presence') return 'presence'
  if (pathname === '/app/director-statistics') return 'statistics'
  if (pathname === '/app/director-exports') return 'exports'

  if (
    pathname === '/app/director-availability' ||
    pathname.startsWith('/app/director-availability/')
  ) {
    return 'availability'
  }

  if (pathname === '/app/director-unavailability') return 'unavailability'
  if (pathname === '/app/notifications') return 'notifications'
  if (pathname === '/app/profile' || pathname === '/app/settings') return 'profile'

  return 'default'
}

function DirectorBackgroundDecor() {
  return (
    <div className="gmes-director-bg__decor" aria-hidden="true">
      <span className="gmes-director-bg__shape gmes-director-bg__shape--orb" />
      <span className="gmes-director-bg__shape gmes-director-bg__shape--ring" />
      <span className="gmes-director-bg__shape gmes-director-bg__shape--blob" />
      <span className="gmes-director-bg__shape gmes-director-bg__shape--arc" />
      <span className="gmes-director-bg__shape gmes-director-bg__shape--dots" />
    </div>
  )
}

function getAdminBackgroundVariant(pathname, role) {
  if (role !== ROLES.ADMIN) return null

  if (pathname === '/app/dashboard') return 'dashboard'
  if (pathname === '/app/admin-users') return 'users'
  if (pathname === '/app/admin-services') return 'services'
  if (pathname === '/app/admin-validators') return 'validators'
  if (pathname === '/app/admin-leave-types') return 'leave-types'
  if (pathname === '/app/admin-minimum-presence') return 'minimum-presence'
  if (pathname === '/app/admin-summer-period') return 'summer'
  if (pathname === '/app/admin-holidays') return 'holidays'
  if (pathname === '/app/admin-technical-logs') return 'technical-logs'
  if (pathname === '/app/notifications') return 'notifications'
  if (pathname === '/app/profile' || pathname === '/app/settings') return 'profile'

  return 'default'
}

function AdminBackgroundDecor() {
  return (
    <div className="gmes-admin-bg__decor" aria-hidden="true">
      <span className="gmes-admin-bg__shape gmes-admin-bg__shape--orb" />
      <span className="gmes-admin-bg__shape gmes-admin-bg__shape--ring" />
      <span className="gmes-admin-bg__shape gmes-admin-bg__shape--blob" />
      <span className="gmes-admin-bg__shape gmes-admin-bg__shape--arc" />
      <span className="gmes-admin-bg__shape gmes-admin-bg__shape--grid" />
    </div>
  )
}

function CollaboratorBackgroundDecor() {
  return (
    <div className="gmes-collab-bg__decor" aria-hidden="true">
      <span className="gmes-collab-bg__shape gmes-collab-bg__shape--orb" />
      <span className="gmes-collab-bg__shape gmes-collab-bg__shape--ring" />
      <span className="gmes-collab-bg__shape gmes-collab-bg__shape--blob" />
      <span className="gmes-collab-bg__shape gmes-collab-bg__shape--arc" />
      <span className="gmes-collab-bg__shape gmes-collab-bg__shape--dots" />
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const { user, effectiveRole } = useAuth()
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia('(max-width: 1024px) and (min-width: 768px)').matches,
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const tabletQuery = window.matchMedia('(max-width: 1024px) and (min-width: 768px)')
    const syncCollapsed = (event) => setCollapsed(event.matches)

    setCollapsed(tabletQuery.matches)
    tabletQuery.addEventListener?.('change', syncCollapsed)

    return () => tabletQuery.removeEventListener?.('change', syncCollapsed)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.classList.toggle('gmes-mobile-nav-open', mobileOpen)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }

    if (mobileOpen) window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.classList.remove('gmes-mobile-nav-open')
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileOpen])
  const collaboratorBackgroundVariant = getCollaboratorBackgroundVariant(
    location.pathname,
    effectiveRole,
  )
  const managerBackgroundVariant = getManagerBackgroundVariant(
    location.pathname,
    effectiveRole,
  )
  const rhBackgroundVariant = getRhBackgroundVariant(
    location.pathname,
    effectiveRole,
  )
  const directorBackgroundVariant = getDirectorBackgroundVariant(
    location.pathname,
    effectiveRole,
  )
  const adminBackgroundVariant = getAdminBackgroundVariant(
    location.pathname,
    effectiveRole,
  )

  const shellClassName = [
    'app-shell',
    collapsed ? 'app-shell--collapsed' : '',
    mobileOpen ? 'app-shell--mobile-open' : '',
    effectiveRole ? `app-shell--role-${String(effectiveRole).toLowerCase().replaceAll('_', '-')}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentClassName = [
    'app-shell__content',
    collaboratorBackgroundVariant ? 'gmes-collab-bg' : '',
    collaboratorBackgroundVariant
      ? `gmes-collab-bg--${collaboratorBackgroundVariant}`
      : '',
    managerBackgroundVariant ? 'gmes-manager-bg' : '',
    managerBackgroundVariant
      ? `gmes-manager-bg--${managerBackgroundVariant}`
      : '',
    rhBackgroundVariant ? 'gmes-rh-bg' : '',
    rhBackgroundVariant
      ? `gmes-rh-bg--${rhBackgroundVariant}`
      : '',
    directorBackgroundVariant ? 'gmes-director-bg' : '',
    directorBackgroundVariant
      ? `gmes-director-bg--${directorBackgroundVariant}`
      : '',
    adminBackgroundVariant ? 'gmes-admin-bg' : '',
    adminBackgroundVariant
      ? `gmes-admin-bg--${adminBackgroundVariant}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClassName}>
      {mobileOpen && (
        <button
          type="button"
          className="app-shell__backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        />
      )}
      <Sidebar collapsed={collapsed} onCloseMobile={() => setMobileOpen(false)} />
      <div className="app-shell__main">
        <Header
          onOpenMobile={() => setMobileOpen((value) => !value)}
          mobileOpen={mobileOpen}
        />
        <main className={contentClassName}>
          {collaboratorBackgroundVariant && <CollaboratorBackgroundDecor />}
          {managerBackgroundVariant && <ManagerBackgroundDecor />}
          {rhBackgroundVariant && <RhBackgroundDecor />}
          {directorBackgroundVariant && <DirectorBackgroundDecor />}
          {adminBackgroundVariant && <AdminBackgroundDecor />}
          <PageContainer>
            <div className="app-page-motion" key={location.pathname}>
              <Outlet />
            </div>
          </PageContainer>
        </main>
      </div>
    </div>
  )
}
