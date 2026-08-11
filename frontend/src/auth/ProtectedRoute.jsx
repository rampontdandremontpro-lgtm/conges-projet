import { Navigate } from 'react-router-dom'

import { AuthLoading } from '@/auth/AuthLoading'
import { useAuth } from '@/auth/AuthContext'

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <AuthLoading />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}
