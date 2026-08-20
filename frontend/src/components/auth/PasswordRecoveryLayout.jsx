import gmesLogo from '@/assets/logo-gmes.png'
import gmesBugbustersLogo from '@/assets/gmes-bugbusters-logo.png'
import poleApplicatifLogo from '@/assets/pole-applicatif-logo.png'

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M8 3.75v3.5M16 3.75v3.5M4 9.5h16" />
      <path d="M8 13h2M14 13h2M8 16.5h2" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.75 18c.45-3.1 2.2-4.65 5.25-4.65S13.8 14.9 14.25 18" />
      <circle cx="17.25" cy="9" r="2.25" />
      <path d="M15.75 14.1c2.85-.35 4.35.95 4.5 3.9" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8h8M12 12l-5.5 5.5" />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.25c0 4.4-2.55 7.55-7 9.25-4.45-1.7-7-4.85-7-9.25V6l7-2.5Z" />
      <path d="m9.25 12 1.8 1.8 3.9-4.1" />
    </svg>
  )
}

export function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.75 6.5h14.5A1.75 1.75 0 0 1 21 8.25v7.5a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 15.75v-7.5A1.75 1.75 0 0 1 4.75 6.5Z" />
      <path d="m4.2 7.35 7.8 5.4 7.8-5.4" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10" width="13" height="10" rx="2" />
      <path d="M8.5 10V7.75a3.5 3.5 0 1 1 7 0V10" />
    </svg>
  )
}

export function PasswordRecoveryLayout({ title, subtitle, children, securityText }) {
  return (
    <main className="login-page login-page--recovery">
      <div className="login-page__shape login-page__shape--top" aria-hidden="true" />
      <div className="login-page__shape login-page__shape--bottom" aria-hidden="true" />
      <div className="login-page__curve login-page__curve--top" aria-hidden="true" />
      <div className="login-page__curve login-page__curve--bottom" aria-hidden="true" />
      <span className="login-page__dot login-page__dot--top" aria-hidden="true" />
      <span className="login-page__dot login-page__dot--bottom" aria-hidden="true" />
      <div className="login-page__dots" aria-hidden="true" />

      <section className="login-hero" aria-label="Présentation de GMES">
        <div className="login-brand login-brand--hero">
          <img src={gmesLogo} alt="GMES" className="login-brand__logo login-brand__logo--hero" />
        </div>

        <div className="login-hero__content">
          <h1>
            Gestion simplifiée
            <br />
            des congés et des absences
          </h1>
          <p>
            GMES vous accompagne au quotidien pour gérer
            <br className="login-hero__desktop-break" />
            vos demandes, validations et soldes en toute simplicité.
          </p>

          <div className="login-features">
            <div className="login-feature">
              <span className="login-feature__icon login-feature__icon--blue">
                <CalendarIcon />
              </span>
              <div>
                <strong>Demandez en quelques clics</strong>
                <span>Créez et suivez vos demandes facilement.</span>
              </div>
            </div>

            <div className="login-feature">
              <span className="login-feature__icon login-feature__icon--orange">
                <PeopleIcon />
              </span>
              <div>
                <strong>Validation rapide</strong>
                <span>Managers et équipes alignés en temps réel.</span>
              </div>
            </div>

            <div className="login-feature">
              <span className="login-feature__icon login-feature__icon--blue">
                <ChartIcon />
              </span>
              <div>
                <strong>Suivi en temps réel</strong>
                <span>Soldes, historique et notifications instantanées.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="login-panel login-panel--recovery" aria-labelledby="recovery-title">
        <div className="login-panel__brand login-panel__brand--partners" aria-label="Pôle Applicatif et GMES">
          <img
            src={poleApplicatifLogo}
            alt="Pôle Applicatif"
            className="login-panel__partner-logo login-panel__partner-logo--pole"
          />
          <span className="login-panel__partner-divider" aria-hidden="true" />
          <img
            src={gmesBugbustersLogo}
            alt="GMES Bugbusters"
            className="login-panel__partner-logo login-panel__partner-logo--gmes"
          />
        </div>

        <div className="login-panel__heading login-panel__heading--recovery">
          <h2 id="recovery-title">{title}</h2>
          <p>{subtitle}</p>
        </div>

        {children}

        <div className="login-security login-security--recovery">
          <span>
            <ShieldIcon />
          </span>
          {securityText ?? 'Accès sécurisé à votre espace GMES'}
        </div>
      </section>
    </main>
  )
}
