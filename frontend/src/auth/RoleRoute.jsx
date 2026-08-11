import { Navigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

export function RoleRoute({ roles, children }) {
  const { user } = useAuth()

  if (!roles.includes(user?.role)) {
    return <Navigate to="/app/dashboard" replace />
  }

  return children
}
