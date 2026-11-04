import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

const REQUEST_STATUS_LABELS = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  VALIDEE: 'Validée',
  REFUSEE: 'Refusée',
  ANNULEE: 'Annulée',
  ANNULATION_EN_ATTENTE_ACCORD: 'Annulation en attente d’accord',
  ANNULEE_APRES_VALIDATION: 'Annulée après validation',
  EXPIREE_NON_VALIDEE: 'Expirée',
}

const REQUEST_STATUS_TONES = {
  EN_ATTENTE_VALIDATION: 'pending',
  VALIDEE: 'validated',
  ANNULATION_EN_ATTENTE_ACCORD: 'cancelling',
}

const PROCESSING_LABELS = {
  DEMANDE_ACTUELLE: 'Imputation non effectuée',
  CONGE_PREVISIONNEL: 'Congé prévisionnel (non consolidé)',
  A_CONSOLIDER: 'À consolider',
  DEFINITIF: 'Imputée',
}

function formatDays(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} j`
}

function formatDateFr(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!match) return String(iso ?? '—')
  return `${match[3]}/${match[2]}/${match[1]}`
}

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function requestStatusLabel(status) {
  return REQUEST_STATUS_LABELS[status] ?? status
}

function processingLabel(balanceProcessingStatus) {
  return PROCESSING_LABELS[balanceProcessingStatus] ?? balanceProcessingStatus
}

function remainingStep(request) {
  if (request.status === 'EN_ATTENTE_VALIDATION') return 'Validation du circuit'
  if (request.status === 'ANNULATION_EN_ATTENTE_ACCORD') return 'Décision sur l’annulation'
  if (request.status === 'VALIDEE') return processingLabel(request.balanceProcessingStatus)
  return 'Traitement'
}

function blockingReason(request) {
  if (request.status === 'EN_ATTENTE_VALIDATION') {
    return 'Validation non terminée : la demande doit être validée ou refusée.'
  }
  if (request.status === 'ANNULATION_EN_ATTENTE_ACCORD') {
    return 'Annulation en attente d’accord : la demande d’annulation doit être traitée.'
  }
  if (request.status === 'VALIDEE') {
    return 'Demande validée mais non définitivement imputée : imputation ou consolidation en attente.'
  }
  return 'Demande non définitivement imputée sur la période.'
}

function negativeLabel(employee) {
  if (!employee.negativeBalances?.length) return '—'
  return employee.negativeBalances
    .map((item) => `${item.counterType} ${formatDays(item.availableDays)}`)
    .join(', ')
}

function computePeriodStatus(preview, today) {
  if (!preview) return null
  if (preview.alreadyClosed) {
    return {
      tone: 'closed',
      title: 'Période déjà clôturée',
      detail: preview.closedAt
        ? `Clôturée le ${formatDateFr(String(preview.closedAt).slice(0, 10))}`
        : 'Clôture déjà effectuée',
      canClose: false,
      reason: 'Cette période a déjà été clôturée. Aucune nouvelle clôture n’est possible.',
    }
  }
  if (today < preview.expectedEndDate) {
    return {
      tone: 'progress',
      title: 'Période en cours',
      detail: `Clôture indisponible jusqu’au ${formatDateFr(preview.expectedEndDate)}`,
      canClose: false,
      reason: 'La période n’est pas encore terminée. La clôture sera disponible à partir de sa date de fin.',
    }
  }
  if (preview.employeeCount === 0) {
    return {
      tone: 'empty',
      title: 'Aucun compteur à clôturer',
      detail: 'Aucun compteur de congés sur cette période',
      canClose: false,
      reason: 'Aucun compteur de congés ne correspond à cette période de référence.',
    }
  }
  if (preview.blockingRequestCount > 0 && preview.blockedByReservations) {
    return {
      tone: 'blocked',
      title: 'Clôture bloquée',
      detail: `${preview.blockingRequestCount} demande(s) à traiter et ${preview.reservationCount} réservation(s)`,
      canClose: false,
      reason: 'Des demandes de congés payés restent à imputer et des jours réservés doivent être traités avant la clôture.',
    }
  }
  if (preview.blockingRequestCount > 0) {
    return {
      tone: 'blocked',
      title: 'Clôture bloquée — demandes à traiter',
      detail: `${preview.blockingRequestCount} demande(s) non imputée(s)`,
      canClose: false,
      reason: 'Des demandes de congés payés ne sont pas encore définitivement imputées sur la période.',
    }
  }
  if (preview.blockedByReservations) {
    return {
      tone: 'blocked',
      title: 'Clôture bloquée — réservations',
      detail: `${preview.reservationCount} collaborateur(s) avec des jours réservés`,
      canClose: false,
      reason: 'Des jours réservés doivent être traités (libérés ou imputés) avant la clôture.',
    }
  }
  return {
    tone: 'ready',
    title: 'Prête à clôturer',
    detail: 'Tous les contrôles de clôture sont satisfaits',
    canClose: true,
    reason: null,
  }
}

// Verrouille le défilement de la page arrière pendant que la fenêtre est ouverte.
// Gèle la position courante, compense la disparition de la barre de défilement,
// et bloque molette / tactile / clavier hors du corps défilant de la fenêtre.
function useScrollLock(scrollY) {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const scrollbarWidth = window.innerWidth - html.clientWidth

    const prev = {
      htmlOverflow: html.style.overflow,
      htmlScrollBehavior: html.style.scrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    }

    html.style.overflow = 'hidden'
    html.style.scrollBehavior = 'auto'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`

    const isInsideModalBody = (target) =>
      target instanceof Element && Boolean(target.closest('.rh-pc-body'))
    const isFormControl = (target) =>
      target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))

    const onWheel = (event) => {
      if (isInsideModalBody(event.target)) return
      event.preventDefault()
    }
    const onTouchMove = (event) => {
      if (isInsideModalBody(event.target)) return
      event.preventDefault()
    }
    const onKeyDown = (event) => {
      const scrollKeys = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']
      if (!scrollKeys.includes(event.key)) return
      if (isInsideModalBody(event.target)) return
      if (isFormControl(event.target)) return
      event.preventDefault()
    }

    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('keydown', onKeyDown)

    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.position = prev.bodyPosition
      body.style.top = prev.bodyTop
      body.style.left = prev.bodyLeft
      body.style.right = prev.bodyRight
      body.style.overflow = prev.bodyOverflow
      body.style.paddingRight = prev.bodyPaddingRight
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('keydown', onKeyDown)
      html.style.scrollBehavior = 'auto'
      const scrolling = document.scrollingElement || html
      scrolling.scrollTop = scrollY
      html.style.scrollBehavior = prev.htmlScrollBehavior
    }
  }, [scrollY])
}

export function PeriodClosureModal({ onClose, onChanged }) {
  const periodOptions = useMemo(() => adjacentReferencePeriodOptions(), [])
  const defaultPeriod = useMemo(
    () => counterReferencePeriod(currentReferencePeriod(), 'N-1'),
    [],
  )

  const [period, setPeriod] = useState(defaultPeriod)
  const periodRef = useRef(defaultPeriod)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ reliquat: false, reservation: false, negative: false })
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null)

  const [requestSearch, setRequestSearch] = useState('')
  const [requestStatusFilter, setRequestStatusFilter] = useState('')

  const [carryoverTarget, setCarryoverTarget] = useState(null)
  const [carryoverForm, setCarryoverForm] = useState({ days: '', reason: '' })
  const [carryoverError, setCarryoverError] = useState('')
  const [carryoverBusy, setCarryoverBusy] = useState(false)

  const previewSeq = useRef(0)

  const loadPreview = useCallback(async (targetPeriod) => {
    const seq = ++previewSeq.current
    setBusy(true)
    setError('')
    setPreview(null)
    setConfirmClose(false)
    try {
      const data = await previewRhPeriodClose(targetPeriod)
      if (seq !== previewSeq.current) return
      setPreview(data)
    } catch (err) {
      if (seq !== previewSeq.current) return
      setError(errorMessage(err))
    } finally {
      if (seq === previewSeq.current) setBusy(false)
    }
  }, [])

  const changePeriod = (value) => {
    periodRef.current = value
    setPeriod(value)
    setPreview(null)
    setError('')
    setConfirmClose(false)
    setCarryoverTarget(null)
    setCarryoverForm({ days: '', reason: '' })
    setCarryoverError('')
    setExpandedEmployeeId(null)
    loadPreview(value)
  }

  useEffect(() => {
    loadPreview(defaultPeriod)
  }, [defaultPeriod, loadPreview])

  const initialScrollYRef = useRef(null)
  if (initialScrollYRef.current === null) {
    initialScrollYRef.current = window.scrollY ?? document.scrollingElement?.scrollTop ?? 0
  }

  useScrollLock(initialScrollYRef.current)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmClose) setConfirmClose(false)
        else if (!busy && !carryoverBusy) onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = document.querySelector(confirmClose ? '.rh-pc-confirm' : '.rh-pc-modal')
      if (!root) return
      const focusables = Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled && el.getClientRects().length > 0)
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [confirmClose, busy, carryoverBusy, onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const raf = requestAnimationFrame(() => {
      document.querySelector('.rh-pc-header__actions .rh-pc-btn--ghost')?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus()
    }
  }, [])

  useEffect(() => {
    if (!confirmClose) return
    const raf = requestAnimationFrame(() => {
      document.querySelector('.rh-pc-confirm__panel button')?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [confirmClose])

  const today = useMemo(() => martiniqueToday(), [])
  const status = computePeriodStatus(preview, today)
  const previewMatchesPeriod = preview?.referencePeriod === period

  const employeesWithReliquat = useMemo(
    () => (preview?.employees ?? []).filter((employee) => Number(employee.nMinus1Remaining) > 0),
    [preview],
  )

  const blockingSituations =
    (preview?.blockingRequestCount ?? 0) +
    (preview?.blockedByReservations ? preview?.reservationCount ?? 0 : 0)

  const filteredEmployees = useMemo(() => {
    if (!preview) return []
    const query = search.trim().toLowerCase()
    return preview.employees.filter((employee) => {
      if (query && !employee.employeeName.toLowerCase().includes(query)) return false
      if (filters.reliquat && !(Number(employee.nMinus1Remaining) > 0)) return false
      if (filters.reservation && !(Number(employee.reservedDays) > 0)) return false
      if (filters.negative && !employee.negativeBalances?.length) return false
      return true
    })
  }, [preview, search, filters])

  const filteredRequests = useMemo(() => {
    if (!preview) return []
    const query = requestSearch.trim().toLowerCase()
    return (preview.blockingRequests ?? []).filter((request) => {
      if (query) {
        const haystack = `${request.employeeName} ${request.leaveTypeName}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (requestStatusFilter && request.status !== requestStatusFilter) return false
      return true
    })
  }, [preview, requestSearch, requestStatusFilter])

  const toggleEmployee = (employeeId) => {
    setExpandedEmployeeId((current) => (current === employeeId ? null : employeeId))
  }

  const openCarryover = (employeeId) => {
    setCarryoverTarget(employeeId)
    setCarryoverForm({ days: '', reason: '' })
    setCarryoverError('')
    setActiveTab('reports')
  }

  const closeCarryover = () => {
    setCarryoverTarget(null)
    setCarryoverForm({ days: '', reason: '' })
    setCarryoverError('')
  }

  const submitCarryover = async () => {
    if (carryoverTarget == null) return
    const closingPeriod = periodRef.current
    const days = Number(String(carryoverForm.days ?? '').replace(',', '.'))
    const reason = String(carryoverForm.reason ?? '').trim()
    if (!Number.isFinite(days) || days <= 0) {
      setCarryoverError('Indiquez un nombre de jours strictement positif.')
      return
    }
    if (reason.length < 5) {
      setCarryoverError('La justification doit contenir au moins 5 caractères.')
      return
    }
    setCarryoverBusy(true)
    setCarryoverError('')
    setError('')
    try {
      await grantRhExceptionalCarryover({
        employeeId: carryoverTarget,
        closingReferencePeriod: closingPeriod,
        days,
        reason,
      })
      closeCarryover()
      if (periodRef.current === closingPeriod) {
        const seq = ++previewSeq.current
        const data = await previewRhPeriodClose(closingPeriod)
        if (seq === previewSeq.current) setPreview(data)
      }
      if (onChanged) await onChanged()
    } catch (err) {
      setCarryoverError(errorMessage(err))
    } finally {
      setCarryoverBusy(false)
    }
  }

  const submitClose = async () => {
    if (!previewMatchesPeriod || !status?.canClose) return
    const target = periodRef.current
    setBusy(true)
    setError('')
    try {
      await closeRhPeriod(target)
      setConfirmClose(false)
      if (onChanged) await onChanged()
      if (periodRef.current === target) {
        const seq = ++previewSeq.current
        const data = await previewRhPeriodClose(target)
        if (seq === previewSeq.current) setPreview(data)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const canCloseNow = Boolean(previewMatchesPeriod && status?.canClose && !busy && !carryoverBusy)

  const footerReason = !preview
    ? busy
      ? 'Chargement de la prévisualisation…'
      : 'Lancez la prévisualisation pour activer la clôture.'
    : !previewMatchesPeriod
      ? 'La clôture concerne la période effectivement prévisualisée.'
      : status?.reason

  const parsedCarryoverDays = (() => {
    const value = Number(String(carryoverForm.days ?? '').replace(',', '.'))
    return Number.isFinite(value) && value > 0 ? value : null
  })()

  return createPortal(
    <>
      <div className="rh-pc-backdrop" role="presentation" onMouseDown={() => !busy && !carryoverBusy && onClose()} />

      <div className="rh-pc-modal-region" role="presentation">
        <section className="rh-pc-modal" role="dialog" aria-modal="true" aria-label="Clôture de période">
        <header className="rh-pc-header">
          <div className="rh-pc-header__titlebar">
            <div className="rh-pc-title">
              <h2>Clôture de période</h2>
              <p>Prévisualisez les effets de la clôture, traitez les demandes bloquantes et accordez les reports exceptionnels.</p>
            </div>
            <div className="rh-pc-header__actions">
              <button
                type="button"
                className="rh-pc-btn"
                onClick={() => loadPreview(period)}
                disabled={busy || carryoverBusy}
              >
                <Icon name="refresh" size={16} /> Actualiser
              </button>
              <button type="button" className="rh-pc-btn rh-pc-btn--ghost" onClick={onClose} disabled={busy || carryoverBusy} aria-label="Fermer">×</button>
            </div>
          </div>

          <div className="rh-pc-header__controls">
            <label className="rh-pc-field">
              <span>Période à clôturer</span>
              <select
                value={period}
                onChange={(event) => changePeriod(event.target.value)}
                disabled={busy || carryoverBusy}
              >
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {status && (
              <span className={`rh-pc-status rh-pc-status--${status.tone}`} title={status.detail}>
                <Icon name={status.tone === 'ready' ? 'check' : status.tone === 'blocked' ? 'alert' : status.tone === 'closed' ? 'ban' : status.tone === 'progress' ? 'clock' : 'info'} size={15} />
                <span>
                  <strong>{status.title}</strong>
                  <small>{status.detail}</small>
                </span>
              </span>
            )}
          </div>

          <nav className="rh-pc-tabs" role="tablist" aria-label="Sections de la clôture">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overview'}
              aria-controls="rh-pc-tab-overview"
              className="rh-pc-tab"
              onClick={() => setActiveTab('overview')}
            >
              <Icon name="dashboard" size={16} /> Vue d’ensemble
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'requests'}
              aria-controls="rh-pc-tab-requests"
              className="rh-pc-tab"
              onClick={() => setActiveTab('requests')}
            >
              <Icon name="alert" size={16} /> Demandes à traiter
              {preview && preview.blockingRequestCount > 0 && (
                <span className="rh-pc-tab__badge is-alert">{preview.blockingRequestCount}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reports'}
              aria-controls="rh-pc-tab-reports"
              className="rh-pc-tab"
              onClick={() => setActiveTab('reports')}
            >
              <Icon name="arrowRight" size={16} /> Reports exceptionnels
              {employeesWithReliquat.length > 0 && (
                <span className="rh-pc-tab__badge">{employeesWithReliquat.length}</span>
              )}
            </button>
          </nav>
        </header>

        <div className="rh-pc-body">
          {error && (
            <div className="rh-pc-error">
              <Icon name="alert" size={16} /> {error}
            </div>
          )}

          {!preview ? (
            <div className="rh-pc-state">
              {busy ? (
                <>
                  <Icon name="refresh" size={22} />
                  <strong>Chargement de la prévisualisation…</strong>
                </>
              ) : (
                <>
                  <Icon name="eye" size={22} />
                  <strong>Aucune prévisualisation</strong>
                  <span>Choisissez une période puis actualisez la prévisualisation.</span>
                </>
              )}
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <div role="tabpanel" id="rh-pc-tab-overview" className="rh-pc-tab-panel">
                  <div className="rh-pc-kpis">
                    <div className="rh-pc-kpi">
                      <span>Collaborateurs concernés</span>
                      <strong>{preview.employeeCount}</strong>
                      <small>Compteurs sur la période {formatReferencePeriodRange(preview.referencePeriod)}</small>
                    </div>
                    <div className="rh-pc-kpi rh-pc-kpi--orange">
                      <span>Jours N à transférer</span>
                      <strong>{formatDays(preview.totals.nToTransfer)}</strong>
                      <small>Arrondi L3141-7 puis transfert GMES</small>
                    </div>
                    <div className="rh-pc-kpi">
                      <span>Jours N−1 remis à zéro</span>
                      <strong>{formatDays(preview.totals.nMinus1ToReset)}</strong>
                      <small>Reliquats N−1 non reportés</small>
                    </div>
                    <div className={`rh-pc-kpi ${blockingSituations > 0 ? 'rh-pc-kpi--alert' : ''}`}>
                      <span>Situations bloquantes</span>
                      <strong>{blockingSituations}</strong>
                      <small>{preview.blockingRequestCount} demande(s) · {preview.reservationCount} réservation(s)</small>
                    </div>
                  </div>

                  <div className="rh-pc-secondary">
                    <div className="rh-pc-mini-kpi">
                      <span>Jours N+1 remis à zéro</span>
                      <strong>{formatDays(preview.totals.nPlus1ToReset)}</strong>
                    </div>
                    <div className="rh-pc-mini-kpi">
                      <span>Reports déjà autorisés</span>
                      <strong>{formatDays(preview.totals.exceptionalCarryoverApproved)}</strong>
                    </div>
                    <div className="rh-pc-mini-kpi">
                      <span>Soldes négatifs</span>
                      <strong>{preview.negativeBalanceCount}</strong>
                    </div>
                    <div className="rh-pc-mini-kpi">
                      <span>Réservations</span>
                      <strong>{preview.reservationCount}</strong>
                    </div>
                  </div>

                  <p className="rh-pc-legal-note">
                    <Icon name="info" size={15} />
                    La clôture ne vaut pas validation juridique tant que les reports légaux
                    (ex. congés pour maladie) ne sont pas gérés par la RH.
                  </p>

                  <div className="rh-pc-toolbar">
                    <div className="rh-pc-search">
                      <Icon name="search" size={16} />
                      <input
                        type="text"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Rechercher un collaborateur…"
                        aria-label="Rechercher un collaborateur"
                      />
                    </div>
                    <button
                      type="button"
                      className="rh-pc-filter-btn"
                      aria-pressed={filters.reliquat}
                      onClick={() => setFilters((current) => ({ ...current, reliquat: !current.reliquat }))}
                    >
                      Reliquats
                    </button>
                    <button
                      type="button"
                      className="rh-pc-filter-btn"
                      aria-pressed={filters.reservation}
                      onClick={() => setFilters((current) => ({ ...current, reservation: !current.reservation }))}
                    >
                      Réservations
                    </button>
                    <button
                      type="button"
                      className="rh-pc-filter-btn"
                      aria-pressed={filters.negative}
                      onClick={() => setFilters((current) => ({ ...current, negative: !current.negative }))}
                    >
                      Soldes négatifs
                    </button>
                    <span className="rh-pc-toolbar__count">
                      {filteredEmployees.length}/{preview.employees.length} collaborateur(s)
                    </span>
                  </div>

                  {preview.employees.length === 0 ? (
                    <div className="rh-pc-state">
                      <Icon name="users" size={22} />
                      <strong>Aucun compteur à clôturer</strong>
                      <span>Aucun compteur de congés ne correspond à cette période.</span>
                    </div>
                  ) : filteredEmployees.length === 0 ? (
                    <div className="rh-pc-state">
                      <Icon name="search" size={22} />
                      <strong>Aucun résultat</strong>
                      <span>Aucun collaborateur ne correspond aux filtres.</span>
                    </div>
                  ) : (
                    <div className="rh-pc-table-wrap">
                      <table className="rh-pc-table">
                        <thead>
                          <tr>
                            <th>Collaborateur</th>
                            <th>N−1 restant</th>
                            <th>N à transférer</th>
                            <th>Remise à zéro</th>
                            <th>Reporté</th>
                            <th>Réservé</th>
                            <th>Solde négatif</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmployees.map((employee) => (
                            <Fragment key={employee.employeeId}>
                              <tr className="rh-pc-table__row" onClick={() => toggleEmployee(employee.employeeId)}>
                                <td>
                                  <button type="button" className="rh-pc-expand" aria-expanded={expandedEmployeeId === employee.employeeId}>
                                    <Icon name={expandedEmployeeId === employee.employeeId ? 'chevronDown' : 'chevronRight'} size={16} />
                                    <span>{employee.employeeName}</span>
                                  </button>
                                </td>
                                <td>{formatDays(employee.nMinus1Remaining)}</td>
                                <td>{formatDays(employee.nToTransfer)}</td>
                                <td>{formatDays(employee.nMinus1ToReset + employee.nPlus1ToReset)}</td>
                                <td>{formatDays(employee.exceptionalCarryoverAlreadyApproved)}</td>
                                <td className={Number(employee.reservedDays) > 0 ? 'is-warn' : ''}>{formatDays(employee.reservedDays)}</td>
                                <td className={employee.negativeBalances?.length ? 'is-negative' : ''}>{negativeLabel(employee)}</td>
                              </tr>
                              {expandedEmployeeId === employee.employeeId && (
                                <tr className="rh-pc-table__detail">
                                  <td colSpan={7}>
                                    <div className="rh-pc-employee-detail">
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N restant à transférer</span>
                                        <strong>{formatDays(employee.nRemainingToTransfer)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>Supplément L3141-7</span>
                                        <strong>{formatDays(employee.roundingSupplement)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N à transférer</span>
                                        <strong>{formatDays(employee.nToTransfer)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N−1 restant</span>
                                        <strong>{formatDays(employee.nMinus1Remaining)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N−1 remis à zéro</span>
                                        <strong>{formatDays(employee.nMinus1ToReset)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N+1 prévision</span>
                                        <strong>{formatDays(employee.nPlus1Forecast)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>N+1 remis à zéro</span>
                                        <strong>{formatDays(employee.nPlus1ToReset)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>Réservé</span>
                                        <strong>{formatDays(employee.reservedDays)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>Reporté</span>
                                        <strong>{formatDays(employee.exceptionalCarryoverAlreadyApproved)}</strong>
                                      </div>
                                      <div className="rh-pc-employee-detail__item">
                                        <span>Soldes négatifs</span>
                                        <strong>{negativeLabel(employee)}</strong>
                                      </div>
                                      {Number(employee.nMinus1Remaining) > 0 && (
                                        <div className="rh-pc-employee-detail__action">
                                          <button type="button" className="rh-pc-btn" onClick={() => openCarryover(employee.employeeId)}>
                                            <Icon name="arrowRight" size={15} /> Effectuer un report exceptionnel
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'requests' && (
                <div role="tabpanel" id="rh-pc-tab-requests" className="rh-pc-tab-panel">
                  {preview.blockingRequestCount === 0 ? (
                    <div className="rh-pc-state">
                      <Icon name="check" size={22} />
                      <strong>Aucune demande à traiter</strong>
                      <span>Toutes les demandes de la période sont définitivement imputées ou sans effet sur les compteurs.</span>
                    </div>
                  ) : (
                    <>
                      <div className="rh-pc-warn-banner">
                        <Icon name="alert" size={17} />
                        <span>
                          <strong>{preview.blockingRequestCount} demande(s) bloque(nt) la clôture.</strong>{' '}
                          Elles doivent être validées, refusées, annulées ou définitivement imputées avant de pouvoir clôturer la période.
                        </span>
                      </div>

                      <div className="rh-pc-toolbar">
                        <div className="rh-pc-search">
                          <Icon name="search" size={16} />
                          <input
                            type="text"
                            value={requestSearch}
                            onChange={(event) => setRequestSearch(event.target.value)}
                            placeholder="Rechercher un collaborateur ou un type…"
                            aria-label="Rechercher une demande"
                          />
                        </div>
                        <label className="rh-pc-field rh-pc-field--inline">
                          <span>Statut</span>
                          <select
                            value={requestStatusFilter}
                            onChange={(event) => setRequestStatusFilter(event.target.value)}
                          >
                            <option value="">Tous les statuts</option>
                            <option value="EN_ATTENTE_VALIDATION">En attente de validation</option>
                            <option value="VALIDEE">Validée</option>
                            <option value="ANNULATION_EN_ATTENTE_ACCORD">Annulation en attente d’accord</option>
                          </select>
                        </label>
                      </div>

                      {filteredRequests.length === 0 ? (
                        <div className="rh-pc-state">
                          <Icon name="search" size={22} />
                          <strong>Aucun résultat</strong>
                          <span>Aucune demande ne correspond aux filtres.</span>
                        </div>
                      ) : (
                        <div className="rh-pc-table-wrap">
                          <table className="rh-pc-table">
                            <thead>
                              <tr>
                                <th>Collaborateur</th>
                                <th>Type de congé</th>
                                <th>Dates</th>
                                <th>Jours</th>
                                <th>Statut</th>
                                <th>Étape restante</th>
                                <th>Motif du blocage</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredRequests.map((request) => (
                                <tr key={request.id}>
                                  <td>{request.employeeName}</td>
                                  <td>{request.leaveTypeName}</td>
                                  <td>du {formatDateFr(request.startDate)} au {formatDateFr(request.endDate)}</td>
                                  <td>{formatDays(request.deductedDays)}</td>
                                  <td>
                                    <span className={`rh-pc-request-status rh-pc-request-status--${REQUEST_STATUS_TONES[request.status] ?? 'neutral'}`}>
                                      {requestStatusLabel(request.status)}
                                    </span>
                                  </td>
                                  <td>{remainingStep(request)}</td>
                                  <td className="rh-pc-table__reason">{blockingReason(request)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'reports' && (
                <div role="tabpanel" id="rh-pc-tab-reports" className="rh-pc-tab-panel">
                  {employeesWithReliquat.length === 0 ? (
                    <div className="rh-pc-state">
                      <Icon name="arrowRight" size={22} />
                      <strong>Aucun report possible</strong>
                      <span>Aucun collaborateur ne possède de reliquat N−1 à reporter sur cette période.</span>
                    </div>
                  ) : (
                    <>
                      <p className="rh-pc-hint">
                        Les reports exceptionnels débitent le reliquat N−1 de la période clôturée et créditent le
                        compteur N−1 de la période suivante. Les validations métier existantes s’appliquent.
                      </p>
                      <ul className="rh-pc-report-list">
                        {employeesWithReliquat.map((employee) => (
                          <li key={employee.employeeId} className="rh-pc-report-row">
                            <div className="rh-pc-report-row__main">
                              <strong>{employee.employeeName}</strong>
                              <span>Reliquat N−1 : {formatDays(employee.nMinus1Remaining)}</span>
                              <span>Jours déjà reportés : {formatDays(employee.exceptionalCarryoverAlreadyApproved)}</span>
                            </div>
                            {carryoverTarget === employee.employeeId ? (
                              <div className="rh-pc-report-form">
                                <div className="rh-pc-report-form__recap">
                                  <div><span>Avant</span><strong>Reliquat N−1 : {formatDays(employee.nMinus1Remaining)}</strong></div>
                                  <div><span>Report</span><strong>{parsedCarryoverDays ? formatDays(parsedCarryoverDays) : '—'}</strong></div>
                                  <div><span>Après</span><strong>Reliquat N−1 : {formatDays(employee.nMinus1Remaining - (parsedCarryoverDays ?? 0))}</strong></div>
                                </div>
                                <div className="rh-pc-report-form__fields">
                                  <label className="rh-pc-field">
                                    <span>Jours à reporter</span>
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="0.5"
                                      value={carryoverForm.days}
                                      onChange={(event) => setCarryoverForm((current) => ({ ...current, days: event.target.value }))}
                                      disabled={carryoverBusy}
                                    />
                                  </label>
                                  <label className="rh-pc-field">
                                    <span>Justification obligatoire</span>
                                    <textarea
                                      rows={2}
                                      maxLength={1000}
                                      value={carryoverForm.reason}
                                      onChange={(event) => setCarryoverForm((current) => ({ ...current, reason: event.target.value }))}
                                      disabled={carryoverBusy}
                                      placeholder="Motif du report exceptionnel"
                                    />
                                  </label>
                                  <div className="rh-pc-report-form__actions">
                                    <button type="button" className="rh-pc-btn rh-pc-btn--primary" onClick={submitCarryover} disabled={carryoverBusy}>
                                      {carryoverBusy ? 'Report…' : 'Confirmer le report'}
                                    </button>
                                    <button type="button" className="rh-pc-btn" onClick={closeCarryover} disabled={carryoverBusy}>
                                      Annuler
                                    </button>
                                  </div>
                                </div>
                                {carryoverError && (
                                  <p className="rh-pc-form-error"><Icon name="alert" size={14} /> {carryoverError}</p>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="rh-pc-btn"
                                onClick={() => openCarryover(employee.employeeId)}
                                disabled={carryoverBusy}
                              >
                                <Icon name="arrowRight" size={15} /> Effectuer un report
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="rh-pc-footer">
          <button type="button" className="rh-pc-btn" onClick={onClose} disabled={busy || carryoverBusy}>
            Annuler / Fermer
          </button>
          <div className="rh-pc-footer__actions">
            {footerReason && (
              <p className="rh-pc-footer__reason">
                <Icon name="info" size={14} /> {footerReason}
              </p>
            )}
            <button
              type="button"
              className="rh-pc-btn rh-pc-btn--primary"
              onClick={() => setConfirmClose(true)}
              disabled={!canCloseNow}
            >
              <Icon name="ban" size={17} /> Clôturer la période
            </button>
          </div>
        </footer>
        </section>
      </div>

      {confirmClose && preview && (
        <div className="rh-pc-confirm" role="dialog" aria-modal="true" aria-label="Confirmer la clôture">
          <div className="rh-pc-confirm__panel">
            <h3>Confirmer la clôture</h3>
            <p className="rh-pc-confirm__intro">
              Récapitulatif de l’opération avant validation définitive.
            </p>
            <div className="rh-pc-confirm__list">
              <div>
                <span>Période concernée</span>
                <strong>{formatReferencePeriodRange(preview.referencePeriod)}</strong>
              </div>
              <div>
                <span>Collaborateurs concernés</span>
                <strong>{preview.employeeCount}</strong>
              </div>
              <div>
                <span>Jours N à transférer</span>
                <strong>{formatDays(preview.totals.nToTransfer)}</strong>
              </div>
              <div>
                <span>Jours N−1 remis à zéro</span>
                <strong>{formatDays(preview.totals.nMinus1ToReset)}</strong>
              </div>
            </div>
            <p className="rh-pc-confirm__warn">
              <Icon name="alert" size={15} /> Cette action est <strong>définitive et irréversible</strong> :
              les compteurs de la période seront clôturés et les remises à zéro appliquées.
            </p>
            <div className="rh-pc-confirm__actions">
              <button type="button" className="rh-pc-btn" onClick={() => setConfirmClose(false)} disabled={busy}>
                Annuler
              </button>
              <button type="button" className="rh-pc-btn rh-pc-btn--danger" onClick={submitClose} disabled={busy}>
                {busy ? 'Clôture en cours…' : 'Confirmer la clôture'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
