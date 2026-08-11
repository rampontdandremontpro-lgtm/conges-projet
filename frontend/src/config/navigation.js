export const ROLES = {
  COLLABORATEUR: 'COLLABORATEUR',
  RESPONSABLE_SERVICE: 'RESPONSABLE_SERVICE',
  RH: 'RH',
  DIRECTEUR: 'DIRECTEUR',
  ADMIN: 'ADMIN',
}

export const NAVIGATION = {
  [ROLES.COLLABORATEUR]: {
    main: [
      { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
      { id: 'new-request', label: 'Nouvelle demande', to: '/app/new-request', icon: 'plus' },
      { id: 'my-requests', label: 'Mes demandes', to: '/app/my-requests', icon: 'list' },
      { id: 'declare-absence', label: 'Déclarer une absence', to: '/app/declare-absence', icon: 'calendar' },
      { id: 'my-justificatifs', label: 'Mes justificatifs', to: '/app/my-justificatifs', icon: 'file' },
      { id: 'my-balances', label: 'Mes soldes', to: '/app/my-balances', icon: 'wallet' },
      { id: 'documents', label: 'Documents PDF', to: '/app/documents', icon: 'doc' },
    ],
    footer: [
      { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
      { id: 'my-space', label: 'Mon espace', to: '/app/my-space', icon: 'user' },
    ],
  },
  [ROLES.RESPONSABLE_SERVICE]: {
    main: [
      { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
      { id: 'requests', label: 'Demandes', to: '/app/requests', icon: 'list' },
      { id: 'alerts', label: 'Alertes', to: '/app/alerts', icon: 'alert' },
      { id: 'service-presence', label: 'Présence du service', to: '/app/service-presence', icon: 'users' },
    ],
    footer: [
      { id: 'my-space', label: 'Mon espace', to: '/app/my-space', icon: 'user' },
      { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
    ],
  },
  [ROLES.RH]: {
    main: [
      { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
      { id: 'requests', label: 'Demandes', to: '/app/requests', icon: 'list' },
      { id: 'absences', label: 'Absences', to: '/app/absences', icon: 'calendar' },
      { id: 'derogations', label: 'Dérogations', to: '/app/derogations', icon: 'alert' },
      { id: 'balances', label: 'Soldes', to: '/app/balances', icon: 'wallet' },
      { id: 'validators', label: 'Valideurs & remplacements', to: '/app/validators', icon: 'shield' },
      { id: 'rh-settings', label: 'Paramétrage RH', to: '/app/rh-settings', icon: 'settings' },
      { id: 'documents-exports', label: 'Documents & exports', to: '/app/documents-exports', icon: 'doc' },
    ],
    footer: [
      { id: 'notifications-alerts', label: 'Notifications & alertes', to: '/app/notifications', icon: 'bell' },
      { id: 'my-space', label: 'Mon espace', to: '/app/my-space', icon: 'user' },
    ],
  },
  [ROLES.DIRECTEUR]: {
    main: [
      { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
      { id: 'requests', label: 'Demandes', to: '/app/requests', icon: 'list' },
      { id: 'alerts', label: 'Alertes', to: '/app/alerts', icon: 'alert' },
      { id: 'my-leaves', label: 'Enregistrer mes congés/absences', to: '/app/my-leaves', icon: 'calendar' },
      { id: 'statistics', label: 'Statistiques & exports', to: '/app/statistics', icon: 'chart' },
    ],
    footer: [
      { id: 'notifications', label: 'Notifications', to: '/app/notifications', icon: 'bell' },
      { id: 'my-space', label: 'Mon espace', to: '/app/my-space', icon: 'user' },
    ],
  },
  [ROLES.ADMIN]: {
    main: [
      { id: 'dashboard', label: 'Tableau de bord', to: '/app/dashboard', icon: 'dashboard' },
      { id: 'organisation', label: 'Organisation', to: '/app/organisation', icon: 'building' },
      { id: 'configuration', label: 'Configuration', to: '/app/configuration', icon: 'settings' },
      { id: 'calendar', label: 'Calendrier', to: '/app/calendar', icon: 'calendar' },
      { id: 'system', label: 'Système', to: '/app/system', icon: 'cpu' },
    ],
    footer: [
      { id: 'my-profile', label: 'Mon profil', to: '/app/my-profile', icon: 'user' },
    ],
  },
}

export function getNavigationForRole(role) {
  return NAVIGATION[role] ?? NAVIGATION[ROLES.COLLABORATEUR]
}

export function getSectionLabel(section) {
  for (const role of Object.values(ROLES)) {
    const items = [...NAVIGATION[role].main, ...NAVIGATION[role].footer]
    const match = items.find((item) => item.id === section)
    if (match) {
      return match.label
    }
  }
  return null
}

export const PREVIEW_ROLES = [
  { value: ROLES.COLLABORATEUR, label: 'Collaborateur' },
  { value: ROLES.RESPONSABLE_SERVICE, label: 'Responsable de service' },
  { value: ROLES.RH, label: 'RH' },
  { value: ROLES.DIRECTEUR, label: 'Directeur' },
  { value: ROLES.ADMIN, label: 'Administrateur' },
]
