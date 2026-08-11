import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageContainer } from '@/components/ui/PageContainer'
import { Toast } from '@/components/ui/Toast'
import { Icon } from '@/components/ui/Icon'
import { LeaveCalendar } from '@/components/newrequest/LeaveCalendar'
import { RecapCard } from '@/components/newrequest/RecapCard'
import { SignatureModal } from '@/components/newrequest/SignatureModal'
import { getMyLeaveBalances, getPublicSettings } from '@/services/dashboard'
import {
  createLeaveRequest,
  getHolidays,
  getLeaveTypes,
  getMyDerogations,
  getSeasonalPeriod,
  requestDerogation,
  submitLeaveRequest,
  updateLeaveRequest,
} from '@/services/leaveRequests'
import { todayISO } from '@/utils/format'

import '@/styles/newrequest.css'

const DAY_PERIODS = {
  MATIN: 'Matin',
  APRES_MIDI: 'Après-midi',
}

function SunPillIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function HalfPillIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 21a9 9 0 0 1 0-18z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function currentMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function nextMonthOf({ year, month }) {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}

function prevMonthOf({ year, month }) {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
}

function selectPrimaryBalance(balances) {
  if (!balances || balances.length === 0) return null
  const current = balances.find((balance) => balance.counterType === 'N')
  if (current) return current
  return [...balances].sort((a, b) =>
    b.referencePeriod.localeCompare(a.referencePeriod),
  )[0]
}

function settingsMap(settings) {
  return Object.fromEntries(
    (settings ?? []).map((setting) => [setting.settingKey, setting.settingValue]),
  )
}

function errorMessage(error) {
  const data = error?.response?.data
  if (Array.isArray(data?.message)) {
    return data.message.join(' — ')
  }
  if (typeof data?.message === 'string') {
    return data.message
  }
  return error?.message ?? 'Une erreur est survenue.'
}

export function NewRequest() {
  const navigate = useNavigate()

  const [resources, setResources] = useState({
    loading: true,
    error: false,
    leaveTypes: [],
    balances: [],
    holidays: [],
    settings: null,
    seasonal: null,
    derogations: [],
  })
  const [selection, setSelection] = useState({
    leaveTypeId: null,
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  })
  const [draft, setDraft] = useState(null)
  const [months, setMonths] = useState(() => {
    const first = currentMonth()
    return [first, nextMonthOf(first)]
  })
  const [todayIso, setTodayIso] = useState(() => todayISO())
  const fetchedYears = useRef(new Set())

  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((kind, message) => {
    setToast({ kind, message })
  }, [])

  useEffect(() => {
    if (!toast) {
      return undefined
    }
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

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
    const [leaveTypes, settings, seasonal, derogations, balances] =
      await Promise.all([
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
        if (cancelled) {
          return
        }
        setResources({ loading: false, error: false, holidays: [], ...data })
        setSelection((prev) => ({
          ...prev,
          leaveTypeId: prev.leaveTypeId ?? data.leaveTypes[0]?.id ?? null,
        }))
      })
      .catch(() => {
        if (!cancelled) {
          setResources((prev) => ({ ...prev, loading: false, error: true }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [fetchAll])

  const retryResources = useCallback(() => {
    setResources((prev) => ({ ...prev, loading: true, error: false }))
    fetchAll()
      .then((data) => setResources({ loading: false, error: false, holidays: [], ...data }))
      .catch(() => setResources((prev) => ({ ...prev, loading: false, error: true })))
  }, [fetchAll])

  useEffect(() => {
    const years = [
      ...new Set([months[0].year, months[1].year, months[1].year + 1]),
    ]
    const missing = years.filter((year) => !fetchedYears.current.has(year))
    if (missing.length === 0) {
      return undefined
    }
    missing.forEach((year) => fetchedYears.current.add(year))
    let cancelled = false
    Promise.all(missing.map((year) => getHolidays(year)))
      .then((results) => {
        if (cancelled) {
          return
        }
        const incoming = results.flat()
        setResources((prev) => {
          const merged = [...prev.holidays]
          for (const holiday of incoming) {
            if (!merged.some((existing) => existing.date === holiday.date)) {
              merged.push(holiday)
            }
          }
          return { ...prev, holidays: merged }
        })
      })
      .catch(() => {
        // Les jours fériés restent facultatifs : le calendrier fonctionne sans.
      })
    return () => {
      cancelled = true
    }
  }, [months])

  const balance = selectPrimaryBalance(resources.balances)
  const selectedType = resources.leaveTypes.find(
    (type) => type.id === selection.leaveTypeId,
  )

  const displayLeaveTypes = useMemo(
    () =>
      [...resources.leaveTypes].sort((a, b) =>
        a.deductsPaidLeaveBalance === b.deductsPaidLeaveBalance
          ? 0
          : a.deductsPaidLeaveBalance
            ? -1
            : 1,
      ),
    [resources.leaveTypes],
  )

  const draftMatchesSelection = Boolean(
    draft &&
      draft.leaveTypeId === selection.leaveTypeId &&
      draft.startDate === selection.startDate &&
      draft.endDate === selection.endDate &&
      draft.startPeriod === selection.startPeriod &&
      draft.endPeriod === selection.endPeriod,
  )
  const dirty = !draftMatchesSelection

  const derogation = useMemo(
    () =>
      draft
        ? resources.derogations.find(
            (item) => item.leaveRequestId === draft.id,
          ) ?? null
        : null,
    [draft, resources.derogations],
  )

  const handlePick = (iso) => {
    setSelection((prev) => {
      if (!prev.startDate || (prev.startDate && prev.endDate)) {
        return { ...prev, startDate: iso, endDate: null }
      }
      if (iso < prev.startDate) {
        return { ...prev, startDate: iso, endDate: prev.startDate }
      }
      return { ...prev, endDate: iso }
    })
  }

  const goPrev = () => {
    setMonths(([first, second]) => {
      const newFirst = prevMonthOf(first)
      const limit = new Date()
      limit.setFullYear(limit.getFullYear() - 2)
      if (
        newFirst.year < limit.getFullYear() ||
        (newFirst.year === limit.getFullYear() && newFirst.month < limit.getMonth())
      ) {
        return [first, second]
      }
      return [newFirst, first]
    })
  }

  const goNext = () => {
    setMonths(([first, second]) => {
      const newSecond = nextMonthOf(second)
      const limit = new Date()
      limit.setFullYear(limit.getFullYear() + 3)
      if (
        newSecond.year > limit.getFullYear() ||
        (newSecond.year === limit.getFullYear() && newSecond.month > limit.getMonth())
      ) {
        return [first, second]
      }
      return [second, newSecond]
    })
  }

  const handleSaveDraft = async () => {
    if (
      !selection.leaveTypeId ||
      !selection.startDate ||
      !selection.endDate ||
      saving
    ) {
      return
    }
    setSaving(true)
    try {
      const payload = {
        leaveTypeId: selection.leaveTypeId,
        startDate: selection.startDate,
        endDate: selection.endDate,
        startPeriod: selection.startPeriod,
        endPeriod: selection.endPeriod,
      }
      const saved = draft
        ? await updateLeaveRequest(draft.id, payload)
        : await createLeaveRequest(payload)
      setDraft(saved)
      showToast('success', draft ? 'Brouillon mis à jour.' : 'Brouillon enregistré.')
    } catch (error) {
      showToast('error', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (signatureType, signatureData) => {
    setSubmitting(true)
    try {
      await submitLeaveRequest(draft.id, { signatureType, signatureData })
      setSignatureOpen(false)
      showToast('success', 'Demande soumise pour validation.')
      window.setTimeout(() => navigate('/app/my-requests'), 900)
    } catch (error) {
      showToast('error', errorMessage(error))
      setSubmitting(false)
    }
  }

  const handleRequestDerogation = async ({ leaveRequestId, reason }) => {
    try {
      await requestDerogation({ leaveRequestId, reason })
      const updated = await getMyDerogations()
      setResources((prev) => ({ ...prev, derogations: updated }))
      showToast('success', 'Dérogation demandée — la RH va examiner votre demande.')
      return true
    } catch (error) {
      showToast('error', errorMessage(error))
      throw error
    }
  }

  const sameDay = selection.startDate && selection.startDate === selection.endDate

  const requestLabel =
    selection.startDate && selection.endDate && selectedType
      ? `${selectedType.name} — du ${selection.startDate} au ${selection.endDate}`
      : ''

  return (
    <PageContainer className="nr-page">
      <header className="nr-page__header">
        <div>
          <h1 className="nr-page__title">Nouvelle demande de congé</h1>
          <p className="nr-page__subtitle">
            Sélectionnez un type de congé, une période dans le calendrier, puis
            enregistrez et signez votre demande.
          </p>
        </div>
      </header>

      {resources.loading ? (
        <div aria-busy="true">
          <div className="dash-card nr-skeleton-card nr-skeleton-card--types" />
          <div className="nr-grid">
            <div className="nr-col nr-col--main">
              <div className="dash-card nr-skeleton-card nr-skeleton-card--tall" />
            </div>
            <div className="nr-col nr-col--side">
              <div className="dash-card nr-skeleton-card nr-skeleton-card--tall" />
            </div>
          </div>
        </div>
      ) : resources.error ? (
        <div className="dash-card nr-page__error">
          <span className="nr-page__error-icon">
            <Icon name="alert" size={22} />
          </span>
          <p>Impossible de charger les données nécessaires à la demande.</p>
          <button
            type="button"
            className="nr-btn nr-btn--secondary"
            onClick={() => {
              retryResources()
            }}
          >
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <section className="nr-types-card">
            <div className="nr-types-card__heading">
              <span className="dash-card__title">Type de congé</span>
              <span className="nr-types-card__count">
                {resources.leaveTypes.length} type(s) disponible(s)
              </span>
            </div>
            {resources.leaveTypes.length === 0 ? (
              <p className="nr-recap__note">
                Aucun type de congé n’est disponible pour votre profil.
              </p>
            ) : (
              <div className="nr-types">
                {displayLeaveTypes.map((type) => (
                  <button
                    type="button"
                    key={type.id}
                    className={`nr-types__pill${
                      selection.leaveTypeId === type.id ? ' nr-types__pill--active' : ''
                    }`}
                    aria-pressed={selection.leaveTypeId === type.id}
                    onClick={() =>
                      setSelection((prev) => ({ ...prev, leaveTypeId: type.id }))
                    }
                  >
                    <span className="nr-types__pill-name">{type.name}</span>
                    {type.deductsPaidLeaveBalance && (
                      <span
                        className="nr-types__pill-dot"
                        title="Déduit du solde de congés payés"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="nr-grid">
            <div className="nr-col nr-col--main">
              <section className="dash-card">
              <div className="dash-card__header">
                <div className="dash-card__heading">
                  <span className="dash-card__title">Calendrier</span>
                  <span className="dash-card__period">
                    Cliquez deux fois pour délimiter une période continue
                  </span>
                </div>
              </div>
              <LeaveCalendar
                months={months}
                todayIso={todayIso}
                selection={selection}
                holidays={resources.holidays}
                onPick={handlePick}
                onPrev={goPrev}
                onNext={goNext}
              />

              {selectedType?.allowsHalfDays && (
                <div className="nr-halfdays">
                  <div className="nr-halfdays__heading">Demi-journées</div>
                  <div className="nr-halfdays__groups">
                    <div className="nr-halfdays__group">
                      <span className="nr-halfdays__label">Début de période</span>
                      <div className="nr-halfdays__pills">
                        {Object.entries(DAY_PERIODS).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={`nr-pill${
                              selection.startPeriod === value ? ' nr-pill--active' : ''
                            }`}
                            onClick={() =>
                              setSelection((prev) => ({ ...prev, startPeriod: value }))
                            }
                          >
                            {value === 'MATIN' ? <SunPillIcon /> : <HalfPillIcon />}
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="nr-halfdays__group">
                      <span className="nr-halfdays__label">Fin de période</span>
                      <div className="nr-halfdays__pills">
                        {Object.entries(DAY_PERIODS).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={`nr-pill${
                              selection.endPeriod === value ? ' nr-pill--active' : ''
                            }`}
                            disabled={sameDay && selection.startPeriod === 'APRES_MIDI' && value === 'MATIN'}
                            onClick={() =>
                              setSelection((prev) => ({ ...prev, endPeriod: value }))
                            }
                          >
                            {value === 'MATIN' ? <SunPillIcon /> : <HalfPillIcon />}
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="nr-col nr-col--side">
            <RecapCard
              selection={selection}
              leaveType={selectedType}
              balance={balance}
              settings={resources.settings}
              seasonal={resources.seasonal}
              draft={draft}
              dirty={dirty}
              derogation={derogation}
              saving={saving}
              submitting={submitting}
                onSaveDraft={handleSaveDraft}
                onSubmit={() => setSignatureOpen(true)}
                onRequestDerogation={handleRequestDerogation}
              />
            </div>
          </div>
        </>
      )}

      <SignatureModal
        key={signatureOpen ? 'open' : 'closed'}
        open={signatureOpen}
        requestLabel={requestLabel}
        submitting={submitting}
        onClose={() => {
          if (!submitting) {
            setSignatureOpen(false)
          }
        }}
        onConfirm={handleSubmit}
      />

      <Toast kind={toast?.kind} message={toast?.message} onClose={() => setToast(null)} />
    </PageContainer>
  )
}
