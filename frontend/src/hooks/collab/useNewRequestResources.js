import { useCallback, useEffect, useRef, useState } from 'react'

import { getEmployeeLeaveBalances, getMyLeaveBalances, getPublicSettings } from '@/services/dashboard'
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

export function useNewRequestResources(months, setSelection, options = {}) {
  const { balanceEmployeeId, includeDerogations = true } = options
  const [resources, setResources] = useState(INITIAL_RESOURCES)
  const [todayIso, setTodayIso] = useState(() => todayISO())
  const [holidayRefreshKey, setHolidayRefreshKey] = useState(0)
  const fetchedYears = useRef(new Set())

  useEffect(() => {
    const refreshToday = () => {
      setTodayIso((previous) => {
        const next = todayISO()
        return next === previous ? previous : next
      })
    }
    const timer = window.setInterval(refreshToday, 60_000)
    const refreshVisibleData = () => {
      refreshToday()
      setHolidayRefreshKey((value) => value + 1)
    }
    window.addEventListener('focus', refreshVisibleData)
    document.addEventListener('visibilitychange', refreshVisibleData)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisibleData)
      document.removeEventListener('visibilitychange', refreshVisibleData)
    }
  }, [])

  const fetchAll = useCallback(async () => {
    const balancePromise = balanceEmployeeId === null
      ? Promise.resolve([])
      : balanceEmployeeId !== undefined
        ? getEmployeeLeaveBalances(balanceEmployeeId)
        : getMyLeaveBalances()
    const derogationsPromise = includeDerogations ? getMyDerogations() : Promise.resolve([])

    const [leaveTypes, settings, seasonal, derogations, balances] = await Promise.all([
      getLeaveTypes(),
      getPublicSettings(),
      getSeasonalPeriod(),
      derogationsPromise,
      balancePromise,
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
  }, [balanceEmployeeId, includeDerogations])

  useEffect(() => {
    let cancelled = false
    setResources((previous) => ({
      ...previous,
      loading: true,
      error: false,
      balances: balanceEmployeeId !== undefined ? [] : previous.balances,
      derogations: includeDerogations ? previous.derogations : [],
    }))
    fetchAll()
      .then((data) => {
        if (cancelled) return
        setResources((previous) => ({
          ...previous,
          ...data,
          loading: false,
          error: false,
          holidays: previous.holidays,
        }))
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
  }, [balanceEmployeeId, fetchAll, includeDerogations, setSelection])

  const retryResources = useCallback(() => {
    setResources((previous) => ({ ...previous, loading: true, error: false }))
    setHolidayRefreshKey((value) => value + 1)
    fetchAll()
      .then((data) => {
        const defaultLeaveType =
          data.leaveTypes.find((type) => type.deductsPaidLeaveBalance) ??
          data.leaveTypes[0] ??
          null
        setResources((previous) => ({
          ...previous,
          ...data,
          loading: false,
          error: false,
          holidays: previous.holidays,
        }))
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
    Promise.allSettled(
      missing.map(async (year) => ({ year, holidays: await getHolidays(year) })),
    ).then((results) => {
      if (cancelled) return

      const incoming = []
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        fetchedYears.current.add(result.value.year)
        incoming.push(...result.value.holidays)
      }

      if (incoming.length === 0) return

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

    return () => {
      cancelled = true
    }
  }, [holidayRefreshKey, months])

  const setDerogations = useCallback((derogations) => {
    setResources((previous) => ({ ...previous, derogations }))
  }, [])

  return { resources, todayIso, retryResources, setDerogations }
}
