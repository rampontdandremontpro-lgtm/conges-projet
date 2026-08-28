import { getRhAllRequests } from '@/services/rh/rhAllRequests'
import {
  getRhAbsenceDeclarations,
  getRhAbsenceEmployees,
  getRhAbsenceTypes,
} from '@/services/rh/rhAbsences'

export async function getRhLeavesAndAbsencesData() {
  const [leaves, absences, employees, absenceTypes] = await Promise.all([
    getRhAllRequests(),
    getRhAbsenceDeclarations(),
    getRhAbsenceEmployees(),
    getRhAbsenceTypes(),
  ])

  return { leaves, absences, employees, absenceTypes }
}
