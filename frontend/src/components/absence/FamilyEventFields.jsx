import { useEffect, useMemo, useState } from 'react'

import { previewFamilyEvent } from '@/services/absenceDeclarations'

const FAMILY_KINDS = new Set([
  'MARIAGE_PACS',
  'MARIAGE_ENFANT',
  'NAISSANCE',
  'ADOPTION',
  'DECES',
  'DECES_ENFANT',
  'DEUIL_ENFANT',
  'ANNONCE_HANDICAP_ENFANT',
  'ENFANT_MALADE',
])

const LIEN_OPTIONS = [
  { value: 'CONJOINT', label: 'Conjoint / partenaire / concubin' },
  { value: 'PARENT', label: 'Père / mère' },
  { value: 'FRERE_SOEUR', label: 'Frère / sœur' },
  { value: 'BEAU_PARENT', label: 'Beau-père / belle-mère' },
  { value: 'AUTRE_ASCENDANT', label: 'Autre ascendant (grand-parent)' },
  { value: 'ENFANT', label: 'Enfant' },
  { value: 'AUTRE', label: 'Autre proche' },
]

function unitLabel(unit) {
  if (unit === 'OUVRES') return 'jours ouvrés'
  if (unit === 'OUVRABLES') return 'jours ouvrables'
  return unit ?? 'jours'
}

function sourceLabel(source) {
  if (source === 'CODE_TRAVAIL') return 'Code du travail'
  if (source === 'CONVENTION_COLLECTIVE') return 'Convention collective'
  return source ?? '—'
}

function fieldStyle() {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 12,
  }
}

function inputStyle() {
  return {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    width: '100%',
  }
}

function labelStyle() {
  return { fontSize: 13, fontWeight: 600, color: '#334155' }
}

export function FamilyEventFields({
  type,
  employeeId,
  startDate,
  endDate,
  value,
  onChange,
}) {
  const kind = type?.absenceKind
  const isFamily = FAMILY_KINDS.has(kind)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  const context = useMemo(() => {
    const base = {
      eventDate: value?.eventDate ?? startDate ?? '',
      ...value,
    }
    return base
  }, [startDate, value])

  const update = (patch) => {
    onChange({ ...context, ...patch })
  }

  useEffect(() => {
    if (!isFamily || !type?.id || !startDate || !endDate) {
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
        eventDate: context.eventDate || startDate,
        lien: context.lien || undefined,
        enfantAge: context.enfantAge !== undefined && context.enfantAge !== '' ? Number(context.enfantAge) : undefined,
        nbEnfantsCharge: context.nbEnfantsCharge !== undefined && context.nbEnfantsCharge !== '' ? Number(context.nbEnfantsCharge) : undefined,
        enfantEstParent: context.enfantEstParent === true,
        personneChargeMoins25: context.personneChargeMoins25 === true,
        natureAnnonce: context.natureAnnonce || undefined,
      },
    }
    if (employeeId) payload.employeeId = Number(employeeId)

    previewFamilyEvent(payload)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isFamily, type?.id, employeeId, startDate, endDate, context.eventDate, context.lien, context.enfantAge, context.nbEnfantsCharge, context.enfantEstParent, context.personneChargeMoins25, context.natureAnnonce])

  if (!isFamily) return null

  const rule = preview?.rule
  const requestedDays = preview?.requestedDays
  const quota = preview?.quota

  return (
    <section className="nr-cal-card">
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Événement familial</span>
      </div>

      <div style={fieldStyle()}>
        <label style={labelStyle()}>Date de l’événement</label>
        <input
          type="date"
          value={context.eventDate || ''}
          onChange={(event) => update({ eventDate: event.target.value })}
          style={inputStyle()}
        />
        <small style={{ color: '#64748b' }}>
          La date de l’événement peut différer du début de l’absence.
        </small>
      </div>

      {kind === 'DECES' && (
        <div style={fieldStyle()}>
          <label style={labelStyle()}>Lien familial</label>
          <select
            value={context.lien || 'AUTRE'}
            onChange={(event) => update({ lien: event.target.value })}
            style={inputStyle()}
          >
            {LIEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}

      {kind === 'ANNONCE_HANDICAP_ENFANT' && (
        <div style={fieldStyle()}>
          <label style={labelStyle()}>Nature de l’annonce</label>
          <select
            value={context.natureAnnonce || 'HANDICAP'}
            onChange={(event) => update({ natureAnnonce: event.target.value })}
            style={inputStyle()}
          >
            <option value="HANDICAP">Handicap</option>
            <option value="PATHOLOGIE_CHRONIQUE">Pathologie chronique concernée</option>
            <option value="CANCER">Cancer</option>
          </select>
        </div>
      )}

      {kind === 'DECES_ENFANT' && (
        <>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Âge de l’enfant (au jour du décès)</label>
            <input
              type="number"
              min="0"
              value={context.enfantAge ?? ''}
              onChange={(event) => update({ enfantAge: event.target.value === '' ? undefined : Number(event.target.value) })}
              style={inputStyle()}
            />
          </div>
          <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={context.enfantEstParent === true}
              onChange={(event) => update({ enfantEstParent: event.target.checked })}
            />
            Enfant de 25 ans ou plus, lui-même parent
          </label>
          <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={context.personneChargeMoins25 === true}
              onChange={(event) => update({ personneChargeMoins25: event.target.checked })}
            />
            Personne de moins de 25 ans à charge effective et permanente
          </label>
        </>
      )}

      {kind === 'ENFANT_MALADE' && (
        <>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Âge de l’enfant</label>
            <input
              type="number"
              min="0"
              value={context.enfantAge ?? ''}
              onChange={(event) => update({ enfantAge: event.target.value === '' ? undefined : Number(event.target.value) })}
              style={inputStyle()}
            />
          </div>
          <div style={fieldStyle()}>
            <label style={labelStyle()}>Nombre d’enfants à charge de moins de 16 ans</label>
            <input
              type="number"
              min="0"
              value={context.nbEnfantsCharge ?? ''}
              onChange={(event) => update({ nbEnfantsCharge: event.target.value === '' ? undefined : Number(event.target.value) })}
              style={inputStyle()}
            />
          </div>
        </>
      )}

      {loading && (
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 12 }}>Calcul du droit en cours…</p>
      )}

      {!loading && rule && (
        <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#334155' }}>
              <strong>{rule.days} {unitLabel(rule.unit)}</strong>
              {' '}autorisés — {sourceLabel(rule.source)}
            </span>
            <span style={{ fontSize: 13, color: '#334155' }}>
              Demande : <strong>{requestedDays ?? '—'} {unitLabel(rule.unit)}</strong>
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>{rule.reference} — {rule.conditions}</p>
          {rule.requiredJustificatifs?.length > 0 && (
            <p style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
              Justificatifs : {rule.requiredJustificatifs.join(', ')}
            </p>
          )}
          {rule.paid === false && (
            <p style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>Absence non rémunérée (disposition légale).</p>
          )}
          {rule.anomalies?.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#b45309', fontSize: 12 }}>
              {rule.anomalies.map((anomaly, index) => <li key={index}>{anomaly}</li>)}
            </ul>
          )}
          {quota && (
            <p style={{ fontSize: 12, color: '#334155', marginTop: 6 }}>
              Quota {quota.kind} ({quota.periodKey}) : {quota.alreadyUsedDays} j déjà utilisé(s), {quota.remainingDays} j restant(s)
              {quota.exceeded ? ' — dépassement.' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
