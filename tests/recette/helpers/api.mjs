import { config } from './config.mjs'

export async function apiRequest(path, options = {}) {
  const { method = 'GET', token, body, headers } = options
  const response = await fetch(`${config.API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const contentType = response.headers.get('content-type') ?? ''
  let data = null
  if (response.status !== 204) {
    data = contentType.includes('application/json')
      ? await response.json()
      : await response.text()
  }

  return { status: response.status, data, headers: response.headers }
}
