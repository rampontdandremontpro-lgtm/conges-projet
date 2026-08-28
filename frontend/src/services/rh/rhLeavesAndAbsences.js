import { apiClient } from '@/services/apiClient'
import { getRhAllRequests } from '@/services/rh/rhAllRequests'
import {
  getRhAbsenceDeclarations,
  getRhAbsenceEmployees,
  getRhAbsenceTypes,
} from '@/services/rh/rhAbsences'
import { getRhLeaveTypes } from '@/services/rh/rhLeaveTypes'

export async function getRhLeavesAndAbsencesData() {
  const [leaves, absences, employees, absenceTypes, allLeaveTypes] = await Promise.all([
    getRhAllRequests(),
    getRhAbsenceDeclarations(),
    getRhAbsenceEmployees(),
    getRhAbsenceTypes(),
    getRhLeaveTypes(),
  ])

  const leaveTypes = (Array.isArray(allLeaveTypes) ? allLeaveTypes : [])
    .filter((type) => type?.isActive && type?.category === 'DEMANDE_CONGE')
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'fr'))

  return { leaves, absences, employees, absenceTypes, leaveTypes }
}

export async function createRhDirectLeave(payload) {
  const { data } = await apiClient.post('/leave-requests/rh/direct', payload)
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail: { source: 'rh-direct-leave' } }))
  return data
}
