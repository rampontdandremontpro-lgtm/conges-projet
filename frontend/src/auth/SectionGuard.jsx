import { useParams } from 'react-router-dom'

import { RoleRoute } from '@/auth/RoleRoute'
import { NAVIGATION } from '@/config/navigation'
import { Preview } from '@/pages/Preview'

export function SectionGuard() {
  const { section } = useParams()

  const allowedRoles = Object.keys(NAVIGATION).filter((role) =>
    NAVIGATION[role].some((item) => item.id === section),
  )

  return (
    <RoleRoute roles={allowedRoles}>
      <Preview />
    </RoleRoute>
  )
}
