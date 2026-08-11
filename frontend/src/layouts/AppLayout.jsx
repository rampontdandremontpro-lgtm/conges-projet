import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { PageContainer } from '@/components/ui/PageContainer'

export function AppLayout() {
  const [collapsed] = useState(
    () => window.matchMedia('(max-width: 1024px) and (min-width: 768px)').matches,
  )
  const [mobileOpen, setMobileOpen] = useState(false)

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
      <Sidebar collapsed={collapsed} onCloseMobile={() => setMobileOpen(false)} />
      <div className="app-shell__main">
        <Header />
        <main className="app-shell__content">
          <PageContainer>
            <Outlet />
          </PageContainer>
        </main>
      </div>
    </div>
  )
}
