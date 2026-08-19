import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { PageContainer } from '@/components/ui/PageContainer'
import { getAdminServicesData, updateAdminService } from '@/services/admin/adminServices'

import '@/styles/admin/minimum-presence.css'

function errorMessage(error) {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  return message || error?.message || 'Une erreur est survenue.'
}

function initialMinimum(service) {
  if (!service?.hasMinimumPresenceRule) return 0
  return Math.max(0, Number(service.minimumPresence ?? 0))
}

function serviceCount(users, serviceId) {
  return users.reduce(
    (counts, user) => {
      if (String(user.serviceId ?? '') !== String(serviceId)) return counts
      if (user.role === 'ADMIN') return counts
      counts.total += 1
      if (user.isActive) counts.active += 1
      return counts
    },
    { total: 0, active: 0 },
  )
}

export function AdminMinimumPresencePage() {
  const [state, setState] = useState({ loading: true, error: '', services: [], users: [] })
  const [values, setValues] = useState({})
  const [savedValues, setSavedValues] = useState({})
  const [filters, setFilters] = useState({ type: 'ALL', status: 'ALL' })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: '' }))
    }

    try {
      const data = await getAdminServicesData()
      const nextValues = Object.fromEntries(
        data.services.map((service) => [String(service.id), initialMinimum(service)]),
      )
      setState({ loading: false, error: '', services: data.services, users: data.users })
      setValues(nextValues)
      setSavedValues(nextValues)
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: errorMessage(error) }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!feedback || feedback.kind !== 'success') return undefined

    const timeoutId = window.setTimeout(() => {
      setFeedback(null)
    }, 4000)

    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  const countsByService = useMemo(() => {
    const map = new Map()
    for (const service of state.services) {
      map.set(String(service.id), serviceCount(state.users, service.id))
    }
    return map
  }, [state.services, state.users])

  const filteredServices = useMemo(() => {
    return state.services
      .filter((service) => filters.type === 'ALL' || service.serviceType === filters.type)
      .filter((service) => {
        if (filters.status === 'ALL') return true
        return filters.status === 'ACTIVE' ? service.isActive : !service.isActive
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  }, [state.services, filters])

  const changedServiceIds = useMemo(
    () => Object.keys(values).filter((id) => Number(values[id] ?? 0) !== Number(savedValues[id] ?? 0)),
    [values, savedValues],
  )

  const changedCount = changedServiceIds.length

  const setMinimum = (service, nextValue) => {
    const id = String(service.id)
    const counts = countsByService.get(id) ?? { active: 0, total: 0 }
    const currentValue = Number(values[id] ?? 0)
    const max = counts.active
    let safeValue = Math.max(0, Number(nextValue) || 0)

    if (safeValue > currentValue && safeValue > max) {
      safeValue = currentValue
    }

    setFeedback(null)
    setValues((current) => ({ ...current, [id]: safeValue }))
  }

  const resetFilters = () => {
    setFilters({ type: 'ALL', status: 'ALL' })
  }

  const resetChanges = () => {
    setFeedback(null)
    setValues(savedValues)
  }

  const saveChanges = async () => {
    if (!changedCount || saving) return

    setSaving(true)
    setFeedback(null)

    try {
      for (const id of changedServiceIds) {
        const minimum = Number(values[id] ?? 0)
        const counts = countsByService.get(String(id)) ?? { active: 0 }

        if (minimum > counts.active) {
          const service = state.services.find((item) => String(item.id) === String(id))
          throw new Error(`Le minimum de « ${service?.name ?? 'ce service'} » ne peut pas dépasser son effectif actif (${counts.active}).`)
        }

        await updateAdminService(Number(id), {
          hasMinimumPresenceRule: minimum > 0,
          minimumPresence: minimum,
        })
      }

      await load({ silent: true })
      setFeedback({ kind: 'success', message: `${changedCount} service${changedCount > 1 ? 's ont' : ' a'} été mis à jour.` })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer className="admin-minimum-page">
      {feedback && (
        <div className={`admin-minimum-feedback admin-minimum-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          {feedback.message}
        </div>
      )}

      <div className="admin-minimum-heading">
        <div>
          <p>{state.services.length} service{state.services.length > 1 ? 's' : ''} configuré{state.services.length > 1 ? 's' : ''}</p>
          <span>Définissez le nombre minimal de personnes devant rester disponibles dans chaque service.</span>
        </div>
      </div>

      <section className="admin-minimum-filters" aria-label="Filtres présence minimale">
        <div className="admin-minimum-filter-group">
          <span>TYPE</span>
          <div className="admin-minimum-view-switch" role="group" aria-label="Filtrer par type de service">
            <button
              type="button"
              className={filters.type === 'INTERNE' ? 'is-active' : ''}
              onClick={() => setFilters((current) => ({ ...current, type: current.type === 'INTERNE' ? 'ALL' : 'INTERNE' }))}
            >
              <Icon name="building" size={16} /> Services internes
            </button>
            <button
              type="button"
              className={filters.type === 'EXTERNE' ? 'is-active' : ''}
              onClick={() => setFilters((current) => ({ ...current, type: current.type === 'EXTERNE' ? 'ALL' : 'EXTERNE' }))}
            >
              <Icon name="users" size={16} /> Services externes
            </button>
          </div>
        </div>
        <label>
          <span>STATUT</span>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="ALL">Tous les statuts</option>
            <option value="ACTIVE">Actifs</option>
            <option value="INACTIVE">Inactifs</option>
          </select>
        </label>
        <button type="button" className="admin-minimum-reset" onClick={resetFilters}>
          <Icon name="refresh" size={15} /> Réinitialiser
        </button>
      </section>

      {state.loading ? (
        <section className="admin-minimum-state">
          <span className="admin-minimum-spinner" />
          <strong>Chargement des services…</strong>
        </section>
      ) : state.error ? (
        <section className="admin-minimum-state admin-minimum-state--error">
          <Icon name="alert" size={26} />
          <strong>Impossible de charger les services.</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => load()}>Réessayer</button>
        </section>
      ) : filteredServices.length === 0 ? (
        <section className="admin-minimum-state">
          <Icon name="chart" size={28} />
          <strong>Aucun service à afficher</strong>
          <span>Modifiez les filtres pour afficher d’autres services.</span>
        </section>
      ) : (
        <section className="admin-minimum-grid" aria-label="Seuils de présence minimale">
          {filteredServices.map((service, index) => {
            const id = String(service.id)
            const counts = countsByService.get(id) ?? { active: 0, total: 0 }
            const minimum = Number(values[id] ?? 0)
            const originalMinimum = Number(savedValues[id] ?? 0)
            const changed = minimum !== originalMinimum
            const exceedsHeadcount = minimum > counts.active
            const highThreshold = counts.active > 0 && minimum >= counts.active
            const plusDisabled = counts.active === 0 || minimum >= counts.active
            const minusDisabled = minimum <= 0

            return (
              <article
                key={service.id}
                className={`admin-minimum-card${service.isActive ? '' : ' is-inactive'}${changed ? ' is-changed' : ''}`}
                style={{ '--admin-minimum-delay': `${Math.min(index, 8) * 45}ms` }}
              >
                <div className="admin-minimum-card__top">
                  <div className="admin-minimum-card__identity">
                    <span className={`admin-minimum-service-icon ${service.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>
                      <Icon name={service.serviceType === 'EXTERNE' ? 'users' : 'building'} size={18} />
                    </span>
                    <div>
                      <h3>{service.name}</h3>
                      <div className="admin-minimum-card__badges">
                        <span className={`admin-minimum-type ${service.serviceType === 'EXTERNE' ? 'is-external' : 'is-internal'}`}>
                          {service.serviceType === 'EXTERNE' ? 'Externe' : 'Interne'}
                        </span>
                        {!service.isActive && <span className="admin-minimum-status">Inactif</span>}
                        {changed && <span className="admin-minimum-changed">Modifié</span>}
                        {highThreshold && !exceedsHeadcount && <span className="admin-minimum-warning">Seuil élevé</span>}
                        {exceedsHeadcount && <span className="admin-minimum-danger">À corriger</span>}
                      </div>
                    </div>
                  </div>

                  <div className="admin-minimum-card__headcount">
                    <small>Effectif actif</small>
                    <strong>{counts.active}</strong>
                    {counts.total !== counts.active && <span>{counts.total} au total</span>}
                  </div>
                </div>

                <div className="admin-minimum-card__body">
                  <div className="admin-minimum-copy">
                    <small>Présence minimale</small>
                    <strong>
                      {minimum > 0
                        ? `${minimum} personne${minimum > 1 ? 's' : ''} sur ${counts.active} actif${counts.active > 1 ? 's' : ''}`
                        : 'Aucune contrainte'}
                    </strong>
                    <span>
                      {minimum > 0
                        ? 'Ce seuil est utilisé lors du contrôle des demandes de congés.'
                        : 'Aucun minimum de présence n’est imposé pour ce service.'}
                    </span>
                  </div>

                  <div className="admin-minimum-stepper" aria-label={`Présence minimale pour ${service.name}`}>
                    <button
                      type="button"
                      disabled={minusDisabled || saving}
                      onClick={() => setMinimum(service, minimum - 1)}
                      aria-label={`Diminuer la présence minimale de ${service.name}`}
                    >
                      −
                    </button>
                    <output aria-live="polite">{minimum}</output>
                    <button
                      type="button"
                      disabled={plusDisabled || saving}
                      onClick={() => setMinimum(service, minimum + 1)}
                      aria-label={`Augmenter la présence minimale de ${service.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>

                {exceedsHeadcount && (
                  <div className="admin-minimum-card__alert">
                    <Icon name="alert" size={15} />
                    Le minimum configuré dépasse l’effectif actif. Diminuez-le avant d’enregistrer.
                  </div>
                )}
              </article>
            )
          })}
        </section>
      )}

      <div className="admin-minimum-actions">
        <div>
          {changedCount > 0 ? (
            <span>{changedCount} modification{changedCount > 1 ? 's' : ''} non enregistrée{changedCount > 1 ? 's' : ''}</span>
          ) : (
            <span>Aucune modification en attente</span>
          )}
        </div>
        <button type="button" className="admin-minimum-cancel" onClick={resetChanges} disabled={!changedCount || saving}>
          Annuler les modifications
        </button>
        <button type="button" className="admin-minimum-save" onClick={saveChanges} disabled={!changedCount || saving}>
          <Icon name="check" size={16} /> {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
      </div>
    </PageContainer>
  )
}
