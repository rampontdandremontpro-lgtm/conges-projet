import { useEffect, useMemo, useState } from 'react'

import { getProfileImages } from '@/services/profile'

let profileImagesCache = null
let profileImagesRequest = null
const profileImageSubscribers = new Set()

function normalizeProfileImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function publishProfileImages(images) {
  profileImagesCache = normalizeProfileImages(images)
  profileImageSubscribers.forEach((listener) => listener(profileImagesCache))
}

async function ensureProfileImages() {
  if (profileImagesCache) return profileImagesCache
  if (!profileImagesRequest) {
    profileImagesRequest = getProfileImages()
      .then((images) => {
        publishProfileImages(images)
        return profileImagesCache
      })
      .catch(() => {
        publishProfileImages({})
        return profileImagesCache
      })
      .finally(() => {
        profileImagesRequest = null
      })
  }
  return profileImagesRequest
}

function initials(user) {
  return `${user?.nom?.[0] ?? ''}${user?.prenom?.[0] ?? ''}`.toUpperCase()
}

export function ProfileAvatar({
  user,
  userId,
  className,
  style,
  fallback,
  title,
  'aria-hidden': ariaHidden = true,
}) {
  const resolvedId = String(userId ?? user?.id ?? '')
  const defaultText = useMemo(() => fallback ?? initials(user), [fallback, user])
  const [profileImage, setProfileImage] = useState(() => profileImagesCache?.[resolvedId] ?? null)

  useEffect(() => {
    let active = true

    const updateFromCache = (images) => {
      if (active) setProfileImage(images?.[resolvedId] ?? null)
    }
    profileImageSubscribers.add(updateFromCache)
    ensureProfileImages().then(updateFromCache)

    const handlePreferenceUpdate = (event) => {
      const changedUserId = String(event.detail?.userId ?? '')
      if (!changedUserId) {
        profileImagesCache = null
        ensureProfileImages().then(updateFromCache)
        return
      }
      if (changedUserId !== resolvedId) return

      const next = { ...(profileImagesCache ?? {}) }
      if (event.detail?.profileImageData) next[changedUserId] = event.detail.profileImageData
      else delete next[changedUserId]
      publishProfileImages(next)
    }

    window.addEventListener('gmes:profile-preferences-updated', handlePreferenceUpdate)
    return () => {
      active = false
      profileImageSubscribers.delete(updateFromCache)
      window.removeEventListener('gmes:profile-preferences-updated', handlePreferenceUpdate)
    }
  }, [resolvedId])

  return (
    <span className={className} style={style} title={title} aria-hidden={ariaHidden}>
      {profileImage ? (
        <img
          src={profileImage}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
        />
      ) : defaultText}
    </span>
  )
}
