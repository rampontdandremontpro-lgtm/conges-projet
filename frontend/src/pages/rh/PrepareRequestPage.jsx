import { ProfileAvatar } from '@/components/ui/ProfileAvatar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { HalfDaySelector } from '@/components/collab/new-request/HalfDaySelector'
import { LeaveCalendar } from '@/components/collab/new-request/LeaveCalendar'
import { LeaveTypeSelector } from '@/components/collab/new-request/LeaveTypeSelector'
import { RecapCard } from '@/components/collab/new-request/RecapCard'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { useNewRequestResources } from '@/hooks/collab/useNewRequestResources'
import { createLeaveRequest } from '@/services/leaveRequests'
import { getRhEligibleCollaborators } from '@/services/rh/rhPrepareRequest'
import { currentMonth, errorMessage, nextMonthOf, prevMonthOf } from '@/utils/newRequest'
import { notifyAppDataChanged } from '@/utils/dataRefresh'
import { referencePeriodForIsoDate } from '@/utils/referencePeriods'

import '@/styles/collab/new-request/index.css'
import '@/styles/rh/prepare-request.css'

export function RhPrepareRequestPage() {
  const navigate = useNavigate()
  const [collaborators, setCollaborators] = useState([])
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(true)
  const [collaboratorsError, setCollaboratorsError] = useState(false)
  const [employeeId, setEmployeeId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [selection, setSelection] = useState({
    leaveTypeId: null,
    startDate: null,
    endDate: null,
    startPeriod: 'MATIN',
    endPeriod: 'APRES_MIDI',
  })
  const [months, setMonths] = useState(() => {
    const first = currentMonth()
    return [first, nextMonthOf(first)]
  })

  const { resources, todayIso, retryResources } = useNewRequestResources(
    months,
    setSelection,
    { balanceEmployeeId: employeeId, includeDerogations: false },
  )

  const loadCollaborators = useCallback(async () => {
    setCollaboratorsLoading(true)
    setCollaboratorsError(false)
    try {
      setCollaborators(await getRhEligibleCollaborators())
    } catch {
      setCollaborators([])
      setCollaboratorsError(true)
    } finally {
      setCollaboratorsLoading(false)
    }
  }, [])

  useEffect(() => { loadCollaborators() }, [loadCollaborators])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const selectedEmployee = useMemo(
    () => collaborators.find((user) => Number(user.id) === Number(employeeId)) ?? null,
    [collaborators, employeeId],
  )
  const selectedType = resources.leaveTypes.find((type) => type.id === selection.leaveTypeId)
  const requestReferencePeriod = referencePeriodForIsoDate(selection.startDate)
  const periodSummary = resources.periodSummaries.find((item) => item.referencePeriod === requestReferencePeriod) ?? null
  const displayLeaveTypes = useMemo(
    () => [...resources.leaveTypes].sort((a, b) =>
      a.deductsPaidLeaveBalance === b.deductsPaidLeaveBalance
        ? 0
        : a.deductsPaidLeaveBalance ? -1 : 1,
    ),
    [resources.leaveTypes],
  )

  const resetPreparedData = (nextEmployeeId) => {
    const first = currentMonth()
    setEmployeeId(nextEmployeeId)
    setSelection((previous) => ({
      leaveTypeId: previous.leaveTypeId,
      startDate: null,
      endDate: null,
      startPeriod: 'MATIN',
      endPeriod: 'APRES_MIDI',
    }))
    setMonths([first, nextMonthOf(first)])
  }

  const handlePick = (iso) => {
    setSelection((prev) => {
      if (!prev.startDate) return { ...prev, startDate: iso, endDate: iso }
      if (prev.startDate === prev.endDate) {
        if (iso === prev.startDate) return { ...prev, startDate: null, endDate: null }
        if (iso < prev.startDate) return { ...prev, startDate: iso, endDate: prev.startDate }
        return { ...prev, endDate: iso }
      }
      return { ...prev, startDate: iso, endDate: iso }
    })
  }

  const goPrev = () => setMonths(([first, second]) => {
    const newFirst = prevMonthOf(first)
    const limit = new Date()
    limit.setFullYear(limit.getFullYear() - 2)
    if (newFirst.year < limit.getFullYear() || (newFirst.year === limit.getFullYear() && newFirst.month < limit.getMonth())) return [first, second]
    return [newFirst, first]
  })

  const goNext = () => setMonths(([first, second]) => {
    const newSecond = nextMonthOf(second)
    const limit = new Date()
    limit.setFullYear(limit.getFullYear() + 3)
    if (newSecond.year > limit.getFullYear() || (newSecond.year === limit.getFullYear() && newSecond.month > limit.getMonth())) return [first, second]
    return [second, newSecond]
  })

  const handlePrepare = async () => {
    if (!employeeId || !selection.leaveTypeId || !selection.startDate || !selection.endDate || saving) return
    setSaving(true)
    try {
      const saved = await createLeaveRequest({
        employeeId: Number(employeeId),
        leaveTypeId: selection.leaveTypeId,
        startDate: selection.startDate,
        endDate: selection.endDate,
        startPeriod: selection.startPeriod,
        endPeriod: selection.endPeriod,
      })
      notifyAppDataChanged({ source: 'leave-request', action: 'prepared-by-rh', id: saved.id })
      const employeeName = `${selectedEmployee?.nom ?? ''} ${selectedEmployee?.prenom ?? ''}`.trim() || 'le collaborateur'
      navigate('/app/rh-all-requests', {
        replace: true,
        state: {
          flash: {
            kind: 'success',
            message: `Brouillon préparé pour ${employeeName}. Il est maintenant disponible dans son espace Mes demandes pour vérification, signature et soumission.`,
          },
        },
      })
    } catch (error) {
      setToast({ kind: 'error', message: errorMessage(error) })
      setSaving(false)
    }
  }

  const hasCompleteRange = Boolean(selection.startDate && selection.endDate && selection.startDate !== selection.endDate)
  const employeeName = selectedEmployee ? `${selectedEmployee.nom} ${selectedEmployee.prenom}` : ''

  return (
    <div className="nr-page rh-prepare-page">
      <section className="rh-prepare-employee-card">
        <div className="rh-prepare-employee-card__heading">
          <span className="rh-prepare-employee-card__icon"><Icon name="users" size={20} /></span>
          <div>
            <h2>Collaborateur concerné</h2>
            <p>La RH prépare uniquement le brouillon. Le collaborateur reste responsable de la vérification, de la signature et de la soumission.</p>
          </div>
        </div>

        {collaboratorsLoading ? (
          <div className="rh-prepare-employee-card__state">Chargement des collaborateurs…</div>
        ) : collaboratorsError ? (
          <div className="rh-prepare-employee-card__state rh-prepare-employee-card__state--error">
            <span>Impossible de charger les collaborateurs.</span>
            <button type="button" onClick={loadCollaborators}>Réessayer</button>
          </div>
        ) : (
          <div className="rh-prepare-employee-picker">
            <label>
              <span>Choisir un collaborateur actif</span>
              <select
                value={employeeId ?? ''}
                onChange={(event) => resetPreparedData(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Sélectionner un collaborateur…</option>
                {collaborators.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.nom} {user.prenom}{user.service?.name ? ` — ${user.service.name}` : ''}
                  </option>
                ))}
              </select>
            </label>

            {selectedEmployee && (
              <div className="rh-prepare-selected-employee">
                <ProfileAvatar user={selectedEmployee} className="rh-prepare-selected-employee__avatar" />
                <div>
                  <strong>{employeeName}</strong>
                  <span>{selectedEmployee.service?.name ?? 'Service non renseigné'} · {selectedEmployee.email}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {!employeeId ? (
        <div className="rh-prepare-empty">
          <Icon name="calendar" size={28} />
          <strong>Sélectionnez d’abord le collaborateur</strong>
          <p>Le calendrier, son solde et les types de congés seront ensuite chargés pour préparer sa demande.</p>
        </div>
      ) : resources.loading ? (
        <div aria-busy="true">
          <div className="dash-card nr-skeleton-card nr-skeleton-card--types" />
          <div className="nr-grid">
            <div className="nr-col nr-col--main"><div className="dash-card nr-skeleton-card nr-skeleton-card--tall" /></div>
            <div className="nr-col nr-col--side"><div className="dash-card nr-skeleton-card nr-skeleton-card--tall" /></div>
          </div>
        </div>
      ) : resources.error ? (
        <div className="dash-card nr-page__error">
          <span className="nr-page__error-icon"><Icon name="alert" size={22} /></span>
          <p>Impossible de charger les informations du collaborateur.</p>
          <button type="button" className="nr-btn nr-btn--secondary" onClick={retryResources}>Réessayer</button>
        </div>
      ) : (
        <div className="nr-grid">
          <div className="nr-col nr-col--main">
            <LeaveTypeSelector
              leaveTypes={displayLeaveTypes}
              selectedId={selection.leaveTypeId}
              onSelect={(leaveTypeId) => setSelection((prev) => ({ ...prev, leaveTypeId }))}
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
                onStartChange={(startPeriod) => setSelection((prev) => ({ ...prev, startPeriod }))}
                onEndChange={(endPeriod) => setSelection((prev) => ({ ...prev, endPeriod }))}
              />
            )}
          </div>

          <div className="nr-col nr-col--side">
            <RecapCard
              selection={selection}
              leaveType={selectedType}
              periodSummary={periodSummary}
              requestReferencePeriod={requestReferencePeriod}
              settings={resources.settings}
              seasonal={resources.seasonal}
              holidays={resources.holidays}
              draft={null}
              dirty
              derogation={null}
              saving={saving}
              submitting={false}
              onSaveDraft={handlePrepare}
              onSubmit={() => {}}
              onRequestDerogation={() => {}}
              preparationMode
              preparedForName={employeeName}
            />
          </div>
        </div>
      )}

      <Toast kind={toast?.kind} message={toast?.message} onClose={() => setToast(null)} />
    </div>
  )
}
