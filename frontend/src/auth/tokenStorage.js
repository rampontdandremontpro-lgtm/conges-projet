const TOKEN_KEY = 'gmes_access_token'

let accessToken = null

function clearLegacyStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Le stockage navigateur peut être indisponible selon le contexte.
  }

  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Le stockage navigateur peut être indisponible selon le contexte.
  }
}

clearLegacyStoredToken()

export function getToken() {
  return accessToken
}

export function setToken(token) {
  accessToken = typeof token === 'string' && token.trim() ? token : null
  clearLegacyStoredToken()
}

export function clearToken() {
  accessToken = null
  clearLegacyStoredToken()
}
