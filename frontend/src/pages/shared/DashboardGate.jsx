import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/config/navigation'
import { Preview } from '@/pages/shared/Preview'
import { DashboardCollaborateur } from '@/pages/collab/DashboardPage'
import { DashboardResponsable } from '@/pages/manager/DashboardPage'

export function DashboardGate() {
  const { user } = useAuth()
  if (user?.role === ROLES.COLLABORATEUR) {
    return <DashboardCollaborateur />
  }

  if (user?.role === ROLES.RESPONSABLE_SERVICE) {
    return <DashboardResponsable />
  }

  return <Preview />
}
