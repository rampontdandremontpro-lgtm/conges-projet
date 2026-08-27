import { Icon } from '@/components/ui/Icon'

const OFFICIAL_LEAVE_INFO_URL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2258'

export function PracticalInfoCard() {
  return (
    <section className="practical-info-card">
      <span className="practical-info-card__icon" aria-hidden="true">
        <Icon name="info" size={22} />
      </span>
      <div className="practical-info-card__content">
        <h2>Informations pratiques</h2>
        <p>Consultez les règles officielles applicables aux congés payés sur le site Service-Public.fr.</p>
        <a href={OFFICIAL_LEAVE_INFO_URL} target="_blank" rel="noreferrer">
          Voir les règles officielles
          <Icon name="arrowRight" size={16} />
        </a>
      </div>
    </section>
  )
}
