import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import {
  listAccrualAnomalies,
  regularizeAccrualRange,
  resolveAccrualAnomaly,
} from '@/services/rh/rhAccrualAnomalies'
import '@/styles/rh/accrual-anomalies.css'

const TYPE_LABELS = {
  ABSENCE_OVERLAP_CONFLICT: 'Chevauchement contradictoire d’absences',
  HISTORICAL_PENDING: 'Journées historiques à valider',
  AMBIGUOUS_LEGACY: 'Ancien mouvement ambigu',
}

const MODE_LABELS = {
  VERIFIED: 'Cause disparue (vérifiée)',
  RH_DECISION: 'Décision RH (classification retenue)',
}

const STATUS_TABS = [
  { id: 'OPEN', label: 'Ouvertes' },
  { id: 'RH_DECIDED', label: 'Décidées RH' },
  { id: 'RESOLVED', label: 'Résolues' },
]

const KIND_LABELS = {
  ARRET_MALADIE: 'Arrêt maladie',
  AT_MP: 'AT / MP',
  NON_MEDICAL: 'Non médical',
  ENFANT_MALADE: 'Enfant malade',
}

function monthRange(accrualMonth) {
  if (!accrualMonth || !/^\d{4}-\d{2}$/.test(accrualMonth)) return null
  const [year, month] = accrualMonth.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { startDate: `${accrualMonth}-01`, endDate: `${accrualMonth}-${String(last).padStart(2, '0')}` }
}

export function RhAccrualAnomaliesPage() {
  const [tab, setTab] = useState('OPEN')
  const [state, setState] = useState({ loading: true, error: null })
  const [anomalies, setAnomalies] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [recalcId, setRecalcId] = useState(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [retainedKind, setRetainedKind] = useState('ARRET_MALADIE')
  const [needsDecisionFor, setNeedsDecisionFor] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async (status) => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const items = await listAccrualAnomalies(status)
      setAnomalies(items)
      setState({ loading: false, error: null })
    } catch (error) {
      setState({
        loading: false,
        error: error?.response?.data?.message ?? 'Impossible de charger les anomalies d’acquisition.',
      })
    }
  }, [])

  useEffect(() => { load(tab) }, [load, tab])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 6000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const recalc = async (anomaly) => {
    const range = monthRange(anomaly.accrualMonth)
    if (!range) return
    setRecalcId(anomaly.id)
    setFeedback(null)
    try {
      await regularizeAccrualRange(anomaly.employeeId, range.startDate, range.endDate)
      setFeedback({ kind: 'success', message: `Acquisition recalculée pour #${anomaly.employeeId} (${anomaly.accrualMonth}).` })
      await load(tab)
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec du recalcul.' })
    } finally {
      setRecalcId(null)
    }
  }

  const verifyResolve = async (anomaly) => {
    setBusyId(anomaly.id)
    setFeedback(null)
    try {
      await resolveAccrualAnomaly(anomaly.id)
      setNeedsDecisionFor(null)
      setDecisionReason('')
      setFeedback({ kind: 'success', message: `Anomalie #${anomaly.id} résolue (cause disparue).` })
      await load(tab)
    } catch (error) {
      const status = error?.response?.status
      if (status === 400) {
        setNeedsDecisionFor(anomaly.id)
        setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'La cause de l’anomalie existe toujours.' })
      } else {
        setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la résolution.' })
      }
    } finally {
      setBusyId(null)
    }
  }

  const resolveWithDecision = async (anomaly) => {
    if (!decisionReason.trim()) {
      setFeedback({ kind: 'error', message: 'Une justification RH est requise pour clôturer une anomalie dont la cause existe toujours.' })
      return
    }
    setBusyId(anomaly.id)
    setFeedback(null)
    try {
      const retained = anomaly.type === 'ABSENCE_OVERLAP_CONFLICT' ? retainedKind : undefined
      await resolveAccrualAnomaly(anomaly.id, decisionReason, retained)
      setNeedsDecisionFor(null)
      setDecisionReason('')
      setFeedback({ kind: 'success', message: `Anomalie #${anomaly.id} traitée par décision RH (classification retenue).` })
      await load(tab)
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la résolution.' })
    } finally {
      setBusyId(null)
    }
  }

  const openAnomalies = anomalies.filter((anomaly) => anomaly.status === 'OPEN')
  const decidedAnomalies = anomalies.filter((anomaly) => anomaly.status === 'RH_DECIDED')
  const resolvedAnomalies = anomalies.filter((anomaly) => anomaly.status === 'RESOLVED')
  const visible = tab === 'OPEN' ? openAnomalies : tab === 'RH_DECIDED' ? decidedAnomalies : resolvedAnomalies

  if (state.loading) {
    return <main className="page-container acc-anomalies-page"><div className="acc-loading">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container acc-anomalies-page">
        <section className="acc-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger les anomalies d’acquisition</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => load(tab)}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container acc-anomalies-page">
      <header className="acc-header">
        <div>
          <small>JUR-025 / JUR-037</small>
          <h1>Anomalies d’acquisition des congés</h1>
          <p>
            Chevauchements contradictoires, journées historiques à valider et anciens mouvements
            ambigus. Chaque anomalie doit être vérifiée, corrigée puis recalculée avant d’être
            clôturée — ou clôturée par une décision RH explicitement justifiée.
          </p>
        </div>
      </header>

      {feedback && (
        <div className={`acc-feedback acc-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="acc-tabs" role="tablist">
        <button type="button" className={tab === 'OPEN' ? 'is-active' : ''} onClick={() => setTab('OPEN')}>
          Ouvertes <span>{openAnomalies.length}</span>
        </button>
        <button type="button" className={tab === 'RH_DECIDED' ? 'is-active' : ''} onClick={() => setTab('RH_DECIDED')}>
          Décidées RH <span>{decidedAnomalies.length}</span>
        </button>
        <button type="button" className={tab === 'RESOLVED' ? 'is-active' : ''} onClick={() => setTab('RESOLVED')}>
          Résolues <span>{resolvedAnomalies.length}</span>
        </button>
      </div>

      {visible.length === 0 && (
        <section className="acc-empty">
          <Icon name="check" size={22} />
          <strong>{tab === 'OPEN' ? 'Aucune anomalie ouverte.' : tab === 'RH_DECIDED' ? 'Aucune anomalie décidée.' : 'Aucune anomalie résolue.'}</strong>
        </section>
      )}

      {visible.length > 0 && (
        <section className="acc-list">
          {visible.map((anomaly) => (
            <article key={anomaly.id} className={`acc-row acc-row--${anomaly.status.toLowerCase()}`}>
              <div className="acc-row__main">
                <span className="acc-row__type">{TYPE_LABELS[anomaly.type] ?? anomaly.type}</span>
                <strong>#{anomaly.employeeId}</strong>
                <span>Période {anomaly.referencePeriod}</span>
                {anomaly.accrualMonth && <span>Mois {anomaly.accrualMonth}</span>}
                <span>{anomaly.days} j</span>
              </div>
              {anomaly.detail && <p className="acc-row__detail">{anomaly.detail}</p>}
              {(anomaly.status === 'RESOLVED' || anomaly.status === 'RH_DECIDED') && (
                <p className="acc-row__resolution">
                  {anomaly.status === 'RESOLVED' ? 'Résolue' : 'Décidée RH'} le {anomaly.resolvedAt ? new Date(anomaly.resolvedAt).toLocaleDateString('fr-FR') : '—'}
                  {' '}par #{anomaly.resolvedById ?? '—'} — {MODE_LABELS[anomaly.resolutionMode] ?? anomaly.resolutionMode}
                  {anomaly.retainedKind ? ` — classification retenue : ${KIND_LABELS[anomaly.retainedKind] ?? anomaly.retainedKind}` : ''}
                  {anomaly.resolutionReason ? ` — ${anomaly.resolutionReason}` : ''}
                </p>
              )}
              {anomaly.status === 'OPEN' && (
                <div className="acc-row__actions">
                  {anomaly.accrualMonth && (
                    <button type="button" disabled={recalcId === anomaly.id} onClick={() => recalc(anomaly)}>
                      <Icon name="refresh" size={15} /> Recalculer
                    </button>
                  )}
                  <Link
                    className="acc-row__link"
                    to={`/app/rh-leaves-absences?q=${encodeURIComponent(anomaly.employee?.email ?? `#${anomaly.employeeId}`)}`}
                  >
                    <Icon name="eye" size={15} /> Voir les absences
                  </Link>
                  {needsDecisionFor === anomaly.id ? (
                    <div className="acc-row__decision">
                      {anomaly.type === 'ABSENCE_OVERLAP_CONFLICT' && (
                        <label className="acc-row__retained">
                          <span>Classification retenue</span>
                          <select value={retainedKind} onChange={(event) => setRetainedKind(event.target.value)}>
                            <option value="ARRET_MALADIE">Arrêt maladie</option>
                            <option value="AT_MP">AT / MP</option>
                            <option value="NON_MEDICAL">Non médical</option>
                            <option value="ENFANT_MALADE">Enfant malade</option>
                          </select>
                        </label>
                      )}
                      <textarea
                        rows={2}
                        maxLength={4000}
                        value={decisionReason}
                        placeholder="Justification RH de la décision (fondement juridique…)"
                        onChange={(event) => setDecisionReason(event.target.value)}
                      />
                      <button type="button" disabled={busyId === anomaly.id} onClick={() => resolveWithDecision(anomaly)}>
                        <Icon name="check" size={15} /> Appliquer la décision RH
                      </button>
                    </div>
                  ) : (
                    <button type="button" disabled={busyId === anomaly.id} onClick={() => verifyResolve(anomaly)}>
                      <Icon name="check" size={15} /> Vérifier &amp; résoudre
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
