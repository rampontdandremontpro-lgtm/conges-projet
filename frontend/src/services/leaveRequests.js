import { apiClient } from '@/services/apiClient'

const OFFICIAL_MARTINIQUE_HOLIDAYS_URL =
  'https://calendrier.api.gouv.fr/jours-feries/martinique.json'

let officialMartiniqueHolidaysPromise = null

async function getOfficialMartiniqueHolidays(year) {
  if (!officialMartiniqueHolidaysPromise) {
    officialMartiniqueHolidaysPromise = fetch(OFFICIAL_MARTINIQUE_HOLIDAYS_URL, {
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.json()
      })
      .catch((error) => {
        officialMartiniqueHolidaysPromise = null
        throw error
      })
  }

  const payload = await officialMartiniqueHolidaysPromise
  const prefix = `${year}-`

  return Object.entries(payload ?? {})
    .filter(([date, name]) => date.startsWith(prefix) && typeof name === 'string')
    .map(([date, name]) => ({
      id: `official-${date}`,
      date,
      name,
      holidayType: 'MARTINIQUE',
      deductible: false,
      source: 'calendrier.api.gouv.fr',
      isActive: true,
    }))
}

export async function getLeaveTypes() {
  const { data } = await apiClient.get('/leave-types')
  return data
}

export async function getHolidays(year) {
  const [backendResult, officialResult] = await Promise.allSettled([
    apiClient.get(`/holidays?year=${year}`),
    getOfficialMartiniqueHolidays(year),
  ])

  const backendHolidays =
    backendResult.status === 'fulfilled' && Array.isArray(backendResult.value.data)
      ? backendResult.value.data
      : []
  const officialHolidays =
    officialResult.status === 'fulfilled' && Array.isArray(officialResult.value)
      ? officialResult.value
      : []

  const byDate = new Map()
  for (const holiday of backendHolidays) {
    if (holiday?.date) {
      byDate.set(String(holiday.date).slice(0, 10), holiday)
    }
  }
  for (const holiday of officialHolidays) {
    byDate.set(holiday.date, holiday)
  }

  return [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  )
}

export async function getSeasonalPeriod() {
  const { data } = await apiClient.get('/settings/seasonal-period')
  return data
}

export async function getMyDerogations() {
  const { data } = await apiClient.get('/derogations/my')
  return data
}

export async function createLeaveRequest(payload) {
  const { data } = await apiClient.post('/leave-requests', payload)
  return data
}

export async function updateLeaveRequest(id, payload) {
  const { data } = await apiClient.patch(`/leave-requests/${id}`, payload)
  return data
}

export async function submitLeaveRequest(id, payload) {
  const { data } = await apiClient.post(`/leave-requests/${id}/submit`, payload)
  return data
}

export async function requestDerogation(payload) {
  const { data } = await apiClient.post('/derogations', payload)
  return data
}
