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
