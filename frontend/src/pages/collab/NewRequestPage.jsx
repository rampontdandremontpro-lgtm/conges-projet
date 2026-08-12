import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Toast } from '@/components/ui/Toast'
import { Icon } from '@/components/ui/Icon'
import { HalfDaySelector } from '@/components/collab/new-request/HalfDaySelector'
import { LeaveCalendar } from '@/components/collab/new-request/LeaveCalendar'
import { LeaveTypeSelector } from '@/components/collab/new-request/LeaveTypeSelector'
import { RecapCard } from '@/components/collab/new-request/RecapCard'
import { SignatureModal } from '@/components/collab/new-request/SignatureModal'
import {
  createLeaveRequest,
  getMyDerogations,
  requestDerogation,
  submitLeaveRequest,
  updateLeaveRequest,
} from '@/services/leaveRequests'
import {
  currentMonth,
  errorMessage,
  nextMonthOf,
  prevMonthOf,
  selectPrimaryBalance,
} from '@/utils/newRequest'
import { useNewRequestResources } from '@/hooks/collab/useNewRequestResources'

import '@/styles/newrequest.css'

export function NewRequest() {
  const navigate = useNavigate()

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
  const { resources, todayIso, retryResources, setDerogations } =
    useNewRequestResources(months, setSelection)

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
      if (prev.startDate && iso === prev.startDate) {
        return { ...prev, startDate: null, endDate: null }
      }
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
      setDerogations(updated)
      showToast('success', 'Dérogation demandée — la RH va examiner votre demande.')
      return true
    } catch (error) {
      showToast('error', errorMessage(error))
      throw error
    }
  }

  const hasCompleteRange = Boolean(
    selection.startDate && selection.endDate && selection.startDate !== selection.endDate,
  )

  const requestLabel =
    selection.startDate && selection.endDate && selectedType
      ? `${selectedType.name} — du ${selection.startDate} au ${selection.endDate}`
      : ''

  return (
    <div className="nr-page">
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
        <div className="nr-grid">
          <div className="nr-col nr-col--main">
            <LeaveTypeSelector
              leaveTypes={displayLeaveTypes}
              selectedId={selection.leaveTypeId}
              onSelect={(leaveTypeId) =>
                setSelection((prev) => ({ ...prev, leaveTypeId }))
              }
            />

            <section className="nr-cal-card">
              <LeaveCalendar
                months={months}
                todayIso={todayIso}
                selection={selection}
                holidays={resources.holidays}
                onPick={handlePick}
                onPrev={goPrev}
                onNext={goNext}
              />
            </section>

            {hasCompleteRange && selectedType?.allowsHalfDays && (
              <HalfDaySelector
                startPeriod={selection.startPeriod}
                endPeriod={selection.endPeriod}
                onStartChange={(startPeriod) =>
                  setSelection((prev) => ({ ...prev, startPeriod }))
                }
                onEndChange={(endPeriod) =>
                  setSelection((prev) => ({ ...prev, endPeriod }))
                }
              />
            )}
          </div>

          <div className="nr-col nr-col--side">
            <RecapCard
              selection={selection}
              leaveType={selectedType}
              balance={balance}
              settings={resources.settings}
              seasonal={resources.seasonal}
              holidays={resources.holidays}
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
    </div>
  )
}
