import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
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
    const timer = window.setTimeout(() => setFeedback(null), 5000)
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
      setFeedback({ kind: 'success', message: 'Configuration ancienneté enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement ancienneté.' })
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
      setFeedback({ kind: 'success', message: 'Configuration fractionnement enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement fractionnement.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation ancienneté.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’attribution ancienneté.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation fractionnement.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’attribution fractionnement.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec du recalcul fractionnement.' })
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
      setFeedback({ kind: 'success', message: 'Configuration JUR-028 enregistrée.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’enregistrement JUR-028.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la prévisualisation JUR-028.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de la restitution JUR-028.' })
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
      setFeedback({ kind: 'error', message: error?.response?.data?.message ?? 'Échec de l’inversion JUR-028.' })
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
    return <main className="page-container rh-extra-days-page"><div className="rh-extra-days-loading">Chargement…</div></main>
  }

  if (state.error) {
    return (
      <main className="page-container rh-extra-days-page">
        <section className="rh-extra-days-state">
          <Icon name="alert" size={24} />
          <strong>Impossible de charger les droits supplémentaires</strong>
          <span>{state.error}</span>
          <button type="button" onClick={load}>Réessayer</button>
        </section>
      </main>
    )
  }

  return (
    <main className="page-container rh-extra-days-page">
      {feedback && (
        <div className={`rh-extra-days-feedback rh-extra-days-feedback--${feedback.kind}`}>
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="rh-extra-days-toolbar">
        <label>
          <span>Période de référence</span>
          <input type="text" value={period} onChange={(e) => setPeriod(e.target.value)} pattern="\d{4}-\d{4}" />
        </label>
      </div>

      <section className="rh-extra-days-card">
        <div className="rh-extra-days-header">
          <span className="rh-extra-days-header__icon"><Icon name="sparkles" size={20} /></span>
          <div>
            <small>JUR-019 / JUR-020</small>
            <h2>Congés d’ancienneté (Syntec 5.1)</h2>
            <p>Attribution automatique idempotente, conditionnée à la configuration RH par entité.</p>
          </div>
        </div>

        <div className="rh-extra-days-form">
          <label className="rh-extra-days-toggle">
            <input type="checkbox" checked={seniority.enabled} onChange={(e) => setSeniority((c) => ({ ...c, enabled: e.target.checked }))} />
            <span>Activer l’attribution automatique</span>
          </label>

          <label className="rh-extra-days-field">
            <span>Date d’appréciation (ouverture de la période de prise)</span>
            <input
              type="date"
              value={monthDayToInput(seniority.referenceMonthDay, year)}
              onChange={(e) => setSeniority((c) => ({ ...c, referenceMonthDay: inputToMonthDay(e.target.value) }))}
            />
          </label>

          <div className="rh-extra-days-field">
            <span>Entités concernées</span>
            <div className="rh-extra-days-entities">
              {entities.map((entity) => (
                <label key={entity.code} className="rh-extra-days-entity">
                  <input
                    type="checkbox"
                    checked={seniority.legalEntityCodes.includes(entity.code)}
                    onChange={() => toggleSeniorityEntity(entity.code)}
                  />
                  <span>{entity.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rh-extra-days-field">
            <span>Paliers (jours totaux, non cumulatifs)</span>
            {seniority.thresholds.map((threshold, index) => (
              <div key={index} className="rh-extra-days-threshold">
                <span>à partir de</span>
                <input
                  type="number"
                  min="0"
                  value={threshold.minYears}
                  onChange={(e) => setSeniority((c) => ({
                    ...c,
                    thresholds: c.thresholds.map((t, i) => i === index ? { ...t, minYears: Number(e.target.value) } : t),
                  }))}
                />
                <span>ans → +</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={threshold.extraDays}
                  onChange={(e) => setSeniority((c) => ({
                    ...c,
                    thresholds: c.thresholds.map((t, i) => i === index ? { ...t, extraDays: Number(e.target.value) } : t),
                  }))}
                />
                <span>jour(s) ouvré(s)</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rh-extra-days-actions">
          <button type="button" onClick={saveSeniority} disabled={busy} className="rh-extra-days-save">Enregistrer</button>
          <button type="button" onClick={runSeniorityPreview} disabled={busy} className="rh-extra-days-secondary">Prévisualiser</button>
          <button type="button" onClick={runSeniorityApply} disabled={busy || !seniority.enabled} className="rh-extra-days-primary">Attribuer les jours d’ancienneté</button>
        </div>

        {seniorityPreview && (
          <table className="rh-extra-days-table">
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
        )}
      </section>

      <section className="rh-extra-days-card">
        <div className="rh-extra-days-header">
          <span className="rh-extra-days-header__icon rh-extra-days-header__icon--orange"><Icon name="calendar" size={20} /></span>
          <div>
            <small>JUR-021 / JUR-022</small>
            <h2>Fractionnement des congés payés</h2>
            <p>Calcul automatique sur les congés réellement pris hors période (Syntec jours ouvrés / légal jours ouvrables).</p>
          </div>
        </div>

        <div className="rh-extra-days-form">
          <div className="rh-extra-days-row">
            <label className="rh-extra-days-field">
              <span>Période légale — début</span>
              <input
                type="date"
                value={monthDayToInput(fractionnement.eligiblePeriodStart, year)}
                onChange={(e) => setFractionnement((c) => ({ ...c, eligiblePeriodStart: inputToMonthDay(e.target.value) }))}
              />
            </label>
            <label className="rh-extra-days-field">
              <span>Période légale — fin</span>
              <input
                type="date"
                value={monthDayToInput(fractionnement.eligiblePeriodEnd, year)}
                onChange={(e) => setFractionnement((c) => ({ ...c, eligiblePeriodEnd: inputToMonthDay(e.target.value) }))}
              />
            </label>
          </div>

          <div className="rh-extra-days-field">
            <span>Régime par entité (aucun cumul entre régimes)</span>
            {entities.map((entity) => (
              <div key={entity.code} className="rh-extra-days-regime">
                <span>{entity.name}</span>
                <select
                  value={regimeOf(entity.code)}
                  onChange={(e) => setFractionnementEntityRegime(entity.code, e.target.value)}
                >
                  <option value="NONE">Non concernée</option>
                  <option value="SYNTEC">Syntec 5.1 (jours ouvrés)</option>
                  <option value="LEGAL">Légal supplétif L3141-23 (jours ouvrables)</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="rh-extra-days-actions">
          <button type="button" onClick={saveFractionnement} disabled={busy} className="rh-extra-days-save">Enregistrer</button>
          <button type="button" onClick={runFractionnementPreview} disabled={busy} className="rh-extra-days-secondary">Prévisualiser</button>
          <button type="button" onClick={runFractionnementApply} disabled={busy} className="rh-extra-days-primary">Attribuer le fractionnement</button>
          <button type="button" onClick={runFractionnementRecompute} disabled={busy} className="rh-extra-days-secondary">Recalculer</button>
        </div>

        {fractionnementPreview && (
          <table className="rh-extra-days-table">
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
        )}
      </section>

      <section className="rh-extra-days-card">
        <div className="rh-extra-days-header">
          <span className="rh-extra-days-header__icon rh-extra-days-header__icon--green"><Icon name="clock" size={20} /></span>
          <div>
            <small>JUR-023</small>
            <h2>Période de prise des congés (13 mois)</h2>
            <p>Fenêtre de prise configurable (1er mai par défaut) et alerte sur les soldes non pris à l’échéance.</p>
          </div>
        </div>

        <div className="rh-extra-days-actions">
          <button type="button" onClick={runTakePeriod} disabled={busy} className="rh-extra-days-secondary">Consulter la période de prise</button>
        </div>

        {takePeriod && (
          <>
            <div className="rh-extra-days-takeperiod">
              <span><b>Début</b> {takePeriod.takePeriod.start}</span>
              <span><b>Fin</b> {takePeriod.takePeriod.end}</span>
              <span><b>Statut</b> {takePeriod.status.status} ({takePeriod.status.daysUntilEnd >= 0 ? 'J-' : 'J+'}{Math.abs(takePeriod.status.daysUntilEnd)})</span>
            </div>
            <table className="rh-extra-days-table">
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

            <div className="rh-extra-days-report-form">
              <h3>Enregistrer un report (demande écrite de l’employeur)</h3>
              <div className="rh-extra-days-row">
                <label className="rh-extra-days-field">
                  <span>Collaborateur</span>
                  <select value={reportForm.employeeId} onChange={(e) => setReportForm((c) => ({ ...c, employeeId: e.target.value }))}>
                    <option value="">—</option>
                    {takePeriod.employees.map((item) => (
                      <option key={item.employeeId} value={item.employeeId}>{item.nom} {item.prenom}</option>
                    ))}
                  </select>
                </label>
                <label className="rh-extra-days-field">
                  <span>Nouvelle échéance</span>
                  <input type="date" value={reportForm.newDeadline} onChange={(e) => setReportForm((c) => ({ ...c, newDeadline: e.target.value }))} />
                </label>
                <label className="rh-extra-days-field">
                  <span>Justificatif (preuve écrite conservée)</span>
                  <select value={reportForm.documentId} onChange={(e) => setReportForm((c) => ({ ...c, documentId: e.target.value }))}>
                    <option value="">— Aucun (report en attente de preuve) —</option>
                    {reportDocuments.map((doc) => (
                      <option key={doc.id} value={doc.id}>{doc.originalName ?? `Document ${doc.id}`} ({doc.status})</option>
                    ))}
                  </select>
                </label>
                <label className="rh-extra-days-field">
                  <span>Ou joindre un nouveau justificatif</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleReportFile} disabled={uploading} />
                </label>
              </div>
              <label className="rh-extra-days-field">
                <span>Justification</span>
                <textarea rows="2" maxLength={1000} value={reportForm.justification} placeholder="Demande écrite de l’employeur…" onChange={(e) => setReportForm((c) => ({ ...c, justification: e.target.value }))} />
              </label>
              <button type="button" onClick={submitReport} disabled={busy} className="rh-extra-days-save">Enregistrer le report</button>
            </div>

            {takePeriodReports.length > 0 && (
              <table className="rh-extra-days-table">
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
            )}
          </>
        )}
      </section>

      <section className="rh-extra-days-card">
        <div className="rh-extra-days-header">
          <span className="rh-extra-days-header__icon rh-extra-days-header__icon--red"><Icon name="shield" size={20} /></span>
          <div>
            <small>JUR-028</small>
            <h2>Interaction arrêt maladie / congés posés</h2>
            <p>Restitution automatique des jours de congé couverts par un arrêt maladie (configurable, désactivée par défaut).</p>
          </div>
        </div>

        <div className="rh-extra-days-form">
          <label className="rh-extra-days-toggle">
            <input type="checkbox" checked={jur28.enabled} onChange={(e) => setJur28((c) => ({ ...c, enabled: e.target.checked }))} />
            <span>Activer la restitution automatique</span>
          </label>

          <div className="rh-extra-days-field">
            <span>Classification métier des types d’absence (explicite, persistante)</span>
            {absenceTypes.length === 0 && <small className="rh-extra-days-hint">Aucun type d’absence déclaratif actif.</small>}
            {absenceTypes.map((type) => (
              <div key={type.id} className="rh-extra-days-jur24-row">
                <span className="rh-extra-days-jur24-name">{type.name}</span>
                <select value={type.absenceKind ?? 'NON_CLASSIFIE'} onChange={(e) => setAbsenceTypes((list) => list.map((t) => (t.id === type.id ? { ...t, absenceKind: e.target.value } : t)))}>
                  <option value="NON_CLASSIFIE">Non classifié</option>
                  <option value="NON_MEDICAL">Absence non médicale</option>
                  <option value="ARRET_MALADIE">Arrêt maladie (salarié)</option>
                  <option value="ENFANT_MALADE">Enfant malade</option>
                  <option value="AT_MP">AT / MP</option>
                </select>
                <button type="button" onClick={() => saveAbsenceKind(type, type.absenceKind ?? 'NON_CLASSIFIE')} disabled={busy} className="rh-extra-days-save">Classer</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rh-extra-days-actions">
          <button type="button" onClick={saveJur28} disabled={busy} className="rh-extra-days-save">Enregistrer la configuration</button>
          <label className="rh-extra-days-field rh-extra-days-inline">
            <span>Déclaration d’absence n°</span>
            <input type="number" min="1" value={jur28.absenceId} onChange={(e) => setJur28((c) => ({ ...c, absenceId: e.target.value }))} />
          </label>
          <button type="button" onClick={runJur28Preview} disabled={busy} className="rh-extra-days-secondary">Prévisualiser</button>
          <button type="button" onClick={runJur28Restore} disabled={busy} className="rh-extra-days-primary">Restaurer</button>
          <button type="button" onClick={runJur28Reverse} disabled={busy} className="rh-extra-days-secondary">Inverser</button>
        </div>

        {jur28.preview && (
          <div className="rh-extra-days-takeperiod">
            <span><b>Automatisation</b> {jur28.preview.enabled ? 'activée' : 'désactivée'}</span>
            <span><b>Type maladie</b> {jur28.preview.maladieType ? 'oui' : 'non'}</span>
            <span><b>Jours à restituer</b> {jur28.preview.restoredDays}</span>
          </div>
        )}
        {jur28.preview?.overlaps?.length > 0 && (
          <table className="rh-extra-days-table">
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
        )}
      </section>

      <section className="rh-extra-days-card">
        <div className="rh-extra-days-header">
          <span className="rh-extra-days-header__icon rh-extra-days-header__icon--blue"><Icon name="shield" size={20} /></span>
          <div>
            <small>JUR-024</small>
            <h2>Convention collective par entité juridique</h2>
            <p>Aucune convention n’est présumée : la RH identifie la convention de branche et, séparément, un éventuel accord d’entreprise (ils peuvent coexister).</p>
          </div>
        </div>

        <div className="rh-extra-days-form">
          {entities.map((entity) => {
            const config = jur24[entity.id] ?? { conventionType: 'NON_RENSEIGNEE', idcc: '', conventionName: '', accordType: 'NONE', accordName: '', accordIdcc: '' }
            return (
              <div key={entity.id} className="rh-extra-days-jur24-row">
                <span className="rh-extra-days-jur24-name">{entity.name}</span>
                <select
                  value={config.conventionType}
                  onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, conventionType: e.target.value } }))}
                >
                  <option value="NON_RENSEIGNEE">Branche non renseignée</option>
                  <option value="LEGAL">Légal supplétif (confirmé)</option>
                  <option value="SYNTEC">Syntec (IDCC 1486)</option>
                </select>
                {config.conventionType === 'SYNTEC' && (
                  <input type="text" maxLength={20} placeholder="IDCC (ex. 1486)" value={config.idcc} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, idcc: e.target.value } }))} />
                )}
                <label className="rh-extra-days-jur24-accord">
                  <input type="checkbox" checked={config.accordType === 'ACCORD_ENTREPRISE'} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, accordType: e.target.checked ? 'ACCORD_ENTREPRISE' : 'NONE' } }))} />
                  <span>Accord d’entreprise</span>
                </label>
                {config.accordType === 'ACCORD_ENTREPRISE' && (
                  <input type="text" maxLength={180} placeholder="Nom de l’accord" value={config.accordName} onChange={(e) => setJur24((c) => ({ ...c, [entity.id]: { ...config, accordName: e.target.value } }))} />
                )}
                <button type="button" onClick={() => saveJur24Entity(entity)} disabled={busy} className="rh-extra-days-save">Enregistrer</button>
              </div>
            )
          })}
        </div>
        <p className="rh-extra-days-note">
          <Icon name="info" size={15} />
          Un accord d’entreprise ne remplace pas la convention de branche : il est enregistré séparément et n’est appliqué que s’il est renseigné et validé. La comparaison « disposition la plus favorable » reste une analyse RH/juridique.
        </p>
      </section>

      <p className="rh-extra-days-note">
        <Icon name="info" size={15} />
        Les droits sont inscrits dans les compteurs de la période (mouvements dédiés et audités). Aucune attribution n’a lieu pour une entité non configurée. Une demande non classifiée n’est jamais comptée pour le fractionnement.
      </p>
    </main>
  )
}
