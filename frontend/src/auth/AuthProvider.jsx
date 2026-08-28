import { useCallback, useEffect, useMemo, useState } from 'react'

import { AuthContext } from '@/auth/AuthContext'
import { clearToken, getToken, setToken } from '@/auth/tokenStorage'
import { apiClient } from '@/services/apiClient'

const PROFILE_MODE_KEY = 'gmes-profile-mode'
const PROFILE_SWITCH_ROLES = new Set(['RH', 'RESPONSABLE_SERVICE'])

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profileMode, setProfileMode] = useState(() => sessionStorage.getItem(PROFILE_MODE_KEY) === 'COLLABORATOR' ? 'COLLABORATOR' : 'MANAGEMENT')
  const [isLoading, setIsLoading] = useState(() => Boolean(getToken()))

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      return null
    }
    const response = await apiClient.get('/auth/me')
    setUser(response.data)
    return response.data
  }, [])

  useEffect(() => {
    if (!getToken()) {
      return undefined
    }

    let active = true

    refreshUser()
      .then(() => undefined)
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
  }, [refreshUser])

  const login = useCallback(async (email, password) => {
    const response = await apiClient.post('/auth/login', { email, password })
    const { accessToken, user: connectedUser } = response.data
    setToken(accessToken)
    sessionStorage.removeItem(PROFILE_MODE_KEY)
    setProfileMode('MANAGEMENT')
    setUser(connectedUser)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    sessionStorage.removeItem(PROFILE_MODE_KEY)
    setProfileMode('MANAGEMENT')
    setUser(null)
  }, [])

  const canSwitchProfile = Boolean(user && PROFILE_SWITCH_ROLES.has(user.role))
  const effectiveRole = canSwitchProfile && profileMode === 'COLLABORATOR'
    ? 'COLLABORATEUR'
    : user?.role ?? null

  const switchProfile = useCallback((mode) => {
    const nextMode = mode === 'COLLABORATOR' ? 'COLLABORATOR' : 'MANAGEMENT'
    setProfileMode(nextMode)
    sessionStorage.setItem(PROFILE_MODE_KEY, nextMode)
  }, [])

  const availableProfiles = canSwitchProfile
    ? [
        { id: 'MANAGEMENT', label: 'Profil administrateur', role: user.role },
        { id: 'COLLABORATOR', label: 'Profil collaborateur', role: 'COLLABORATEUR' },
      ]
    : []

  const value = useMemo(
    () => ({
      user,
      effectiveRole,
      profileMode,
      availableProfiles,
      switchProfile,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout,
      refreshUser,
    }),
    [user, effectiveRole, profileMode, availableProfiles, switchProfile, isLoading, login, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
