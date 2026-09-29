import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  closeRhPeriod,
  grantRhExceptionalCarryover,
  previewRhPeriodClose,
} from '@/services/rh/rhBalances'
import {
  adjacentReferencePeriodOptions,
  counterReferencePeriod,
  currentReferencePeriod,
  formatReferencePeriodRange,
} from '@/utils/referencePeriods'
import { errorMessage } from '@/utils/newRequest'

function formatDays(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} j`
}

export function PeriodClosureModal({ onClose, onChanged }) {
  const periodOptions = useMemo(() => adjacentReferencePeriodOptions(), [])
  const defaultPeriod = useMemo(
    () => counterReferencePeriod(currentReferencePeriod(), 'N-1'),
    [],
  )

  const [period, setPeriod] = useState(defaultPeriod)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [carryover, setCarryover] = useState({})
  const [carryoverBusy, setCarryoverBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const runPreview = async (targetPeriod = period) => {
    setBusy(true)
    setError('')
    setPreview(null)
    setCarryover({})
    setConfirmClose(false)
    try {
      const data = await previewRhPeriodClose(targetPeriod)
      setPreview(data)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submitCarryover = async (employeeId) => {
    const form = carryover[employeeId]
    if (!form) return
    const days = Number(String(form.days ?? '').replace(',', '.'))
    const reason = String(form.reason ?? '').trim()
    if (!Number.isFinite(days) || days <= 0) {
      setError('Indiquez un nombre de jours strictement positif.')
      return
    }
    if (reason.length < 5) {
      setError('La justification doit contenir au moins 5 caractères.')
      return
    }
    setCarryoverBusy(true)
    setError('')
    try {
      await grantRhExceptionalCarryover({
        employeeId,
        closingReferencePeriod: period,
        days,
        reason,
      })
      setCarryover((current) => ({ ...current, [employeeId]: { days: '', reason: '' } }))
      await runPreview()
      if (onChanged) await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCarryoverBusy(false)
    }
  }

  const submitClose = async () => {
    setBusy(true)
    setError('')
    try {
      await closeRhPeriod(period)
      setConfirmClose(false)
      setPreview(null)
      if (onChanged) await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const employeesWithReliquat = useMemo(
    () => (preview?.employees ?? []).filter((employee) => Number(employee.nMinus1Remaining) > 0),
    [preview],
  )

  return (
    <div className="rh-balances-import-backdrop" role="presentation" onMouseDown={() => !busy && !carryoverBusy && onClose()}>
      <section className="rh-balances-import-modal rh-period-closure-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Clôture de période</h2>
            <p>Prévisualisez, accordez un report exceptionnel puis clôturez la période.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy || carryoverBusy} aria-label="Fermer">×</button>
        </header>

        <div className="rh-period-closure-body">
          <div className="rh-period-closure-controls">
            <label>
              <span>Période à clôturer</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value)} disabled={busy || carryoverBusy}>
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="rh-balances-top-action" onClick={() => runPreview()} disabled={busy || carryoverBusy}>
              <Icon name="eye" size={17} /> {busy ? 'Prévisualisation…' : 'Prévisualiser'}
            </button>
          </div>

          {error && <div className="rh-balances-import-error"><Icon name="alert" size={16} /> {error}</div>}

          {preview && (
            <div className="rh-period-closure-preview">
              <div className="rh-period-closure-summary">
                <div>
                  <strong>Période {formatReferencePeriodRange(preview.referencePeriod)}</strong>
                  <span>→ nouvelle période N-1 {formatReferencePeriodRange(preview.nextReferencePeriod)}</span>
                </div>
                <span className={preview.alreadyClosed ? 'is-closed' : preview.blockedByReservations ? 'is-blocked' : 'is-open'}>
                  {preview.alreadyClosed ? 'Déjà clôturée' : preview.blockedByReservations ? 'Réservations bloquantes' : 'Prête à clôturer'}
                </span>
              </div>

              {employeesWithReliquat.length > 0 && (
                <div className="rh-period-closure-section">
                  <h3>Reports exceptionnels disponibles</h3>
                  {employeesWithReliquat.map((employee) => {
                    const form = carryover[employee.employeeId] ?? { days: '', reason: '' }
                    return (
                      <div className="rh-period-closure-carryover" key={employee.employeeId}>
                        <div className="rh-period-closure-carryover__head">
                          <strong>{employee.employeeName}</strong>
                          <span>Reliquat N-1 : {formatDays(employee.nMinus1Remaining)}</span>
                        </div>
                        <div className="rh-period-closure-carryover__form">
                          <label>
                            <span>Jours à reporter</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.5"
                              value={form.days}
                              onChange={(event) => setCarryover((current) => ({ ...current, [employee.employeeId]: { ...form, days: event.target.value } }))}
                              disabled={carryoverBusy}
                            />
                          </label>
                          <label>
                            <span>Justification</span>
                            <input
                              type="text"
                              maxLength={1000}
                              value={form.reason}
                              onChange={(event) => setCarryover((current) => ({ ...current, [employee.employeeId]: { ...form, reason: event.target.value } }))}
                              disabled={carryoverBusy}
                              placeholder="Motif du report exceptionnel"
                            />
                          </label>
                          <button type="button" className="rh-balances-top-action" onClick={() => submitCarryover(employee.employeeId)} disabled={carryoverBusy}>
                            {carryoverBusy ? 'Report…' : 'Reporter'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="rh-period-closure-actions">
                {!confirmClose ? (
                  <button
                    type="button"
                    className="rh-balances-top-action is-danger"
                    onClick={() => setConfirmClose(true)}
                    disabled={preview.alreadyClosed || busy || carryoverBusy}
                  >
                    <Icon name="ban" size={17} /> Clôturer la période
                  </button>
                ) : (
                  <div className="rh-period-closure-confirm">
                    <span>Cette action est définitive. Confirmer la clôture de la période {formatReferencePeriodRange(period)} ?</span>
                    <button type="button" className="rh-balances-top-action" onClick={() => setConfirmClose(false)} disabled={busy}>Annuler</button>
                    <button type="button" className="rh-balances-top-action is-danger" onClick={submitClose} disabled={busy}>
                      {busy ? 'Clôture…' : 'Confirmer la clôture'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
