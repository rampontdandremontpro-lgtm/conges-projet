import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

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
import { getLeaveRequest } from '@/services/requestDetails'
import { notifyAppDataChanged } from '@/utils/dataRefresh'

import '@/styles/collab/new-request/index.css'

function monthFromIso(iso) {
  const [year, month] = String(iso).slice(0, 10).split('-').map(Number)
  return { year, month: month - 1 }
}

export function NewRequest() {
  const navigate = useNavigate()
  const { id: editId } = useParams()
  const isEditMode = Boolean(editId)

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
  const previousEditIdRef = useRef(editId)

  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [editLoading, setEditLoading] = useState(isEditMode)
  const [editError, setEditError] = useState(false)

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
    const wasEditing = Boolean(previousEditIdRef.current)

    if (wasEditing && !isEditMode) {
      const defaultLeaveType =
        resources.leaveTypes.find((type) => type.deductsPaidLeaveBalance) ??
        resources.leaveTypes[0] ??
        null
      const first = currentMonth()

      setDraft(null)
      setSelection({
        leaveTypeId: defaultLeaveType?.id ?? null,
        startDate: null,
        endDate: null,
        startPeriod: 'MATIN',
        endPeriod: 'APRES_MIDI',
      })
      setMonths([first, nextMonthOf(first)])
      setSignatureOpen(false)
      setToast(null)
      setEditError(false)
      setEditLoading(false)
    }

    previousEditIdRef.current = editId
  }, [editId, isEditMode, resources.leaveTypes])

  useEffect(() => {
    if (!isEditMode) {
      setEditLoading(false)
      return undefined
    }

    let cancelled = false
    setEditLoading(true)
    setEditError(false)
    getLeaveRequest(editId)
      .then((request) => {
        if (cancelled) return
        if (!['BROUILLON', 'EN_ATTENTE_VALIDATION'].includes(request.status)) {
          navigate(`/app/my-requests/leave/${request.id}`, { replace: true })
          return
        }
        setDraft(request)
        setSelection({
          leaveTypeId: Number(request.leaveTypeId),
          startDate: request.startDate,
          endDate: request.endDate,
          startPeriod: request.startPeriod || 'MATIN',
          endPeriod: request.endPeriod || 'APRES_MIDI',
        })
        const first = monthFromIso(request.startDate)
        setMonths([first, nextMonthOf(first)])
      })
      .catch(() => {
        if (!cancelled) setEditError(true)
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [editId, isEditMode, navigate])

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

  const derogation = useMemo(() => {
    if (!draft) {
      return null
    }

    return (
      resources.derogations.find(
        (item) =>
          Number(item.leaveRequestId) === Number(draft.id) &&
          Number(item.leaveTypeId) === Number(selection.leaveTypeId) &&
          item.requestedStartDate === selection.startDate &&
          item.requestedEndDate === selection.endDate,
      ) ?? null
    )
  }, [
    draft,
    resources.derogations,
    selection.endDate,
    selection.leaveTypeId,
    selection.startDate,
  ])

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

  const buildPayload = () => ({
    leaveTypeId: selection.leaveTypeId,
    startDate: selection.startDate,
    endDate: selection.endDate,
    startPeriod: selection.startPeriod,
    endPeriod: selection.endPeriod,
  })

  const persistCurrentRequest = async () => {
    if (draftMatchesSelection && draft?.status !== 'EN_ATTENTE_VALIDATION') {
      return draft
    }
    const payload = buildPayload()
    const saved = draft
      ? await updateLeaveRequest(draft.id, payload)
      : await createLeaveRequest(payload)
    setDraft(saved)
    return saved
  }

  const handleSaveDraft = async () => {
    if (
      !selection.leaveTypeId ||
      !selection.startDate ||
      !selection.endDate ||
      saving ||
      submitting
    ) {
      return
    }
    setSaving(true)
    try {
      const wasExistingDraft = Boolean(draft)
      const saved = await persistCurrentRequest()
      notifyAppDataChanged({
        source: 'leave-request',
        action: wasExistingDraft ? 'updated' : 'draft-saved',
        id: saved.id,
      })
      navigate('/app/my-requests', {
        replace: true,
        state: {
          flash: {
            kind: 'success',
            message: wasExistingDraft ? 'Modifications enregistrées.' : 'Brouillon enregistré.',
          },
        },
      })
    } catch (error) {
      showToast('error', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (signatureType, signatureData) => {
    if (
      !selection.leaveTypeId ||
      !selection.startDate ||
      !selection.endDate ||
      submitting
    ) {
      return
    }
    setSubmitting(true)
    try {
      const request = await persistCurrentRequest()
      await submitLeaveRequest(request.id, { signatureType, signatureData })
      notifyAppDataChanged({ source: 'leave-request', action: 'submitted', id: request.id })
      setSignatureOpen(false)
      navigate('/app/my-requests', {
        replace: true,
        state: {
          flash: {
            kind: 'success',
            message: 'Demande soumise avec succès.',
          },
        },
      })
    } catch (error) {
      showToast('error', errorMessage(error))
      setSubmitting(false)
    }
  }

  const handleRequestDerogation = async ({ reason }) => {
    if (
      !selection.leaveTypeId ||
      !selection.startDate ||
      !selection.endDate ||
      saving ||
      submitting
    ) {
      return false
    }

    setSaving(true)
    try {
      const saved = await persistCurrentRequest()
      await requestDerogation({ leaveRequestId: saved.id, reason })
      const updated = await getMyDerogations()
      setDerogations(updated)
      notifyAppDataChanged({
        source: 'derogation',
        action: 'requested',
        id: saved.id,
      })
      showToast(
        'success',
        'Dérogation demandée — votre brouillon a été enregistré et la RH va examiner votre demande.',
      )
      return true
    } catch (error) {
      showToast('error', errorMessage(error))
      throw error
    } finally {
      setSaving(false)
    }
  }

  const hasCompleteRange = Boolean(
    selection.startDate && selection.endDate && selection.startDate !== selection.endDate,
  )

  const requestLabel =
    selection.startDate && selection.endDate && selectedType
      ? `${selectedType.name} — du ${selection.startDate} au ${selection.endDate}`
      : ''
  const preparedByRh = Boolean(
    draft?.status === 'BROUILLON' &&
    draft?.createdBy?.role === 'RH' &&
    Number(draft?.createdById) !== Number(draft?.employeeId)
  )

  return (
    <div className="nr-page">
      {preparedByRh && !editLoading && (
        <div className="nr-prepared-by-rh" role="status">
          <span className="nr-prepared-by-rh__icon"><Icon name="info" size={18} /></span>
          <div>
            <strong>Cette demande a été préparée par la RH.</strong>
            <p>Vérifiez les dates et le type de congé. Vous pouvez modifier le brouillon si nécessaire ; vous seul pouvez ensuite le signer et le soumettre.</p>
          </div>
        </div>
      )}
      {resources.loading || editLoading ? (
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
      ) : resources.error || editError ? (
        <div className="dash-card nr-page__error">
          <span className="nr-page__error-icon">
            <Icon name="alert" size={22} />
          </span>
          <p>{editError ? 'Impossible de charger la demande à modifier.' : 'Impossible de charger les données nécessaires à la demande.'}</p>
          <button
            type="button"
            className="nr-btn nr-btn--secondary"
            onClick={() => {
              if (editError) navigate('/app/my-requests')
              else retryResources()
            }}
          >
            {editError ? 'Retour à Mes demandes' : 'Réessayer'}
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
              editingExisting={isEditMode}
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
