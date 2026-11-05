import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
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

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const items = await listAccrualAnomalies()
      setAnomalies(items)
      setState({ loading: false, error: null })
    } catch (error) {
      setState({
        loading: false,
        error: error?.response?.data?.message ?? 'Impossible de charger les anomalies d’acquisition.',
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

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
      await load()
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
      await load()
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
      await load()
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la résolution.' })
    } finally {
      setBusyId(null)
    }
  }

  const openAnomalies = useMemo(() => anomalies.filter((a) => a.status === 'OPEN'), [anomalies])
  const decidedAnomalies = useMemo(() => anomalies.filter((a) => a.status === 'RH_DECIDED'), [anomalies])
  const resolvedAnomalies = useMemo(() => anomalies.filter((a) => a.status === 'RESOLVED'), [anomalies])

  const kpis = [
    { id: 'OPEN', label: 'Anomalies ouvertes', count: openAnomalies.length, icon: 'alert', tone: 'orange' },
    { id: 'RH_DECIDED', label: 'Décisions enregistrées', count: decidedAnomalies.length, icon: 'shield', tone: 'violet' },
    { id: 'RESOLVED', label: 'Anomalies résolues', count: resolvedAnomalies.length, icon: 'check', tone: 'green' },
  ]

  const visible = tab === 'OPEN' ? openAnomalies : tab === 'RH_DECIDED' ? decidedAnomalies : resolvedAnomalies

  if (state.loading) {
    return <main className="page-container rh-aa-page"><div className="rh-aa-state">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container rh-aa-page">
        <section className="rh-aa-state">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger les anomalies d’acquisition</strong>
          <span>{state.error}</span>
          <button type="button" className="rh-btn rh-btn--primary" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container rh-aa-page">
      <header className="rh-page-hero">
        <div className="rh-page-hero__icon"><Icon name="alert" size={26} /></div>
        <div className="rh-page-hero__body">
          <span className="rh-page-hero__eyebrow">Paramétrage RH</span>
          <div className="rh-page-hero__title-row">
            <h1>Anomalies d’acquisition des congés</h1>
            <StatisticInfoButton title="Qu’est-ce qu’une anomalie d’acquisition ?" wide>
              <p>Une anomalie d’acquisition apparaît lorsque certaines informations nécessitent une vérification pour garantir le bon calcul des droits à congés d’un collaborateur.</p>
              <p>Cela peut notamment concerner deux absences qui se chevauchent, des informations anciennes incomplètes ou des mouvements de solde qui semblent incohérents.</p>
              <p>Cette page permet à la RH de retrouver les anomalies détectées, d’en examiner les détails, de traiter les corrections nécessaires et de suivre leur résolution.</p>
              <p>Une anomalie signalée ne signifie pas automatiquement que le solde du salarié est incorrect : elle indique qu’une vérification est nécessaire.</p>
            </StatisticInfoButton>
          </div>
        </div>
      </header>

      {feedback && (
        <div className={`rh-feedback rh-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="rh-kpis">
        {kpis.map((kpi) => (
          <button
            key={kpi.id}
            type="button"
            className={`rh-kpi rh-kpi--${kpi.tone}${tab === kpi.id ? ' is-active' : ''}`}
            aria-pressed={tab === kpi.id}
            onClick={() => setTab(kpi.id)}
          >
            <span className="rh-kpi__icon"><Icon name={kpi.icon} size={22} /></span>
            <span className="rh-kpi__meta">
              <span className="rh-kpi__value">{kpi.count}</span>
              <span className="rh-kpi__label">{kpi.label}</span>
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <section className="rh-panel">
          <div className="rh-empty">
            <span className={`rh-empty__icon${tab === 'OPEN' ? '' : ' rh-empty__icon--green'}`}>
              <Icon name={tab === 'OPEN' ? 'check' : tab === 'RESOLVED' ? 'archive' : 'shield'} size={26} />
            </span>
            <strong>
              {tab === 'OPEN' ? 'Aucune anomalie ouverte' : tab === 'RH_DECIDED' ? 'Aucune décision RH enregistrée' : 'Aucune anomalie résolue'}
            </strong>
            <span>
              {tab === 'OPEN'
                ? 'Toutes les acquisitions sont cohérentes : aucune anomalie ne nécessite de vérification pour le moment.'
                : tab === 'RH_DECIDED'
                  ? 'Les anomalies clôturées par une décision RH apparaîtront ici avec leur justification.'
                  : 'Les anomalies vérifiées et résolues apparaîtront ici avec leur trace de clôture.'}
            </span>
          </div>
        </section>
      )}

      {visible.length > 0 && (
        <div className="rh-aa-list">
          {visible.map((anomaly) => (
            <article key={anomaly.id} className={`rh-aa-row rh-aa-row--${anomaly.status.toLowerCase()}`}>
              <div className="rh-aa-row__head">
                <span className="rh-aa-row__type">
                  <Icon name={anomaly.type === 'ABSENCE_OVERLAP_CONFLICT' ? 'alert' : 'clock'} size={16} />
                  {TYPE_LABELS[anomaly.type] ?? anomaly.type}
                </span>
                <div className="rh-aa-row__meta">
                  <span>Collaborateur <strong>#{anomaly.employeeId}</strong></span>
                  <span>Période <strong>{anomaly.referencePeriod}</strong></span>
                  {anomaly.accrualMonth && <span>Mois <strong>{anomaly.accrualMonth}</strong></span>}
                  <span><strong>{anomaly.days}</strong> j</span>
                </div>
              </div>

              {anomaly.detail && <p className="rh-aa-row__detail">{anomaly.detail}</p>}

              {(anomaly.status === 'RESOLVED' || anomaly.status === 'RH_DECIDED') && (
                <p className="rh-aa-row__resolution">
                  {anomaly.status === 'RESOLVED' ? 'Résolue' : 'Décidée RH'} le {anomaly.resolvedAt ? new Date(anomaly.resolvedAt).toLocaleDateString('fr-FR') : '—'}
                  {' '}par #{anomaly.resolvedById ?? '—'} — {MODE_LABELS[anomaly.resolutionMode] ?? anomaly.resolutionMode}
                  {anomaly.retainedKind ? ` — classification retenue : ${KIND_LABELS[anomaly.retainedKind] ?? anomaly.retainedKind}` : ''}
                  {anomaly.resolutionReason ? ` — ${anomaly.resolutionReason}` : ''}
                </p>
              )}

              {anomaly.status === 'OPEN' && (
                <div className="rh-aa-row__actions">
                  {anomaly.accrualMonth && (
                    <button type="button" className="rh-btn rh-btn--sm" disabled={recalcId === anomaly.id} onClick={() => recalc(anomaly)}>
                      <Icon name="refresh" size={14} /> Recalculer
                    </button>
                  )}
                  <Link
                    className="rh-btn rh-btn--sm"
                    to={`/app/rh-leaves-absences?q=${encodeURIComponent(anomaly.employee?.email ?? `#${anomaly.employeeId}`)}`}
                  >
                    <Icon name="eye" size={14} /> Voir les absences
                  </Link>
                  {needsDecisionFor === anomaly.id ? (
                    <div className="rh-aa-decision">
                      {anomaly.type === 'ABSENCE_OVERLAP_CONFLICT' && (
                        <label className="rh-field">
                          <span className="rh-field__label">Classification retenue</span>
                          <select className="rh-select" value={retainedKind} onChange={(event) => setRetainedKind(event.target.value)}>
                            <option value="ARRET_MALADIE">Arrêt maladie</option>
                            <option value="AT_MP">AT / MP</option>
                            <option value="NON_MEDICAL">Non médical</option>
                            <option value="ENFANT_MALADE">Enfant malade</option>
                          </select>
                        </label>
                      )}
                      <label className="rh-field">
                        <span className="rh-field__label">Justification RH de la décision</span>
                        <textarea
                          className="rh-textarea"
                          rows={2}
                          maxLength={4000}
                          value={decisionReason}
                          placeholder="Fondement juridique de la décision…"
                          onChange={(event) => setDecisionReason(event.target.value)}
                        />
                      </label>
                      <button type="button" className="rh-btn rh-btn--accent rh-btn--sm" disabled={busyId === anomaly.id} onClick={() => resolveWithDecision(anomaly)}>
                        <Icon name="check" size={14} /> Appliquer la décision RH
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="rh-btn rh-btn--accent rh-btn--sm" disabled={busyId === anomaly.id} onClick={() => verifyResolve(anomaly)}>
                      <Icon name="check" size={14} /> Vérifier &amp; résoudre
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
