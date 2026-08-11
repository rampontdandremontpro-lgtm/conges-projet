import { useCallback, useEffect, useMemo, useState } from 'react'

import { AuthContext } from '@/auth/AuthContext'
import { clearToken, getToken, setToken } from '@/auth/tokenStorage'
import { apiClient } from '@/services/apiClient'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(() => Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) {
      return undefined
    }

    let active = true

    apiClient
      .get('/auth/me')
      .then((response) => {
        if (active) {
          setUser(response.data)
        }
      })
      .catch(() => {
        clearToken()
        if (active) {
          setUser(null)
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const response = await apiClient.post('/auth/login', { email, password })
    const { accessToken, user: connectedUser } = response.data
    setToken(accessToken)
    setUser(connectedUser)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), isLoading, login, logout }),
    [user, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
