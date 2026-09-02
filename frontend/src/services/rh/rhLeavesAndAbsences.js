import { apiClient } from '@/services/apiClient'
import { getRhAllRequests } from '@/services/rh/rhAllRequests'
import { getRhPendingRequests } from '@/services/rh/rhRequests'
import {
  getRhAbsenceDeclarations,
  getRhAbsenceEmployees,
  getRhAbsenceTypes,
} from '@/services/rh/rhAbsences'
import { getRhLeaveTypes } from '@/services/rh/rhLeaveTypes'
import { isReservedDirectorLeaveType } from '@/utils/filterOptions'

export async function getRhLeavesAndAbsencesData() {
  const [leaves, actionableLeaves, absences, employees, absenceTypes, allLeaveTypes, servicesResponse] = await Promise.all([
    getRhAllRequests(),
    getRhPendingRequests().catch(() => []),
    getRhAbsenceDeclarations(),
    getRhAbsenceEmployees(),
    getRhAbsenceTypes(),
    getRhLeaveTypes(),
    apiClient.get('/services'),
  ])

  const leaveTypes = (Array.isArray(allLeaveTypes) ? allLeaveTypes : [])
    .filter((type) => type?.isActive && type?.category === 'DEMANDE_CONGE' && !isReservedDirectorLeaveType(type))
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'fr'))

  const services = Array.isArray(servicesResponse?.data) ? servicesResponse.data : []

  const actionableLeaveIds = (Array.isArray(actionableLeaves) ? actionableLeaves : []).map((item) => String(item.id))

  return { leaves, actionableLeaveIds, absences, employees, absenceTypes, leaveTypes, services }
}

export async function createRhDirectLeave(payload) {
  const { data } = await apiClient.post('/leave-requests/rh/direct', payload)
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'rh-direct-leave' } }))
  return data
}
