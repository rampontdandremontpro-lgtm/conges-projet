import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/config/navigation'
import { Preview } from '@/pages/shared/Preview'
import { DashboardCollaborateur } from '@/pages/collab/DashboardPage'
import { DashboardResponsable } from '@/pages/manager/DashboardPage'
import { DashboardRh } from '@/pages/rh/DashboardPage'
import { DashboardDirecteur } from '@/pages/director/DashboardPage'
import { AdminDashboardPage } from '@/pages/admin/DashboardPage'

export function DashboardGate() {
  const { effectiveRole } = useAuth()
  if (effectiveRole === ROLES.COLLABORATEUR) {
    return <DashboardCollaborateur />
  }

  if (effectiveRole === ROLES.RESPONSABLE_SERVICE) {
    return <DashboardResponsable />
  }

  if (effectiveRole === ROLES.RH) {
    return <DashboardRh />
  }

  if (effectiveRole === ROLES.DIRECTEUR) {
    return <DashboardDirecteur />
  }

  if (effectiveRole === ROLES.ADMIN) {
    return <AdminDashboardPage />
  }

  return <Preview />
}
