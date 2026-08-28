import { Navigate, useLocation } from 'react-router-dom'

import { AuthLoading } from '@/auth/AuthLoading'
import { useAuth } from '@/auth/AuthContext'

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <AuthLoading />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.mustChangePassword && location.pathname !== '/app/settings') {
    return <Navigate to="/app/settings" replace state={{ forcedPasswordChange: true }} />
  }

  return children
}
