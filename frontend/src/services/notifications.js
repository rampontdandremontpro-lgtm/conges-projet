import { apiClient } from '@/services/apiClient'

export async function getMyNotifications(params = {}, scope) {
  const query = { ...params }
  if (scope) {
    query.scope = scope
  }
  const response = await apiClient.get('/notifications/my', { params: query })
  return Array.isArray(response.data) ? response.data : []
}

export async function getUnreadNotificationCount(scope) {
  const response = await apiClient.get('/notifications/my/unread-count', {
    params: scope ? { scope } : {},
  })
  const count = Number(response.data?.unreadCount)
  return Number.isFinite(count) && count > 0 ? count : 0
}

export async function markNotificationRead(notificationId, scope) {
  const response = await apiClient.patch(`/notifications/${notificationId}/read`, null, {
    params: scope ? { scope } : {},
  })
  return response.data
}

export async function markAllNotificationsRead(scope) {
  const response = await apiClient.patch('/notifications/my/read-all', null, {
    params: scope ? { scope } : {},
  })
  return response.data
}

export async function getNotificationPreferences() {
  const response = await apiClient.get('/notifications/preferences')
  return response.data
}

export async function updateNotificationPreferences(preferences) {
  const response = await apiClient.patch('/notifications/preferences', {
    preferences,
  })
  return response.data
}

export async function resetNotificationPreferences() {
  const response = await apiClient.patch('/notifications/preferences/reset')
  return response.data
}

export async function getDashboardReminders() {
  const response = await apiClient.get('/notifications/dashboard-reminders')
  return Array.isArray(response.data) ? response.data : []
}
