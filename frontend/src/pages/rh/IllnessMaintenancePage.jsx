import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
import {
  cancelIllnessMaintenance,
  createIllnessMaintenance,
  listEmployees,
  listIllnessMaintenance,
  uploadBasisDocument,
  validateBasisDocument,
} from '@/services/rh/rhIllnessMaintenance'
import '@/styles/rh/illness-maintenance.css'

const BASIS_LABELS = {
  SYNTEC_5_5: 'Syntec 5.5',
  ACCORD_ENTREPRISE: 'Accord d’entreprise',
  CONTRACTUEL: 'Clause contractuelle',
  AUTRE: 'Autre fondement',
}

const BASIS_STATUS = {
  VALIDATED: { label: 'Validé', badge: 'green' },
  PROPOSED: { label: 'À examiner', badge: 'orange' },
  LEGACY_PENDING: { label: 'Historique à vérifier', badge: 'violet' },
}

function basisBadge(status) {
  const mapped = BASIS_STATUS[status] ?? BASIS_STATUS.PROPOSED
  return { label: mapped.label, badge: mapped.badge }
}

export function RhIllnessMaintenancePage() {
  const [state, setState] = useState({ loading: true, error: null })
  const [decisions, setDecisions] = useState([])
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState({
    employeeId: '',
    startDate: '',
    endDate: '',
    basis: 'SYNTEC_5_5',
    justification: '',
    basisReference: '',
    basisValidFrom: '',
    basisValidTo: '',
    basisDocumentId: '',
  })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [basisFile, setBasisFile] = useState(null)
  const [basisUpload, setBasisUpload] = useState(null)
  const [basisValidationJustification, setBasisValidationJustification] = useState('')

  const load = useCallback(async () => {
    setState({ loading: true, error: null })
    try {
      const [dec, emp] = await Promise.all([listIllnessMaintenance(), listEmployees()])
      setDecisions(dec)
      setEmployees(emp.filter((e) => e.role !== 'ADMIN'))
      setState({ loading: false, error: null })
    } catch (error) {
      setState({
        loading: false,
        error: error?.response?.data?.message ?? 'Impossible de charger les décisions de maintien de salaire.',
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 6000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  )

  const needsBasisValidity = form.basis === 'ACCORD_ENTREPRISE' || form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE'
  const needsBasisDocument = form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE'

  const submit = async () => {
    if (!form.employeeId || !form.startDate || !form.endDate || !form.justification.trim()) {
      setFeedback({ kind: 'error', message: 'Renseignez le collaborateur, la période couverte et la justification.' })
      return
    }
    if (form.startDate > form.endDate) {
      setFeedback({ kind: 'error', message: 'La date de début doit précéder la date de fin.' })
      return
    }
    if (needsBasisValidity && (!form.basisValidFrom || !form.basisValidTo)) {
      setFeedback({ kind: 'error', message: 'Indiquez la période de validité datée du fondement (début et fin).' })
      return
    }
    if (needsBasisDocument && !form.basisDocumentId) {
      setFeedback({ kind: 'error', message: 'Indiquez le justificatif validé rattaché au fondement (identifiant de document).' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      await createIllnessMaintenance({
        employeeId: Number(form.employeeId),
        startDate: form.startDate,
        endDate: form.endDate,
        basis: form.basis,
        justification: form.justification.trim(),
        basisReference: form.basisReference.trim() || undefined,
        basisValidFrom: form.basisValidFrom || undefined,
        basisValidTo: form.basisValidTo || undefined,
        basisDocumentId: form.basisDocumentId ? Number(form.basisDocumentId) : undefined,
      })
      await load()
      setForm({ employeeId: '', startDate: '', endDate: '', basis: 'SYNTEC_5_5', justification: '', basisReference: '', basisValidFrom: '', basisValidTo: '', basisDocumentId: '' })
      setFeedback({ kind: 'success', message: 'Décision enregistrée et acquisition recalculée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement de la décision.' })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id) => {
    setBusy(true)
    setFeedback(null)
    try {
      await cancelIllnessMaintenance(id)
      await load()
      setFeedback({ kind: 'success', message: 'Décision annulée et acquisition recalculée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’annulation de la décision.' })
    } finally {
      setBusy(false)
    }
  }

  const uploadBasis = async () => {
    if (!form.employeeId || !basisFile) {
      setFeedback({ kind: 'error', message: 'Sélectionnez un collaborateur et un fichier PDF/JPG/PNG.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const document = await uploadBasisDocument(Number(form.employeeId), basisFile)
      setBasisUpload(document)
      setForm((c) => ({ ...c, basisDocumentId: String(document.id) }))
      setBasisValidationJustification('')
      setFeedback({ kind: 'success', message: `Justificatif #${document.id} téléversé — en attente de validation RH.` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec du téléversement du justificatif.' })
    } finally {
      setBusy(false)
    }
  }

  const validateBasis = async () => {
    if (!basisUpload?.id) {
      setFeedback({ kind: 'error', message: 'Téléversez d’abord un justificatif.' })
      return
    }
    if (!basisValidationJustification.trim()) {
      setFeedback({ kind: 'error', message: 'Indiquez une justification RH pour valider le fondement.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const document = await validateBasisDocument(basisUpload.id, basisValidationJustification.trim())
      setBasisUpload(document)
      setFeedback({ kind: 'success', message: `Justificatif #${document.id} validé (statut ACCEPTE).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la validation du justificatif.' })
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) {
    return <main className="page-container rh-im-page"><div className="rh-im-state">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container rh-im-page">
        <section className="rh-im-state">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger les décisions de maintien de salaire</strong>
          <span>{state.error}</span>
          <button type="button" className="rh-btn rh-btn--primary" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container rh-im-page">
      <header className="rh-page-hero">
        <div className="rh-page-hero__icon"><Icon name="shield" size={26} /></div>
        <div className="rh-page-hero__body">
          <span className="rh-page-hero__eyebrow">Paramétrage RH</span>
          <h1>Maintien de salaire et arrêts maladie</h1>
        </div>
      </header>

      {feedback && (
        <div className={`rh-feedback rh-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="rh-panel">
        <div className="rh-panel__head">
          <span className="rh-panel__icon rh-panel__icon--blue"><Icon name="plus" size={21} /></span>
          <div>
            <div className="rh-panel__title-row">
              <h2 className="rh-panel__title">Enregistrer une décision de maintien</h2>
              <StatisticInfoButton title="À quoi sert une décision de maintien de salaire ?" wide>
                <p>Lorsqu’un collaborateur est en arrêt maladie, certaines dispositions peuvent prévoir un maintien de salaire et avoir des conséquences sur l’acquisition de ses congés payés.</p>
                <p>Cette rubrique permet à la RH d’enregistrer la période concernée, le fondement applicable (convention collective, accord d’entreprise, contrat ou autre disposition) et les justificatifs nécessaires.</p>
                <p>Les informations enregistrées permettent à l’application de déterminer les droits à congés à prendre en compte selon les règles configurées, tout en conservant un historique des décisions.</p>
                <p>Cette page ne sert pas à calculer ou à verser directement les salaires : elle concerne le suivi RH et ses conséquences sur les droits à congés.</p>
              </StatisticInfoButton>
            </div>
          </div>
        </div>

        <div className="rh-panel__body">
          <fieldset className="rh-im-section">
            <div className="rh-im-section__head">
              <span className="rh-im-section__num">1</span>
              <h3>Collaborateur concerné</h3>
              <p>Salarié bénéficiaire du maintien</p>
            </div>
            <label className="rh-field">
              <span className="rh-field__label">Collaborateur</span>
              <select className="rh-select" value={form.employeeId} onChange={(e) => setForm((c) => ({ ...c, employeeId: e.target.value }))}>
                <option value="">— Sélectionner un collaborateur —</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.nom} {employee.prenom} ({employee.email})
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="rh-im-section">
            <div className="rh-im-section__head">
              <span className="rh-im-section__num">2</span>
              <h3>Période couverte</h3>
              <p>Plage de l’arrêt ouvrant droit au maintien</p>
            </div>
            <div className="rh-grid-2">
              <label className="rh-field">
                <span className="rh-field__label">Début de la période</span>
                <input className="rh-input" type="date" value={form.startDate} onChange={(e) => setForm((c) => ({ ...c, startDate: e.target.value }))} />
              </label>
              <label className="rh-field">
                <span className="rh-field__label">Fin de la période</span>
                <input className="rh-input" type="date" value={form.endDate} onChange={(e) => setForm((c) => ({ ...c, endDate: e.target.value }))} />
              </label>
            </div>
          </fieldset>

          <fieldset className="rh-im-section">
            <div className="rh-im-section__head">
              <span className="rh-im-section__num">3</span>
              <h3>Fondement</h3>
              <p>Base conventionnelle, contractuelle ou autre</p>
            </div>
            <div className="rh-grid-2">
              <label className="rh-field">
                <span className="rh-field__label">Fondement</span>
                <select className="rh-select" value={form.basis} onChange={(e) => setForm((c) => ({ ...c, basis: e.target.value }))}>
                  <option value="SYNTEC_5_5">Syntec 5.5</option>
                  <option value="ACCORD_ENTREPRISE">Accord d’entreprise</option>
                  <option value="CONTRACTUEL">Clause contractuelle</option>
                  <option value="AUTRE">Autre fondement</option>
                </select>
              </label>
              {needsBasisValidity && (
                <>
                  <label className="rh-field">
                    <span className="rh-field__label">Validité du fondement (début)</span>
                    <input className="rh-input" type="date" value={form.basisValidFrom} onChange={(e) => setForm((c) => ({ ...c, basisValidFrom: e.target.value }))} />
                  </label>
                  <label className="rh-field">
                    <span className="rh-field__label">Validité du fondement (fin)</span>
                    <input className="rh-input" type="date" value={form.basisValidTo} onChange={(e) => setForm((c) => ({ ...c, basisValidTo: e.target.value }))} />
                  </label>
                </>
              )}
            </div>
          </fieldset>

          {needsBasisValidity && (
            <fieldset className="rh-im-section">
              <div className="rh-im-section__head">
                <span className="rh-im-section__num">4</span>
                <h3>Justificatif et référence</h3>
                <p>Document probant et libellé du fondement</p>
              </div>
              <div className="rh-grid-2">
                <label className="rh-field">
                  <span className="rh-field__label">Référence du fondement (libellé)</span>
                  <input
                    className="rh-input"
                    type="text"
                    maxLength={500}
                    value={form.basisReference}
                    placeholder="Ex. Accord d’entreprise « … » / clause contractuelle art. …"
                    onChange={(e) => setForm((c) => ({ ...c, basisReference: e.target.value }))}
                  />
                </label>
                {needsBasisDocument && (
                  <label className="rh-field">
                    <span className="rh-field__label">Justificatif validé (n° document)</span>
                    <input className="rh-input" type="number" value={form.basisDocumentId} onChange={(e) => setForm((c) => ({ ...c, basisDocumentId: e.target.value }))} />
                  </label>
                )}
              </div>

              {needsBasisDocument && (
                <div className="rh-im-upload">
                  <div className="rh-im-upload__row">
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setBasisFile(e.target.files?.[0] ?? null)} />
                    <button type="button" className="rh-btn rh-btn--primary rh-btn--sm" onClick={uploadBasis} disabled={busy}>Téléverser</button>
                  </div>
                  {basisUpload && (
                    <span className="rh-im-doc">
                      <Icon name="file" size={14} />
                      Document #{basisUpload.id} — {basisUpload.status ?? 'EN_ATTENTE'}
                    </span>
                  )}
                  {basisUpload && basisUpload.status === 'EN_ATTENTE' && (
                    <div className="rh-field" style={{ marginTop: 6 }}>
                      <span className="rh-field__label">Justification RH de la validation du fondement</span>
                      <textarea className="rh-textarea" rows={2} maxLength={4000} placeholder="Justification RH de la validation du fondement…" value={basisValidationJustification} onChange={(e) => setBasisValidationJustification(e.target.value)} />
                      <div>
                        <button type="button" className="rh-btn rh-btn--accent rh-btn--sm" onClick={validateBasis} disabled={busy}>Valider le justificatif</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          )}

          <fieldset className="rh-im-section">
            <div className="rh-im-section__head">
              <span className="rh-im-section__num">{needsBasisValidity ? 5 : 4}</span>
              <h3>Validation et justification</h3>
              <p>Motivation RH conservée dans l’historique</p>
            </div>
            <label className="rh-field">
              <span className="rh-field__label">Justification</span>
              <textarea
                className="rh-textarea"
                rows={3}
                maxLength={4000}
                value={form.justification}
                placeholder="Maintien de salaire conventionnel confirmé par la paie…"
                onChange={(e) => setForm((c) => ({ ...c, justification: e.target.value }))}
              />
            </label>
          </fieldset>
        </div>

        <div className="rh-panel__foot">
          <button type="button" onClick={submit} disabled={busy} className="rh-btn rh-btn--accent">
            <Icon name="check" size={15} /> Enregistrer la décision
          </button>
        </div>
      </section>

      <section className="rh-panel">
        <div className="rh-panel__head">
          <span className="rh-panel__icon rh-panel__icon--green"><Icon name="list" size={21} /></span>
          <div>
            <h2 className="rh-panel__title">Décisions enregistrées</h2>
            <p className="rh-panel__sub">Historique des décisions de maintien de salaire et de leur fondement.</p>
          </div>
          <span className="rh-badge rh-badge--neutral" style={{ marginLeft: 'auto' }}>{decisions.length} décision{decisions.length > 1 ? 's' : ''}</span>
        </div>

        <div className="rh-panel__body">
          {decisions.length === 0 && (
            <div className="rh-empty">
              <span className="rh-empty__icon rh-empty__icon--green"><Icon name="check" size={26} /></span>
              <strong>Aucune décision de maintien enregistrée</strong>
              <span>Les décisions individuelles de maintien de salaire apparaîtront ici, avec leur fondement, leur période couverte et leur statut de validation.</span>
            </div>
          )}

          {decisions.length > 0 && (
            <div>
              {decisions.map((decision) => {
                const employee = employeeById.get(decision.employeeId)
                const badge = basisBadge(decision.basisValidationStatus)
                const initials = employee ? `${(employee.nom?.[0] ?? '').toUpperCase()}${(employee.prenom?.[0] ?? '').toUpperCase()}` : '??'
                return (
                  <div key={decision.id} className="rh-im-decision">
                    <div className="rh-im-decision__person">
                      <span className="rh-im-decision__avatar">{initials}</span>
                      <div>
                        <strong>{employee ? `${employee.nom} ${employee.prenom}` : `#${decision.employeeId}`}</strong>
                        <small>{employee?.email ?? 'Collaborateur'}</small>
                      </div>
                    </div>

                    <div className="rh-im-decision__cell">
                      <span>Période couverte</span>
                      <strong>{decision.startDate?.slice(0, 10)} → {decision.endDate?.slice(0, 10)}</strong>
                    </div>

                    <div className="rh-im-decision__cell">
                      <span>Fondement</span>
                      <strong>{BASIS_LABELS[decision.basis] ?? decision.basis}</strong>
                      <span className={`rh-badge rh-badge--${badge.badge}`}>{badge.label}</span>
                    </div>

                    <div className="rh-im-decision__cell">
                      <span>Justification</span>
                      <div className="rh-im-decision__just">{decision.justification}</div>
                      {decision.basisReference && <div className="rh-im-decision__ref">Réf. : {decision.basisReference}</div>}
                      {(decision.basisValidFrom || decision.basisValidTo) && (
                        <div className="rh-im-decision__ref">Valide {decision.basisValidFrom ?? '…'} → {decision.basisValidTo ?? '…'}</div>
                      )}
                    </div>

                    <div className="rh-im-decision__cell">
                      <span>Décidée par</span>
                      <strong>#{decision.decidedById ?? '—'}</strong>
                    </div>

                    <button type="button" onClick={() => cancel(decision.id)} disabled={busy} className="rh-btn rh-btn--danger rh-btn--sm">Annuler</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
