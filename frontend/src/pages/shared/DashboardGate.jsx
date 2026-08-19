import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/config/navigation'
import { Preview } from '@/pages/shared/Preview'
import { DashboardCollaborateur } from '@/pages/collab/DashboardPage'
import { DashboardResponsable } from '@/pages/manager/DashboardPage'
import { DashboardRh } from '@/pages/rh/DashboardPage'
import { DashboardDirecteur } from '@/pages/director/DashboardPage'
import { AdminDashboardPage } from '@/pages/admin/DashboardPage'

export function DashboardGate() {
  const { user } = useAuth()
  if (user?.role === ROLES.COLLABORATEUR) {
    return <DashboardCollaborateur />
  }

  if (user?.role === ROLES.RESPONSABLE_SERVICE) {
    return <DashboardResponsable />
  }

  if (user?.role === ROLES.RH) {
    return <DashboardRh />
  }

  if (user?.role === ROLES.DIRECTEUR) {
    return <DashboardDirecteur />
  }

  if (user?.role === ROLES.ADMIN) {
    return <AdminDashboardPage />
  }

  return <Preview />
}
