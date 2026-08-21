import { apiClient } from '@/services/apiClient'

export async function getMyNotifications(params = {}) {
  const response = await apiClient.get('/notifications/my', { params })
  return Array.isArray(response.data) ? response.data : []
}

export async function getUnreadNotificationCount() {
  const response = await apiClient.get('/notifications/my/unread-count')
  const count = Number(response.data?.unreadCount)
  return Number.isFinite(count) && count > 0 ? count : 0
}

export async function markNotificationRead(notificationId) {
  const response = await apiClient.patch(`/notifications/${notificationId}/read`)
  return response.data
}

export async function markAllNotificationsRead() {
  const response = await apiClient.patch('/notifications/my/read-all')
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
