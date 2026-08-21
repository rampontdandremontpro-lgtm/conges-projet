import { Navigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

export function RoleRoute({ roles, children }) {
  const { effectiveRole } = useAuth()

  if (!roles.includes(effectiveRole)) {
    return <Navigate to="/app/dashboard" replace />
  }

  return children
}
