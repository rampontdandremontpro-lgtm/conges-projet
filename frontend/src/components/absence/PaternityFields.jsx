import { useEffect, useMemo, useState } from 'react'

import {
  createBirthEvent,
  getBirthEvents,
  getMyBirthEvents,
  previewPaternity,
} from '@/services/absenceDeclarations'

function fieldStyle() {
  return { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }
}

function inputStyle() {
  return { padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', width: '100%' }
}

function labelStyle() {
  return { fontSize: 13, fontWeight: 600, color: '#334155' }
}

function eventLabel(event) {
  const nb = Number(event?.nbEnfants)
  return `Naissance du ${event?.dateNaissance ?? '?'} — ${nb === 1 ? '1 enfant' : `${nb} enfants ou plus`}`
}

export function PaternityFields({
  type,
  employeeId,
  startDate,
  endDate,
  value,
  onChange,
}) {
  const isPaternity = type?.absenceKind === 'PATERNITE_ACCUEIL'
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newNb, setNewNb] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  const context = useMemo(() => ({ ...value }), [value])

  const update = (patch) => onChange({ ...context, ...patch })

  const selectedEventId = context.naissanceId || ''

  useEffect(() => {
    if (!isPaternity) return undefined
    let cancelled = false
    setEventsLoading(true)
    const request = employeeId ? getBirthEvents(employeeId) : getMyBirthEvents()
    request
      .then((data) => {
        if (!cancelled) setEvents(data ?? [])
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false)
      })
    return () => { cancelled = true }
  }, [isPaternity, employeeId])

  const periode = context.periode === 'SECONDE' ? 'SECONDE' : 'PREMIERE'

  useEffect(() => {
    if (!isPaternity || !type?.id || !startDate || !endDate) {
      setPreview(null)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    const payload = {
      leaveTypeId: type.id,
      startDate,
      endDate,
      familyEventContext: {
        naissanceId: context.naissanceId || undefined,
        dateNaissance: context.dateNaissance || undefined,
        nbEnfants: context.nbEnfants !== undefined && context.nbEnfants !== '' ? Number(context.nbEnfants) : undefined,
        periode,
        prevenanceDate: context.prevenanceDate || undefined,
        hospitalisationEnfant: context.hospitalisationEnfant === true,
        decesMere: context.decesMere === true,
        naissancePrematuree: context.naissancePrematuree === true,
      },
    }
    if (employeeId) payload.employeeId = Number(employeeId)

    previewPaternity(payload)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isPaternity, type?.id, employeeId, startDate, endDate, context.naissanceId, context.dateNaissance, context.nbEnfants, periode, context.prevenanceDate, context.hospitalisationEnfant, context.decesMere, context.naissancePrematuree])

  if (!isPaternity) return null

  const rule = preview?.rule
  const requestedDays = preview?.requestedDays
  const quota = preview?.quota
  const errors = preview?.errors ?? []

  const handleSelectEvent = (id) => {
    if (id === 'NEW') {
      update({ naissanceId: undefined, dateNaissance: undefined, nbEnfants: undefined })
      return
    }
    const event = events.find((item) => item.id === id)
    if (event) {
      update({ naissanceId: event.id, dateNaissance: event.dateNaissance, nbEnfants: event.nbEnfants })
    }
  }

  const handleCreate = async () => {
    setCreateError('')
    if (!newDate || !newNb) {
      setCreateError('Indiquez une date de naissance et un nombre d’enfants.')
      return
    }
    setCreating(true)
    try {
      const created = await createBirthEvent(
        { dateNaissance: newDate, nbEnfants: Number(newNb) },
        employeeId ? Number(employeeId) : undefined,
      )
      setEvents((current) => [...current, created])
      update({ naissanceId: created.id, dateNaissance: created.dateNaissance, nbEnfants: created.nbEnfants })
      setNewDate('')
      setNewNb('')
    } catch (error) {
      const msg = error?.response?.data?.message
      setCreateError(Array.isArray(msg) ? msg.join(' ') : msg || 'Impossible de créer la naissance.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="nr-cal-card">
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Congé de paternité et d’accueil de l’enfant</span>
      </div>

      <div style={fieldStyle()}>
        <label style={labelStyle()}>Naissance concernée</label>
        <select
          value={selectedEventId || 'NEW'}
          onChange={(event) => handleSelectEvent(event.target.value)}
          style={inputStyle()}
        >
          <option value="NEW">+ Nouvelle naissance</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>{eventLabel(event)}</option>
          ))}
        </select>
        {eventsLoading && <small style={{ color: '#64748b' }}>Chargement des naissances…</small>}
        {!selectedEventId && (
          <small style={{ color: '#64748b' }}>
            Une naissance existante est réutilisée pour toutes les périodes ; elle ne peut être modifiée que par une correction RH justifiée.
          </small>
        )}
      </div>

      {!selectedEventId && (
        <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', marginTop: 8 }}>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Date de naissance (prévue ou effective)</label>
            <input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} style={inputStyle()} />
          </div>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Nombre d’enfants à naître</label>
            <select value={newNb} onChange={(event) => setNewNb(event.target.value)} style={inputStyle()}>
              <option value="">Sélectionner…</option>
              <option value="1">1 enfant (25 jours calendaires)</option>
              <option value="2">2 enfants ou plus (32 jours calendaires)</option>
            </select>
          </div>
          <button type="button" onClick={handleCreate} disabled={creating} style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, border: '1px solid #0f172a', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>
            {creating ? 'Création…' : 'Créer la naissance'}
          </button>
          {createError && <p style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{createError}</p>}
        </div>
      )}

      <div style={fieldStyle()}>
        <label style={labelStyle()}>Période</label>
        <select value={periode} onChange={(event) => update({ periode: event.target.value })} style={inputStyle()}>
          <option value="PREMIERE">Première période (4 jours calendaires consécutifs)</option>
          <option value="SECONDE">Seconde période (21 ou 28 jours, fractionnable)</option>
        </select>
      </div>

      {periode === 'SECONDE' && (
        <>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Date d’information de l’employeur (prévenance 1 mois)</label>
            <input type="date" value={context.prevenanceDate || ''} onChange={(event) => update({ prevenanceDate: event.target.value })} style={inputStyle()} />
          </div>
          <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={context.hospitalisationEnfant === true} onChange={(event) => update({ hospitalisationEnfant: event.target.checked })} />
            Hospitalisation de l’enfant
          </label>
          <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={context.decesMere === true} onChange={(event) => update({ decesMere: event.target.checked })} />
            Décès de la mère
          </label>
          <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={context.naissancePrematuree === true} onChange={(event) => update({ naissancePrematuree: event.target.checked })} />
            Naissance prématurée
          </label>
        </>
      )}

      {loading && <p style={{ color: '#64748b', fontSize: 13, marginTop: 12 }}>Calcul du droit en cours…</p>}

      {!loading && rule && (
        <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#334155' }}>
              <strong>{rule.totalDays} jours calendaires</strong> au total
            </span>
            <span style={{ fontSize: 13, color: '#334155' }}>
              Période demandée : <strong>{requestedDays ?? '—'} jours calendaires</strong>
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>{rule.fractionnement}</p>
          {rule.anomalies?.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#b45309', fontSize: 12 }}>
              {rule.anomalies.map((anomaly, index) => <li key={index}>{anomaly}</li>)}
            </ul>
          )}
          {errors?.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#b91c1c', fontSize: 12 }}>
              {errors.map((err, index) => <li key={index}>{err}</li>)}
            </ul>
          )}
          {quota && (
            <p style={{ fontSize: 12, color: '#334155', marginTop: 6 }}>
              Événement : {quota.alreadyUsedDays} j déjà utilisé(s), {quota.remainingDays} j restant(s)
              {quota.exceeded ? ' — dépassement.' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
