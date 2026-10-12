import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components/ui/Icon'
import {
  FEATURE_FLAGS,
  isCollaboratorProductionInfoDismissed,
  markCollaboratorProductionInfoDismissed,
} from '@/config/features'
import { ROLES } from '@/config/navigation'

import '@/styles/collab/production-phase-info-popup.css'

export function ProductionPhaseInfoPopup() {
  const { user } = useAuth()
  const isCollaborator = user?.role === ROLES.COLLABORATEUR
  const [visible, setVisible] = useState(
    () => isCollaborator && FEATURE_FLAGS.COLLABORATOR_PRODUCTION_PHASE_INFO && !isCollaboratorProductionInfoDismissed(),
  )
  const buttonRef = useRef(null)

  const dismiss = useCallback(() => {
    setVisible(false)
    markCollaboratorProductionInfoDismissed()
  }, [])

  useEffect(() => {
    if (!visible) return undefined

    buttonRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') dismiss()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [visible, dismiss])

  if (!visible) return null

  return (
    <div className="ppinfo-backdrop" role="presentation">
      <section
        className="ppinfo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ppinfo-title"
        aria-describedby="ppinfo-description"
      >
        <header className="ppinfo-header">
          <span className="ppinfo-icon" aria-hidden="true">
            <Icon name="info" size={22} />
          </span>
          <div className="ppinfo-heading">
            <h2 id="ppinfo-title">Information importante</h2>
            <p id="ppinfo-subtitle">Première phase de test en production</p>
          </div>
        </header>

        <div className="ppinfo-body" id="ppinfo-description">
          <p>
            Dans le cadre de la première phase de test en production de l&apos;application G Congés &amp; Absences, nous vous informons que les soldes de congés actuellement affichés sont provisoires.
          </p>
          <p>
            <strong>Merci de ne pas tenir compte de ces informations pour le moment</strong>, car elles peuvent ne pas correspondre à vos droits réels.
          </p>
          <p>
            Vous pouvez continuer à utiliser l&apos;application dans le cadre de cette phase de test.
          </p>
        </div>

        <footer className="ppinfo-footer">
          <button
            ref={buttonRef}
            type="button"
            className="ppinfo-button"
            onClick={dismiss}
          >
            J&apos;ai compris
          </button>
        </footer>
      </section>
    </div>
  )
}
