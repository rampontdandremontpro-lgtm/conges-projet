import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { PageContainer } from '@/components/ui/PageContainer'
import { getSectionLabel } from '@/config/navigation'

function getTitleFromPath(pathname) {
  if (pathname === '/') {
    return 'Bienvenue'
  }
  const match = pathname.match(/^\/app\/([^/]+)/)
  if (match) {
    return getSectionLabel(match[1]) ?? 'GMES'
  }
  return 'GMES'
}

export function AppLayout() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia('(max-width: 1024px)').matches,
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [previewRole, setPreviewRole] = useState('COLLABORATEUR')

  const title = getTitleFromPath(location.pathname)

  const shellClassName = [
    'app-shell',
    collapsed ? 'app-shell--collapsed' : '',
    mobileOpen ? 'app-shell--mobile-open' : '',
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
      <Sidebar
        role={previewRole}
        onRoleChange={setPreviewRole}
        collapsed={collapsed}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="app-shell__main">
        <Header
          title={title}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main className="app-shell__content">
          <PageContainer>
            <Outlet />
          </PageContainer>
        </main>
      </div>
    </div>
  )
}
