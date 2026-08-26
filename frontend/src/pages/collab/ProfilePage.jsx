import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/config/navigation'
import { getMyProfile } from '@/services/profile'
import { formatDateFR, parseISO, todayISO } from '@/utils/format'

import '@/styles/collab/profile/index.css'

const PRESENCE_LABELS = {
  PRESENT: 'Présent',
  EN_VACANCES: 'En vacances',
  ABSENT: 'Absent',
}

const EMPLOYMENT_LABELS = {
  INTERNE: 'Collaborateur interne',
  EXTERNE: 'Collaborateur externe',
}

function seniorityLabel(hireDate) {
  if (!hireDate) return 'Non renseignée'

  const start = parseISO(hireDate)
  const now = parseISO(todayISO())
  let years = now.getFullYear() - start.getFullYear()
  let months = now.getMonth() - start.getMonth()

  if (now.getDate() < start.getDate()) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }

  if (years <= 0 && months <= 0) return 'Moins d’un mois'
  const parts = []
  if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`)
  if (months > 0) parts.push(`${months} mois`)
  return parts.join(' et ')
}

function profileInitials(profile) {
  return `${profile?.nom?.[0] ?? ''}${profile?.prenom?.[0] ?? ''}`.toUpperCase()
}

function ProfileSkeleton() {
  return (
    <div className="profile-page profile-page--loading" aria-label="Chargement du profil">
      <div className="profile-card profile-skeleton profile-skeleton--hero" />
      <div className="profile-card profile-skeleton profile-skeleton--details" />
    </div>
  )
}

export function ProfilePage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const loadProfile = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await getMyProfile()
      setState({ loading: false, error: null, data })
    } catch (error) {
      setState({
        loading: false,
        error: error.response?.data?.message ?? 'Impossible de charger votre profil.',
        data: null,
      })
    }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const details = useMemo(() => {
    if (!state.data) return []
    const profile = state.data
    const serviceLabel = profile.service?.name ?? 'Non renseigné'
    const organisation = profile.service?.externalCompanyName
      ? `${profile.service.externalCompanyName} · ${serviceLabel}`
      : serviceLabel

    return [
      { icon: 'user', label: 'Rôle', value: ROLE_LABELS[profile.role] ?? profile.role },
      { icon: 'building', label: 'Service', value: organisation },
      {
        icon: 'users',
        label: 'Type de collaboration',
        value: EMPLOYMENT_LABELS[profile.employmentType] ?? profile.employmentType,
      },
      {
        icon: 'calendar',
        label: 'Date d’arrivée',
        value: profile.hireDate ? formatDateFR(profile.hireDate) : 'Non renseignée',
      },
      {
        icon: 'clock',
        label: 'Ancienneté',
        value: seniorityLabel(profile.hireDate),
      },
      {
        icon: 'check',
        label: 'Statut de présence',
        value: PRESENCE_LABELS[profile.presenceStatus] ?? profile.presenceStatus,
        tone: profile.presenceStatus === 'PRESENT' ? 'success' : 'info',
      },
    ]
  }, [state.data])

  if (state.loading) return <ProfileSkeleton />

  if (state.error) {
    return (
      <div className="profile-page">
        <div className="profile-error profile-card">
          <span className="profile-error__icon"><Icon name="alert" size={22} /></span>
          <strong>Votre profil n’a pas pu être chargé.</strong>
          <p>{state.error}</p>
          <button type="button" onClick={loadProfile}>Réessayer</button>
        </div>
      </div>
    )
  }

  const profile = state.data

  return (
    <div className="profile-page">
      <section className="profile-card profile-hero">
        <div className="profile-hero__avatar" aria-hidden="true">
          {profile.profileImageData ? <img src={profile.profileImageData} alt="" /> : profileInitials(profile)}
          <span className={`profile-hero__presence profile-hero__presence--${profile.presenceStatus?.toLowerCase()}`} />
        </div>
        <div className="profile-hero__identity">
          <div className="profile-hero__title-row">
            <h2>{profile.nom} {profile.prenom}</h2>
            <span className="profile-hero__role">{ROLE_LABELS[profile.role] ?? profile.role}</span>
          </div>
          <p className="profile-hero__service">{profile.service?.name ?? 'Service non renseigné'}</p>
          <p className="profile-hero__email">{profile.email}</p>
        </div>
        <button
          type="button"
          className="profile-hero__settings"
          onClick={() => navigate('/app/settings')}
        >
          <Icon name="settings" size={16} />
          Paramètres
        </button>
      </section>

      <section className="profile-card profile-details">
        <div className="profile-section-heading">
          <div>
            <span className="profile-section-heading__eyebrow">Informations personnelles</span>
            <h3>Mon compte G Congés & Absences</h3>
          </div>
          <span className="profile-section-heading__readonly">
            <Icon name="shield" size={14} /> Lecture seule
          </span>
        </div>

        <div className="profile-details__grid">
          {details.map((item) => (
            <div className="profile-detail" key={item.label}>
              <span className="profile-detail__icon"><Icon name={item.icon} size={17} /></span>
              <div>
                <span className="profile-detail__label">{item.label}</span>
                <strong className={item.tone ? `profile-detail__value profile-detail__value--${item.tone}` : 'profile-detail__value'}>
                  {item.value}
                </strong>
              </div>
            </div>
          ))}
        </div>

        <div className="profile-info-note">
          <Icon name="info" size={17} />
          <p>Les informations liées à votre identité, votre rôle et votre service sont gérées par l’administration de l’application.</p>
        </div>
      </section>
    </div>
  )
}
