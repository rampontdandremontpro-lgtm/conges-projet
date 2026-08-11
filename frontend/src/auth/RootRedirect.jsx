import { Navigate } from 'react-router-dom'

import { AuthLoading } from '@/auth/AuthLoading'
import { useAuth } from '@/auth/AuthContext'

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <AuthLoading />
  }

  return <Navigate to={isAuthenticated ? '/app/dashboard' : '/login'} replace />
}
