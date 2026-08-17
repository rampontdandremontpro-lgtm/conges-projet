import { useCallback, useEffect, useRef, useState } from 'react'

import { getMyLeaveBalances, getPublicSettings } from '@/services/dashboard'
import {
  getHolidays,
  getLeaveTypes,
  getMyDerogations,
  getSeasonalPeriod,
} from '@/services/leaveRequests'
import { todayISO } from '@/utils/format'
import { settingsMap } from '@/utils/newRequest'

const INITIAL_RESOURCES = {
  loading: true,
  error: false,
  leaveTypes: [],
  balances: [],
  holidays: [],
  settings: null,
  seasonal: null,
  derogations: [],
}

export function useNewRequestResources(months, setSelection) {
  const [resources, setResources] = useState(INITIAL_RESOURCES)
  const [todayIso, setTodayIso] = useState(() => todayISO())
  const fetchedYears = useRef(new Set())

  useEffect(() => {
    const refreshToday = () => {
      setTodayIso((previous) => {
        const next = todayISO()
        return next === previous ? previous : next
      })
    }
    const timer = window.setInterval(refreshToday, 60_000)
    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', refreshToday)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshToday)
      document.removeEventListener('visibilitychange', refreshToday)
    }
  }, [])

  const fetchAll = useCallback(async () => {
    const [leaveTypes, settings, seasonal, derogations, balances] = await Promise.all([
      getLeaveTypes(),
      getPublicSettings(),
      getSeasonalPeriod(),
      getMyDerogations(),
      getMyLeaveBalances(),
    ])
    const filtered = leaveTypes.filter(
      (type) =>
        type.category === 'DEMANDE_CONGE' &&
        type.isActive &&
        type.employeeCanCreate &&
        !type.rhOnly,
    )
    return {
      leaveTypes: filtered,
      balances,
      settings: settingsMap(settings),
      seasonal,
      derogations,
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAll()
      .then((data) => {
        if (cancelled) return
        setResources({ loading: false, error: false, holidays: [], ...data })
        const defaultLeaveType =
          data.leaveTypes.find((type) => type.deductsPaidLeaveBalance) ??
          data.leaveTypes[0] ??
          null
        setSelection((previous) => ({
          ...previous,
          leaveTypeId: previous.leaveTypeId ?? defaultLeaveType?.id ?? null,
        }))
      })
      .catch(() => {
        if (!cancelled) {
          setResources((previous) => ({ ...previous, loading: false, error: true }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [fetchAll, setSelection])

  const retryResources = useCallback(() => {
    setResources((previous) => ({ ...previous, loading: true, error: false }))
    fetchAll()
      .then((data) => {
        const defaultLeaveType =
          data.leaveTypes.find((type) => type.deductsPaidLeaveBalance) ??
          data.leaveTypes[0] ??
          null
        setResources({ loading: false, error: false, holidays: [], ...data })
        setSelection((previous) => ({
          ...previous,
          leaveTypeId: previous.leaveTypeId ?? defaultLeaveType?.id ?? null,
        }))
      })
      .catch(() =>
        setResources((previous) => ({ ...previous, loading: false, error: true })),
      )
  }, [fetchAll, setSelection])

  useEffect(() => {
    const years = [...new Set([months[0].year, months[1].year, months[1].year + 1])]
    const missing = years.filter((year) => !fetchedYears.current.has(year))
    if (missing.length === 0) return undefined

    let cancelled = false
    Promise.all(missing.map((year) => getHolidays(year)))
      .then((results) => {
        if (cancelled) return
        missing.forEach((year) => fetchedYears.current.add(year))
        const incoming = results.flat()
        setResources((previous) => {
          const merged = [...previous.holidays]
          const priority = (holiday) =>
            holiday?.holidayType === 'FERMETURE_GMES' ? 2 : 1

          for (const holiday of incoming) {
            const date = String(holiday?.date ?? '').slice(0, 10)
            if (!date) continue

            const index = merged.findIndex(
              (existing) => String(existing?.date ?? '').slice(0, 10) === date,
            )
            if (index === -1) {
              merged.push(holiday)
            } else if (priority(holiday) > priority(merged[index])) {
              merged[index] = holiday
            }
          }
          return { ...previous, holidays: merged }
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [months])

  const setDerogations = useCallback((derogations) => {
    setResources((previous) => ({ ...previous, derogations }))
  }, [])

  return { resources, todayIso, retryResources, setDerogations }
}
