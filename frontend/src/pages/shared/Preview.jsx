import { useParams } from 'react-router-dom'

import { PageContainer } from '@/components/ui/PageContainer'
import { Icon } from '@/components/ui/Icon'
import { getSectionLabel } from '@/config/navigation'

export function Preview() {
  const { section } = useParams()
  const label = section ? getSectionLabel(section) : null

  return (
    <PageContainer>
      <header className="page-heading">
        <h1>{label ?? 'Bienvenue sur GMES'}</h1>
        <p>Gestion des congés et des absences — GMES</p>
      </header>
      <div className="card preview-placeholder">
        <span className="preview-placeholder__icon">
          <Icon name="doc" size={28} />
        </span>
        <h2>Module en préparation</h2>
        <p>
          La structure commune de l&apos;application est en place. Le contenu de
          ce module sera intégré dans une prochaine itération.
        </p>
      </div>
    </PageContainer>
  )
}
