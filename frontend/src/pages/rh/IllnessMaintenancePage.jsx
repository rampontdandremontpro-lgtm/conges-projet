import { useCallback, useEffect, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import {
  cancelIllnessMaintenance,
  createIllnessMaintenance,
  listEmployees,
  listIllnessMaintenance,
  uploadBasisDocument,
  validateBasisDocument,
} from '@/services/rh/rhIllnessMaintenance'
import '@/styles/rh/illness-maintenance.css'

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

  const submit = async () => {
    if (!form.employeeId || !form.startDate || !form.endDate || !form.justification.trim()) {
      setFeedback({ kind: 'error', message: 'Renseignez le collaborateur, la période couverte et la justification.' })
      return
    }
    if (form.startDate > form.endDate) {
      setFeedback({ kind: 'error', message: 'La date de début doit précéder la date de fin.' })
      return
    }
    if ((form.basis === 'ACCORD_ENTREPRISE' || form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE') && (!form.basisValidFrom || !form.basisValidTo)) {
      setFeedback({ kind: 'error', message: 'Indiquez la période de validité datée du fondement (début et fin).' })
      return
    }
    if ((form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE') && !form.basisDocumentId) {
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
    return <main className="page-container illness-maintenance-page"><div className="im-loading">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container illness-maintenance-page">
        <section className="im-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger les décisions de maintien de salaire</strong>
          <span>{state.error}</span>
          <button type="button" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container illness-maintenance-page">
      <header className="im-header">
        <div>
          <small>JUR-025 / JUR-037</small>
          <h1>Maintien de salaire des arrêts maladie (Syntec 5.5)</h1>
          <p>
            Une décision individuelle justifiée prouve l’assimilation au travail effectif (2,5 j/mois)
            pour la période couverte. Sans décision, le socle légal de 2 j/mois est garanti.
          </p>
        </div>
      </header>

      {feedback && (
        <div className={`im-feedback im-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="im-card">
        <h2>Enregistrer une décision de maintien</h2>
        <div className="im-form">
          <label className="im-field">
            <span>Collaborateur</span>
            <select value={form.employeeId} onChange={(e) => setForm((c) => ({ ...c, employeeId: e.target.value }))}>
              <option value="">—</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.nom} {employee.prenom} ({employee.email})
                </option>
              ))}
            </select>
          </label>
          <label className="im-field">
            <span>Début de la période couverte</span>
            <input type="date" value={form.startDate} onChange={(e) => setForm((c) => ({ ...c, startDate: e.target.value }))} />
          </label>
          <label className="im-field">
            <span>Fin de la période couverte</span>
            <input type="date" value={form.endDate} onChange={(e) => setForm((c) => ({ ...c, endDate: e.target.value }))} />
          </label>
          <label className="im-field">
            <span>Fondement</span>
            <select value={form.basis} onChange={(e) => setForm((c) => ({ ...c, basis: e.target.value }))}>
              <option value="SYNTEC_5_5">Syntec 5.5</option>
              <option value="ACCORD_ENTREPRISE">Accord d’entreprise</option>
              <option value="CONTRACTUEL">Clause contractuelle</option>
              <option value="AUTRE">Autre fondement</option>
            </select>
          </label>
          {(form.basis === 'ACCORD_ENTREPRISE' || form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE') && (
            <>
              <label className="im-field">
                <span>Validité du fondement (début)</span>
                <input type="date" value={form.basisValidFrom} onChange={(e) => setForm((c) => ({ ...c, basisValidFrom: e.target.value }))} />
              </label>
              <label className="im-field">
                <span>Validité du fondement (fin)</span>
                <input type="date" value={form.basisValidTo} onChange={(e) => setForm((c) => ({ ...c, basisValidTo: e.target.value }))} />
              </label>
              {(form.basis === 'CONTRACTUEL' || form.basis === 'AUTRE') && (
                <>
                  <label className="im-field">
                    <span>Justificatif validé (n° document)</span>
                    <input type="number" value={form.basisDocumentId} onChange={(e) => setForm((c) => ({ ...c, basisDocumentId: e.target.value }))} />
                  </label>
                  <div className="im-field im-field--full im-basis-upload">
                    <span>Téléverser le justificatif (fichier)</span>
                    <div className="im-basis-upload__row">
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setBasisFile(e.target.files?.[0] ?? null)} />
                      <button type="button" onClick={uploadBasis} disabled={busy}>Téléverser</button>
                    </div>
                    {basisUpload && (
                      <small className="im-basis-ref">Document #{basisUpload.id} — {basisUpload.status ?? 'EN_ATTENTE'}</small>
                    )}
                    {basisUpload && basisUpload.status === 'EN_ATTENTE' && (
                      <div className="im-basis-upload__validate">
                        <textarea rows={2} maxLength={4000} placeholder="Justification RH de la validation du fondement…" value={basisValidationJustification} onChange={(e) => setBasisValidationJustification(e.target.value)} />
                        <button type="button" onClick={validateBasis} disabled={busy}>Valider le justificatif</button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <label className="im-field im-field--full">
                <span>Référence du fondement (libellé)</span>
                <input
                  type="text"
                  maxLength={500}
                  value={form.basisReference}
                  placeholder="Ex. Accord d’entreprise « … » / clause contractuelle art. …"
                  onChange={(e) => setForm((c) => ({ ...c, basisReference: e.target.value }))}
                />
              </label>
            </>
          )}
          <label className="im-field im-field--full">
            <span>Justification</span>
            <textarea
              rows={3}
              maxLength={4000}
              value={form.justification}
              placeholder="Maintien de salaire conventionnel confirmé par la paie…"
              onChange={(e) => setForm((c) => ({ ...c, justification: e.target.value }))}
            />
          </label>
        </div>
        <div className="im-actions">
          <button type="button" onClick={submit} disabled={busy} className="im-save">Enregistrer la décision</button>
        </div>
      </section>

      <section className="im-card">
        <h2>Décisions actives</h2>
        {decisions.length === 0 && <p className="im-empty">Aucune décision de maintien enregistrée.</p>}
        {decisions.length > 0 && (
          <table className="im-table">
            <thead>
              <tr>
                <th>Collaborateur</th>
                <th>Période couverte</th>
                <th>Fondement</th>
                <th>Justification</th>
                <th>Décidée par</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {decisions.map((decision) => (
                <tr key={decision.id} className="im-decision-row">
                  <td>#{decision.employeeId}</td>
                  <td>{decision.startDate?.slice(0, 10)} → {decision.endDate?.slice(0, 10)}</td>
                  <td>
                    {decision.basis}
                    <small className="im-basis-ref">{decision.basisValidationStatus ?? 'PROPOSED'}</small>
                  </td>
                  <td className="im-justification">
                    {decision.justification}
                    {decision.basisReference && <small className="im-basis-ref">Réf. : {decision.basisReference}</small>}
                    {(decision.basisValidFrom || decision.basisValidTo) && (
                      <small className="im-basis-ref">Valide {decision.basisValidFrom ?? '…'} → {decision.basisValidTo ?? '…'}</small>
                    )}
                  </td>
                  <td>#{decision.decidedById ?? '—'}</td>
                  <td>
                    <button type="button" onClick={() => cancel(decision.id)} disabled={busy} className="im-cancel">Annuler</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
