import { useAuth } from '@/auth/AuthContext'
import { ROLES } from '@/config/navigation'
import { Preview } from '@/pages/shared/Preview'
import { DashboardCollaborateur } from '@/pages/collab/DashboardPage'

export function DashboardGate() {
  const { user } = useAuth()
  return user?.role === ROLES.COLLABORATEUR ? (
    <DashboardCollaborateur />
  ) : (
    <Preview />
  )
}
