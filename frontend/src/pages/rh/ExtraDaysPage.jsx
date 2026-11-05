import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { StatisticInfoButton } from '@/components/shared/StatisticInfoButton'
import {
  applyFractionnement,
  applySeniorityExtra,
  createTakePeriodReport,
  getFractionnementConfig,
  getSeniorityExtraConfig,
  getTakePeriodOverview,
  listTakePeriodReports,
  listReportDocuments,
  listLeaveTypes,
  getSettingValue,
  patchSetting,
  previewArreteChevauchement,
  restoreArreteChevauchement,
  reverseArreteChevauchement,
  updateLegalEntityConvention,
  updateLeaveTypeAbsenceKind,
  previewFractionnement,
  previewSeniorityExtra,
  recomputeFractionnement,
  updateFractionnementConfig,
  updateSeniorityExtraConfig,
  uploadReportDocument,
} from '@/services/rh/rhExtraDays'
import { apiClient } from '@/services/apiClient'
import '@/styles/rh/extra-days.css'

const SYNTEC_THRESHOLDS = [
  { minYears: 5, extraDays: 1 },
  { minYears: 10, extraDays: 2 },
  { minYears: 15, extraDays: 3 },
  { minYears: 20, extraDays: 4 },
]

const TABS = [
  { id: 'anciennete', label: 'Ancienneté', icon: 'sparkles' },
  { id: 'fractionnement', label: 'Fractionnement', icon: 'calendar' },
  { id: 'prise', label: 'Périodes de prise', icon: 'clock' },
  { id: 'arrete', label: 'Arrêt maladie / congés', icon: 'shield' },
  { id: 'convention', label: 'Conventions collectives', icon: 'building' },
]

function currentReferencePeriod() {
  const now = new Date()
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const year = now.getFullYear()
  return monthDay >= '06-01' ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

function monthDayToInput(monthDay, year) {
  const [month, day] = String(monthDay ?? '').split('-')
  if (!month || !day) return `${year}-05-01`
  return `${year}-${month}-${day}`
}

function inputToMonthDay(value) {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}-${match[2]}` : ''
}

export function RhExtraDaysPage() {
  const year = new Date().getFullYear()
  const [state, setState] = useState({ loading: true, error: null })
  const [entities, setEntities] = useState([])
  const [activeTab, setActiveTab] = useState('anciennete')

  const [seniority, setSeniority] = useState({
    enabled: false,
    referenceMonthDay: '05-01',
    legalEntityCodes: [],
    thresholds: SYNTEC_THRESHOLDS.map((t) => ({ ...t })),
  })
  const [fractionnement, setFractionnement] = useState({
    eligiblePeriodStart: '05-01',
    eligiblePeriodEnd: '10-31',
    entities: [],
  })

  const [period, setPeriod] = useState(currentReferencePeriod())
  const [seniorityPreview, setSeniorityPreview] = useState(null)
  const [fractionnementPreview, setFractionnementPreview] = useState(null)
  const [takePeriod, setTakePeriod] = useState(null)
  const [takePeriodReports, setTakePeriodReports] = useState([])
  const [reportDocuments, setReportDocuments] = useState([])
  const [reportForm, setReportForm] = useState({ employeeId: '', justification: '', documentId: '', newDeadline: '' })
  const [uploading, setUploading] = useState(false)

  const [jur28, setJur28] = useState({ enabled: false, maladieTypeIds: '', absenceId: '', preview: null })
  const [absenceTypes, setAbsenceTypes] = useState([])
  const [jur24, setJur24] = useState({})
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async () => {
    setState({ loading: true, error: null })
    try {
      const [{ data: legalEntities }, srConfig, frConfig] = await Promise.all([
        apiClient.get('/legal-entities'),
        getSeniorityExtraConfig(),
        getFractionnementConfig(),
      ])
      const [jur28Enabled, jur28Types, absenceTypes] = await Promise.all([
        getSettingValue('ARRET_CHEVAUCHEMENT_ENABLED'),
        getSettingValue('ARRET_MALADIE_TYPE_IDS'),
        listLeaveTypes(),
      ])
      setAbsenceTypes((absenceTypes ?? []).filter((t) => t.category === 'DECLARATION_ABSENCE'))
      setJur28((current) => ({
        ...current,
        enabled: jur28Enabled === 'true',
        maladieTypeIds: jur28Types ?? '',
      }))
      setEntities(legalEntities ?? [])
      setJur24(Object.fromEntries((legalEntities ?? []).map((e) => [e.id, { conventionType: e.conventionType ?? 'NON_RENSEIGNEE', idcc: e.idcc ?? '', conventionName: e.conventionName ?? '', accordType: e.accordType ?? 'NONE', accordName: e.accordName ?? '', accordIdcc: e.accordIdcc ?? '' }])))
      setSeniority({
        enabled: srConfig?.enabled === true,
        referenceMonthDay: srConfig?.referenceMonthDay ?? '05-01',
        legalEntityCodes: srConfig?.legalEntityCodes ?? [],
        thresholds: Array.isArray(srConfig?.thresholds) && srConfig.thresholds.length > 0
          ? srConfig.thresholds.map((t) => ({ ...t }))
          : SYNTEC_THRESHOLDS.map((t) => ({ ...t })),
      })
      setFractionnement({
        eligiblePeriodStart: frConfig?.eligiblePeriodStart ?? '05-01',
        eligiblePeriodEnd: frConfig?.eligiblePeriodEnd ?? '10-31',
        entities: Array.isArray(frConfig?.entities)
          ? frConfig.entities.map((e) => ({ ...e }))
          : [],
      })
      setState({ loading: false, error: null })
    } catch (error) {
      setState({
        loading: false,
        error: error?.response?.data?.message ?? 'Impossible de charger la configuration des droits supplémentaires.',
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 6000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const entityByCode = useMemo(
    () => new Map(entities.map((e) => [e.code, e])),
    [entities],
  )

  const toggleSeniorityEntity = (code) => {
    setSeniority((current) => {
      const present = current.legalEntityCodes.includes(code)
      return {
        ...current,
        legalEntityCodes: present
          ? current.legalEntityCodes.filter((c) => c !== code)
          : [...current.legalEntityCodes, code],
      }
    })
  }

  const setFractionnementEntityRegime = (code, regime) => {
    setFractionnement((current) => {
      const others = current.entities.filter((e) => e.code !== code)
      return {
        ...current,
        entities: regime === 'NONE' ? others : [...others, { code, regime }],
      }
    })
  }

  const regimeOf = (code) =>
    fractionnement.entities.find((e) => e.code === code)?.regime ?? 'NONE'

  const saveSeniority = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await updateSeniorityExtraConfig({
        enabled: seniority.enabled,
        referenceMonthDay: seniority.referenceMonthDay,
        thresholds: seniority.thresholds.map((t) => ({ minYears: Number(t.minYears), extraDays: Number(t.extraDays) })),
        legalEntityCodes: seniority.legalEntityCodes,
      })
      setFeedback({ kind: 'success', message: 'Configuration de l’ancienneté enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement de l’ancienneté.' })
    } finally {
      setBusy(false)
    }
  }

  const saveFractionnement = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await updateFractionnementConfig({
        eligiblePeriodStart: fractionnement.eligiblePeriodStart,
        eligiblePeriodEnd: fractionnement.eligiblePeriodEnd,
        entities: fractionnement.entities.map((e) => ({ ...e })),
      })
      setFeedback({ kind: 'success', message: 'Configuration du fractionnement enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement du fractionnement.' })
    } finally {
      setBusy(false)
    }
  }

  const loadSeniorityPreviewData = async () => {
    setSeniorityPreview(await previewSeniorityExtra(period))
  }

  const runSeniorityPreview = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await loadSeniorityPreviewData()
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation de l’ancienneté.' })
    } finally {
      setBusy(false)
    }
  }

  const runSeniorityApply = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await applySeniorityExtra(period)
      await loadSeniorityPreviewData()
      setFeedback({ kind: 'success', message: `Ancienneté : ${result.allocated.length} attribution(s), ${result.skipped.length} dossier(s) non concerné(s).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’attribution de l’ancienneté.' })
    } finally {
      setBusy(false)
    }
  }

  const loadFractionnementPreviewData = async () => {
    setFractionnementPreview(await previewFractionnement(period))
  }

  const runFractionnementPreview = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await loadFractionnementPreviewData()
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation du fractionnement.' })
    } finally {
      setBusy(false)
    }
  }

  const runFractionnementApply = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await applyFractionnement(period)
      await loadFractionnementPreviewData()
      setFeedback({ kind: 'success', message: `Fractionnement : ${result.allocated.length} attribution(s), ${result.skipped.length} dossier(s) non concerné(s).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’attribution du fractionnement.' })
    } finally {
      setBusy(false)
    }
  }

  const runFractionnementRecompute = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await recomputeFractionnement(period)
      await loadFractionnementPreviewData()
      setFeedback({ kind: 'success', message: `Fractionnement recalculé : ${result.adjusted.length} ajustement(s).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec du recalcul du fractionnement.' })
    } finally {
      setBusy(false)
    }
  }

  const loadTakePeriodData = async () => {
    const [overview, reports, documents] = await Promise.all([
      getTakePeriodOverview(period),
      listTakePeriodReports(period),
      listReportDocuments(),
    ])
    setTakePeriod(overview)
    setTakePeriodReports(reports ?? [])
    setReportDocuments(documents ?? [])
  }

  const handleReportFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setFeedback(null)
    try {
      const document = await uploadReportDocument(file)
      setReportForm((c) => ({ ...c, documentId: String(document.id) }))
      setReportDocuments((current) => [document, ...current.filter((d) => d.id !== document.id)])
      setFeedback({ kind: 'success', message: `Justificatif « ${document.originalName ?? 'fichier'} » joint et conservé.` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’envoi du justificatif.' })
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const runTakePeriod = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await loadTakePeriodData()
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la lecture de la période de prise.' })
    } finally {
      setBusy(false)
    }
  }

  const submitReport = async () => {
    if (!reportForm.employeeId || !reportForm.justification.trim() || !reportForm.newDeadline) {
      setFeedback({ kind: 'error', message: 'Renseignez le collaborateur, la justification et la nouvelle échéance.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      await createTakePeriodReport({
        employeeId: Number(reportForm.employeeId),
        referencePeriod: period,
        justification: reportForm.justification.trim(),
        documentId: reportForm.documentId ? Number(reportForm.documentId) : undefined,
        newDeadline: reportForm.newDeadline,
      })
      await loadTakePeriodData()
      setFeedback({ kind: 'success', message: 'Report enregistré (traçabilité conservée).' })
      setReportForm({ employeeId: '', justification: '', documentId: '', newDeadline: '' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement du report.' })
    } finally {
      setBusy(false)
    }
  }

  const saveJur28 = async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await Promise.all([
        patchSetting('ARRET_CHEVAUCHEMENT_ENABLED', jur28.enabled ? 'true' : 'false'),
        patchSetting('ARRET_MALADIE_TYPE_IDS', jur28.maladieTypeIds.trim() || ' '),
      ])
      setFeedback({ kind: 'success', message: 'Configuration de l’interaction arrêt maladie / congés enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement de l’interaction arrêt maladie / congés.' })
    } finally {
      setBusy(false)
    }
  }

  const saveAbsenceKind = async (type, kind) => {
    setBusy(true)
    setFeedback(null)
    try {
      await updateLeaveTypeAbsenceKind(type.id, kind)
      setAbsenceTypes((list) => list.map((t) => (t.id === type.id ? { ...t, absenceKind: kind } : t)))
      setFeedback({ kind: 'success', message: `Classification de « ${type.name} » enregistrée (${kind}).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la classification du type d’absence.' })
    } finally {
      setBusy(false)
    }
  }

  const runJur28Preview = async () => {
    if (!jur28.absenceId) { setFeedback({ kind: 'error', message: 'Renseignez l’identifiant de la déclaration d’absence.' }); return }
    setBusy(true)
    setFeedback(null)
    try {
      const preview = await previewArreteChevauchement(Number(jur28.absenceId))
      setJur28((c) => ({ ...c, preview }))
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation de l’interaction arrêt maladie / congés.' })
    } finally {
      setBusy(false)
    }
  }

  const runJur28Restore = async () => {
    if (!jur28.absenceId) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await restoreArreteChevauchement(Number(jur28.absenceId))
      await runJur28Preview()
      setFeedback({ kind: 'success', message: `Restitution : ${result.restoredDays} jour(s) restitué(s).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la restitution.' })
    } finally {
      setBusy(false)
    }
  }

  const runJur28Reverse = async () => {
    if (!jur28.absenceId) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await reverseArreteChevauchement(Number(jur28.absenceId))
      await runJur28Preview()
      setFeedback({ kind: 'success', message: `Inversion : ${result.reversed} jour(s) reversé(s).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’inversion.' })
    } finally {
      setBusy(false)
    }
  }

  const saveJur24Entity = async (entity) => {
    const config = jur24[entity.id]
    if (!config) return
    setBusy(true)
    setFeedback(null)
    try {
      await updateLegalEntityConvention(entity.id, {
        conventionType: config.conventionType,
        idcc: config.idcc.trim() || undefined,
        conventionName: config.conventionName.trim() || undefined,
        accordType: config.accordType,
        accordName: config.accordName.trim() || undefined,
        accordIdcc: config.accordIdcc.trim() || undefined,
      })
      setFeedback({ kind: 'success', message: `Convention de ${entity.name} enregistrée (${config.conventionType}).` })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement de la convention.' })
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) {
    return <main className="page-container rh-extra-days-page"><div className="rh-extra-days-state">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container rh-extra-days-page">
        <section className="rh-extra-days-state">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger les droits supplémentaires</strong>
          <span>{state.error}</span>
          <button type="button" className="rh-btn rh-btn--primary" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container rh-extra-days-page">
      <header className="rh-page-hero">
        <div className="rh-page-hero__icon"><Icon name="sparkles" size={26} /></div>
        <div className="rh-page-hero__body">
          <span className="rh-page-hero__eyebrow">Paramétrage RH</span>
          <h1>Droits supplémentaires</h1>
        </div>
        <div className="rh-page-hero__aside">
          <span>Période de référence</span>
          <input
            type="text"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            pattern="\d{4}-\d{4}"
            aria-label="Période de référence"
          />
        </div>
      </header>

      {feedback && (
        <div className={`rh-feedback rh-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <nav className="rh-tabs" role="tablist" aria-label="Rubriques des droits supplémentaires">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`rh-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="rh-tab__icon"><Icon name={tab.icon} size={14} /></span>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'anciennete' && (
        <section className="rh-panel">
          <div className="rh-panel__head">
            <span className="rh-panel__icon rh-panel__icon--blue"><Icon name="sparkles" size={21} /></span>
            <div>
              <div className="rh-panel__title-row">
                <h2 className="rh-panel__title">Congés d’ancienneté</h2>
                <StatisticInfoButton title="Comprendre les congés d’ancienneté" wide>
                  <p>Les congés d’ancienneté sont des jours de repos supplémentaires accordés à certains salariés en fonction du nombre d’années passées dans leur entreprise.</p>
                  <p>Par exemple, la convention Syntec prévoit 1 jour supplémentaire après 5 ans d’ancienneté, 2 jours après 10 ans, 3 jours après 15 ans et 4 jours après 20 ans.</p>
                  <p>Cette rubrique permet à la RH de configurer les conditions applicables à chaque entité, de vérifier les bénéficiaires et de prévisualiser les jours avant leur attribution.</p>
                </StatisticInfoButton>
              </div>
            </div>
          </div>

          <div className="rh-panel__body">
            <label className="rh-switch">
              <input type="checkbox" checked={seniority.enabled} onChange={(e) => setSeniority((c) => ({ ...c, enabled: e.target.checked }))} />
              <span className="rh-switch__track" />
              <span className="rh-switch__label">Activer l’attribution automatique</span>
              <span className="rh-switch__state">{seniority.enabled ? 'Activée' : 'Désactivée'}</span>
            </label>

            <div className="rh-grid-2">
              <label className="rh-field">
                <span className="rh-field__label">Date d’appréciation <span className="rh-field__hint">ouverture de la période de prise</span></span>
                <input
                  className="rh-input"
                  type="date"
                  value={monthDayToInput(seniority.referenceMonthDay, year)}
                  onChange={(e) => setSeniority((c) => ({ ...c, referenceMonthDay: inputToMonthDay(e.target.value) }))}
                />
              </label>

              <div className="rh-field">
                <span className="rh-field__label">Entités concernées</span>
                <div className="rh-extra-days-entities">
                  {entities.map((entity) => (
                    <label key={entity.code} className="rh-chip">
                      <input
                        type="checkbox"
                        checked={seniority.legalEntityCodes.includes(entity.code)}
                        onChange={() => toggleSeniorityEntity(entity.code)}
                      />
                      <span className="rh-chip__dot"><Icon name="check" size={11} /></span>
                      {entity.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="rh-field">
              <span className="rh-field__label">Paliers d’ancienneté <span className="rh-field__hint">jours totaux, non cumulatifs</span></span>
              <div className="rh-ed-threshold-list">
                {seniority.thresholds.map((threshold, index) => (
                  <div key={index} className="rh-ed-threshold">
                    <span className="rh-ed-threshold__step">
                      À partir de <em>paller n°{index + 1}</em>
                    </span>
                    <input
                      className="rh-input"
                      type="number"
                      min="0"
                      value={threshold.minYears}
                      aria-label={`Seuil d'années du palier ${index + 1}`}
                      onChange={(e) => setSeniority((c) => ({
                        ...c,
                        thresholds: c.thresholds.map((t, i) => i === index ? { ...t, minYears: Number(e.target.value) } : t),
                      }))}
                    />
                    <span className="rh-ed-threshold__sep">ans →</span>
                    <input
                      className="rh-input"
                      type="number"
                      min="0"
                      step="0.5"
                      value={threshold.extraDays}
                      aria-label={`Jours attribués au palier ${index + 1}`}
                      onChange={(e) => setSeniority((c) => ({
                        ...c,
                        thresholds: c.thresholds.map((t, i) => i === index ? { ...t, extraDays: Number(e.target.value) } : t),
                      }))}
                    />
                    <span className="rh-ed-threshold__sep">jour(s) ouvré(s)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rh-panel__foot">
            <button type="button" onClick={saveSeniority} disabled={busy} className="rh-btn rh-btn--primary">Enregistrer</button>
            <button type="button" onClick={runSeniorityPreview} disabled={busy} className="rh-btn">Prévisualiser</button>
            <button type="button" onClick={runSeniorityApply} disabled={busy || !seniority.enabled} className="rh-btn rh-btn--accent">Attribuer les jours d’ancienneté</button>
          </div>

          {seniorityPreview && (
            <div className="rh-panel__body" style={{ borderTop: '1px solid #e9f0f8' }}>
              <div className="rh-table-scroll">
                <table className="rh-table">
                  <thead>
                    <tr><th>Collaborateur</th><th>Entité</th><th>Embauche</th><th>Date d’appréciation</th><th>Ancienneté</th><th>Jours</th><th>Déjà attribué</th></tr>
                  </thead>
                  <tbody>
                    {seniorityPreview.map((item) => (
                      <tr key={item.employeeId}>
                        <td>{item.nom} {item.prenom}</td>
                        <td>{item.legalEntityCode ?? '—'}</td>
                        <td>{item.hireDate ?? '—'}</td>
                        <td>{item.referenceDate}</td>
                        <td>{item.fullYears} an(s)</td>
                        <td>{item.applicable ? `+${item.extraDays}` : '—'}</td>
                        <td>{item.alreadyAllocated ? 'Oui' : 'Non'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'fractionnement' && (
        <section className="rh-panel">
          <div className="rh-panel__head">
            <span className="rh-panel__icon rh-panel__icon--orange"><Icon name="calendar" size={21} /></span>
            <div>
              <div className="rh-panel__title-row">
                <h2 className="rh-panel__title">Fractionnement des congés payés</h2>
                <StatisticInfoButton title="Comprendre les jours de fractionnement" wide>
                  <p>Le fractionnement concerne les salariés qui prennent une partie de leur congé principal en dehors de la période habituelle, généralement du 1er mai au 31 octobre.</p>
                  <p>Selon les règles applicables, ils peuvent bénéficier de jours de congé supplémentaires.</p>
                  <p>Par exemple, la convention Syntec prévoit, sous conditions, 1 jour supplémentaire pour 3 ou 4 jours ouvrés concernés et 2 jours supplémentaires à partir de 5 jours ouvrés. La cinquième semaine est exclue de ce calcul.</p>
                  <p>Cette rubrique permet à la RH de vérifier les congés réellement pris, de sélectionner les règles applicables à chaque entité et de prévisualiser les droits avant attribution.</p>
                </StatisticInfoButton>
              </div>
            </div>
          </div>

          <div className="rh-panel__body">
            <div className="rh-grid-2">
              <label className="rh-field">
                <span className="rh-field__label">Période légale — début</span>
                <input
                  className="rh-input"
                  type="date"
                  value={monthDayToInput(fractionnement.eligiblePeriodStart, year)}
                  onChange={(e) => setFractionnement((c) => ({ ...c, eligiblePeriodStart: inputToMonthDay(e.target.value) }))}
                />
              </label>
              <label className="rh-field">
                <span className="rh-field__label">Période légale — fin</span>
                <input
                  className="rh-input"
                  type="date"
                  value={monthDayToInput(fractionnement.eligiblePeriodEnd, year)}
                  onChange={(e) => setFractionnement((c) => ({ ...c, eligiblePeriodEnd: inputToMonthDay(e.target.value) }))}
                />
              </label>
            </div>

            <div className="rh-field">
              <span className="rh-field__label">Régime par entité <span className="rh-field__hint">aucun cumul entre régimes</span></span>
              <div className="rh-ed-entity-list">
                {entities.map((entity) => (
                  <div key={entity.code} className="rh-ed-entity-row">
                    <span className="rh-ed-entity-row__name">{entity.name}</span>
                    <select
                      className="rh-select"
                      value={regimeOf(entity.code)}
                      onChange={(e) => setFractionnementEntityRegime(entity.code, e.target.value)}
                    >
                      <option value="NONE">Non concernée</option>
                      <option value="SYNTEC">Syntec 5.1 (jours ouvrés)</option>
                      <option value="LEGAL">Légal supplétif L3141-23 (jours ouvrables)</option>
                    </select>
                    <span className="rh-badge rh-badge--neutral">{regimeOf(entity.code) === 'NONE' ? 'Non concernée' : regimeOf(entity.code)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rh-panel__foot">
            <button type="button" onClick={saveFractionnement} disabled={busy} className="rh-btn rh-btn--primary">Enregistrer</button>
            <button type="button" onClick={runFractionnementPreview} disabled={busy} className="rh-btn">Prévisualiser</button>
            <button type="button" onClick={runFractionnementApply} disabled={busy} className="rh-btn rh-btn--accent">Attribuer le fractionnement</button>
            <button type="button" onClick={runFractionnementRecompute} disabled={busy} className="rh-btn">Recalculer</button>
          </div>

          {fractionnementPreview && (
            <div className="rh-panel__body" style={{ borderTop: '1px solid #e9f0f8' }}>
              <div className="rh-table-scroll">
                <table className="rh-table">
                  <thead>
                    <tr><th>Collaborateur</th><th>Entité</th><th>Régime</th><th>Jours hors période</th><th>5e semaine exclue</th><th>Bonus</th><th>Déjà attribué</th></tr>
                  </thead>
                  <tbody>
                    {fractionnementPreview.map((item) => (
                      <tr key={item.employeeId}>
                        <td>{item.nom} {item.prenom}</td>
                        <td>{item.legalEntityCode ?? '—'}</td>
                        <td>{item.regime}</td>
                        <td>{item.outsidePeriodDays}</td>
                        <td>{item.fifthWeekDays}</td>
                        <td>{item.applicable ? `+${item.bonusDays}` : '—'}</td>
                        <td>{item.currentAllocated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'prise' && (
        <section className="rh-panel">
          <div className="rh-panel__head">
            <span className="rh-panel__icon rh-panel__icon--green"><Icon name="clock" size={21} /></span>
            <div>
              <div className="rh-panel__title-row">
                <h2 className="rh-panel__title">Période de prise des congés (13 mois)</h2>
                <StatisticInfoButton title="Comprendre la période de prise des congés" wide>
                  <p>La période de prise correspond à l’intervalle pendant lequel les collaborateurs peuvent utiliser leurs congés acquis.</p>
                  <p>Dans cette application, cette rubrique permet à la RH de suivre la période de 13 mois configurée, de consulter les dates importantes et de repérer les congés qui n’ont pas encore été pris.</p>
                  <p>Elle facilite le suivi des échéances et des situations nécessitant une vérification, notamment lorsque des congés restent à prendre ou peuvent faire l’objet d’un report.</p>
                  <p>Les règles de report dépendent de la situation du salarié et des dispositions applicables.</p>
                </StatisticInfoButton>
              </div>
            </div>
          </div>

          <div className="rh-panel__body">
            <div className="rh-actions">
              <button type="button" onClick={runTakePeriod} disabled={busy} className="rh-btn rh-btn--primary">Consulter la période de prise</button>
            </div>

            {takePeriod && (
              <>
                <div className="rh-ed-summary">
                  <div className="rh-ed-summary__item"><span>Début</span><strong>{takePeriod.takePeriod.start}</strong></div>
                  <div className="rh-ed-summary__item"><span>Fin</span><strong>{takePeriod.takePeriod.end}</strong></div>
                  <div className="rh-ed-summary__item"><span>Statut</span><strong>{takePeriod.status.status} ({takePeriod.status.daysUntilEnd >= 0 ? 'J-' : 'J+'}{Math.abs(takePeriod.status.daysUntilEnd)})</strong></div>
                </div>

                <div className="rh-table-scroll">
                  <table className="rh-table">
                    <thead>
                      <tr><th>Collaborateur</th><th>Entité</th><th>Jours restants</th><th>Échéance effective</th><th>Statut</th></tr>
                    </thead>
                    <tbody>
                      {takePeriod.employees.length === 0 && (
                        <tr><td colSpan="5">Aucun solde non pris sur cette période.</td></tr>
                      )}
                      {takePeriod.employees.map((item) => (
                        <tr key={item.employeeId}>
                          <td>{item.nom} {item.prenom}{item.hasReport ? (item.reportProofStatus === 'VALIDE' ? ' (reporté — preuve validée)' : ' (reporté — en attente de preuve)') : ''}</td>
                          <td>{item.legalEntityCode ?? '—'}</td>
                          <td>{item.remainingDays}</td>
                          <td>{item.effectiveDeadline}</td>
                          <td>{item.status.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rh-ed-subform">
                  <h3>Enregistrer un report (demande écrite de l’employeur)</h3>
                  <div className="rh-grid-2">
                    <label className="rh-field">
                      <span className="rh-field__label">Collaborateur</span>
                      <select className="rh-select" value={reportForm.employeeId} onChange={(e) => setReportForm((c) => ({ ...c, employeeId: e.target.value }))}>
                        <option value="">—</option>
                        {takePeriod.employees.map((item) => (
                          <option key={item.employeeId} value={item.employeeId}>{item.nom} {item.prenom}</option>
                        ))}
                      </select>
                    </label>
                    <label className="rh-field">
                      <span className="rh-field__label">Nouvelle échéance</span>
                      <input className="rh-input" type="date" value={reportForm.newDeadline} onChange={(e) => setReportForm((c) => ({ ...c, newDeadline: e.target.value }))} />
                    </label>
                    <label className="rh-field">
                      <span className="rh-field__label">Justificatif (preuve écrite conservée)</span>
                      <select className="rh-select" value={reportForm.documentId} onChange={(e) => setReportForm((c) => ({ ...c, documentId: e.target.value }))}>
                        <option value="">— Aucun (report en attente de preuve) —</option>
                        {reportDocuments.map((doc) => (
                          <option key={doc.id} value={doc.id}>{doc.originalName ?? `Document ${doc.id}`} ({doc.status})</option>
                        ))}
                      </select>
                    </label>
                    <label className="rh-field">
                      <span className="rh-field__label">Ou joindre un nouveau justificatif</span>
                      <input className="rh-input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleReportFile} disabled={uploading} />
                    </label>
                  </div>
                  <label className="rh-field">
                    <span className="rh-field__label">Justification</span>
                    <textarea className="rh-textarea" rows="2" maxLength={1000} value={reportForm.justification} placeholder="Demande écrite de l’employeur…" onChange={(e) => setReportForm((c) => ({ ...c, justification: e.target.value }))} />
                  </label>
                  <div>
                    <button type="button" onClick={submitReport} disabled={busy} className="rh-btn rh-btn--primary">Enregistrer le report</button>
                  </div>
                </div>

                {takePeriodReports.length > 0 && (
                  <div className="rh-table-scroll">
                    <table className="rh-table">
                      <thead>
                        <tr><th>Collaborateur</th><th>Justification</th><th>Preuve</th><th>Nouvelle échéance</th><th>Auteur</th></tr>
                      </thead>
                      <tbody>
                        {takePeriodReports.map((report) => (
                          <tr key={report.id}>
                            <td>{report.employee?.nom} {report.employee?.prenom}</td>
                            <td>{report.justification}</td>
                            <td>{report.proofStatus === 'VALIDE' ? (report.document?.originalName ?? `Document ${report.documentId}`) : 'En attente de preuve'}</td>
                            <td>{report.newDeadline?.slice(0, 10)}</td>
                            <td>{report.requestedBy?.nom} {report.requestedBy?.prenom}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {activeTab === 'arrete' && (
        <section className="rh-panel">
          <div className="rh-panel__head">
            <span className="rh-panel__icon rh-panel__icon--red"><Icon name="shield" size={21} /></span>
            <div>
              <div className="rh-panel__title-row">
                <h2 className="rh-panel__title">Interaction arrêt maladie / congés posés</h2>
                <StatisticInfoButton title="Que se passe-t-il lorsqu’un arrêt maladie chevauche des congés ?" wide>
                  <p>Lorsqu’un salarié est en arrêt maladie pendant une période de congés payés déjà posée, les jours concernés peuvent devoir lui être restitués selon les règles applicables.</p>
                  <p>Cette rubrique permet à la RH d’identifier les périodes qui se chevauchent, de consulter les jours concernés et de vérifier les restitutions à effectuer.</p>
                  <p>La RH peut prévisualiser les conséquences avant toute opération. Le traitement automatique dépend des paramètres activés dans l’application.</p>
                </StatisticInfoButton>
              </div>
            </div>
          </div>

          <div className="rh-panel__body">
            <label className="rh-switch">
              <input type="checkbox" checked={jur28.enabled} onChange={(e) => setJur28((c) => ({ ...c, enabled: e.target.checked }))} />
              <span className="rh-switch__track" />
              <span className="rh-switch__label">Activer la restitution automatique</span>
              <span className="rh-switch__state">{jur28.enabled ? 'Activée' : 'Désactivée'}</span>
            </label>

            <div className="rh-field">
              <span className="rh-field__label">Classification métier des types d’absence</span>
              {absenceTypes.length === 0 && <p className="rh-note"><Icon name="info" size={15} />Aucun type d’absence déclaratif actif.</p>}
              {absenceTypes.length > 0 && (
                <div className="rh-ed-entity-list">
                  {absenceTypes.map((type) => (
                    <div key={type.id} className="rh-ed-kind-row">
                      <span className="rh-ed-kind-row__name">{type.name}</span>
                      <select className="rh-select" value={type.absenceKind ?? 'NON_CLASSIFIE'} onChange={(e) => setAbsenceTypes((list) => list.map((t) => (t.id === type.id ? { ...t, absenceKind: e.target.value } : t)))}>
                        <option value="NON_CLASSIFIE">Non classifié</option>
                        <option value="NON_MEDICAL">Absence non médicale</option>
                        <option value="ARRET_MALADIE">Arrêt maladie (salarié)</option>
                        <option value="ENFANT_MALADE">Enfant malade</option>
                        <option value="AT_MP">AT / MP</option>
                      </select>
                      <button type="button" onClick={() => saveAbsenceKind(type, type.absenceKind ?? 'NON_CLASSIFIE')} disabled={busy} className="rh-btn rh-btn--sm">Classer</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rh-panel__foot">
            <button type="button" onClick={saveJur28} disabled={busy} className="rh-btn rh-btn--primary">Enregistrer la configuration</button>
            <label className="rh-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <span className="rh-field__label">Déclaration d’absence n°</span>
              <input className="rh-input" style={{ width: 120, minHeight: 38 }} type="number" min="1" value={jur28.absenceId} onChange={(e) => setJur28((c) => ({ ...c, absenceId: e.target.value }))} />
            </label>
            <button type="button" onClick={runJur28Preview} disabled={busy} className="rh-btn">Prévisualiser</button>
            <button type="button" onClick={runJur28Restore} disabled={busy} className="rh-btn rh-btn--accent">Restaurer</button>
            <button type="button" onClick={runJur28Reverse} disabled={busy} className="rh-btn">Inverser</button>
          </div>

          {jur28.preview && (
            <div className="rh-panel__body" style={{ borderTop: '1px solid #e9f0f8' }}>
              <div className="rh-ed-summary">
                <div className="rh-ed-summary__item"><span>Automatisation</span><strong>{jur28.preview.enabled ? 'activée' : 'désactivée'}</strong></div>
                <div className="rh-ed-summary__item"><span>Type maladie</span><strong>{jur28.preview.maladieType ? 'oui' : 'non'}</strong></div>
                <div className="rh-ed-summary__item"><span>Jours à restituer</span><strong>{jur28.preview.restoredDays}</strong></div>
              </div>
              {jur28.preview?.overlaps?.length > 0 && (
                <div className="rh-table-scroll">
                  <table className="rh-table">
                    <thead>
                      <tr><th>Congé</th><th>Période</th><th>Jours chevauchés</th><th>État</th></tr>
                    </thead>
                    <tbody>
                      {jur28.preview.overlaps.map((item) => (
                        <tr key={item.leaveRequestId}>
                          <td>#{item.leaveRequestId}</td>
                          <td>{item.startDate} → {item.endDate}</td>
                          <td>{item.overlapDays}</td>
                          <td>{item.alreadyRestored ? 'Restitué' : item.uncertain ? 'Incertain (vérification RH)' : item.reason ?? 'À restituer'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {activeTab === 'convention' && (
        <section className="rh-panel">
          <div className="rh-panel__head">
            <span className="rh-panel__icon rh-panel__icon--violet"><Icon name="building" size={21} /></span>
            <div>
              <div className="rh-panel__title-row">
                <h2 className="rh-panel__title">Convention collective par entité juridique</h2>
                <StatisticInfoButton title="À quoi sert la convention collective par entité ?" wide>
                  <p>Une entreprise peut regrouper plusieurs entités juridiques qui ne sont pas nécessairement soumises aux mêmes dispositions collectives.</p>
                  <p>Cette rubrique permet à la RH de renseigner la convention collective applicable à chaque entité, par exemple Syntec, ainsi que l’existence éventuelle d’un accord d’entreprise.</p>
                  <p>Ces informations permettent de mieux paramétrer les droits des collaborateurs en fonction de leur entité.</p>
                  <p>Un accord d’entreprise et une convention collective peuvent coexister. Leur application doit respecter les règles juridiques en vigueur.</p>
                </StatisticInfoButton>
              </div>
            </div>
          </div>

          <div className="rh-panel__body">
            <div className="rh-ed-entity-list">
              {entities.map((entity) => {
                const config = jur24[entity.id] ?? { conventionType: 'NON_RENSEIGNEE', idcc: '', conventionName: '', accordType: 'NONE', accordName: '', accordIdcc: '' }
                return (
                  <div key={entity.id} className="rh-ed-convention">
                    <div className="rh-ed-convention__top">
                      <span className="rh-ed-entity-row__name">{entity.name}</span>
                      <select
                        className="rh-select"
                        value={config.conventionType}
                        onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, conventionType: e.target.value } }))}
                      >
                        <option value="NON_RENSEIGNEE">Branche non renseignée</option>
                        <option value="LEGAL">Légal supplétif (confirmé)</option>
                        <option value="SYNTEC">Syntec (IDCC 1486)</option>
                      </select>
                      {config.conventionType === 'SYNTEC' && (
                        <input className="rh-input" type="text" maxLength={20} placeholder="IDCC (ex. 1486)" value={config.idcc} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, idcc: e.target.value } }))} />
                      )}
                      <button type="button" onClick={() => saveJur24Entity(entity)} disabled={busy} className="rh-btn rh-btn--sm rh-btn--primary">Enregistrer</button>
                    </div>

                    <label className="rh-switch">
                      <input type="checkbox" checked={config.accordType === 'ACCORD_ENTREPRISE'} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, accordType: e.target.checked ? 'ACCORD_ENTREPRISE' : 'NONE' } }))} />
                      <span className="rh-switch__track" />
                      <span className="rh-switch__label">Accord d’entreprise</span>
                    </label>
                    {config.accordType === 'ACCORD_ENTREPRISE' && (
                      <input className="rh-input" type="text" maxLength={180} placeholder="Nom de l’accord" value={config.accordName} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, accordName: e.target.value } }))} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

    </main>
  )
}
