import { UserRole } from '../users/user.entity';

export interface NotificationPreferenceDefinition {
  key: string;
  label: string;
  defaultApplication: boolean;
  defaultEmail: boolean;
  notificationTypes?: string[];
}

const DEFAULTS = {
  defaultApplication: true,
  defaultEmail: false,
} as const;

function event(
  key: string,
  label: string,
  notificationTypes: string[] = [],
): NotificationPreferenceDefinition {
  return {
    key,
    label,
    ...DEFAULTS,
    notificationTypes,
  };
}

export const NOTIFICATION_PREFERENCES_BY_ROLE: Record<
  UserRole,
  NotificationPreferenceDefinition[]
> = {
  [UserRole.COLLABORATEUR]: [
    event('leave_submitted', 'Demande de congé soumise'),
    event('leave_approved', 'Demande de congé approuvée', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('leave_refused', 'Demande de congé refusée', [
      'LEAVE_REQUEST_REFUSEE',
    ]),
    event(
      'leave_changed_by_rh',
      'Demande annulée ou modifiée par la RH',
      ['LEAVE_REQUEST_PREPARED_BY_RH'],
    ),
    event('absence_recorded', 'Absence déclarée enregistrée'),
    event('absence_authorized', 'Absence autorisée'),
    event('absence_refused', 'Absence refusée'),
    event('supporting_document_accepted', 'Justificatif accepté'),
    event('supporting_document_refused', 'Justificatif refusé'),
    event('supporting_document_required', 'Justificatif ou document à fournir'),
    event('derogation_approved', 'Dérogation accordée'),
    event('derogation_refused', 'Dérogation refusée'),
    event('balance_corrected', 'Solde de congés corrigé'),
    event('balance_movement', 'Nouveau mouvement sur mon solde', [
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
    ]),
    event(
      'temporary_validator_started',
      'Remplacement temporaire de mon valideur activé',
    ),
    event(
      'temporary_validator_ended',
      'Remplacement temporaire de mon valideur terminé ou annulé',
    ),
    event(
      'upcoming_leave_reminder',
      'Rappel d’un congé ou d’une absence à venir',
      ['BALANCE_REMINDER_*'],
    ),
  ],

  [UserRole.RESPONSABLE_SERVICE]: [
    event('new_request_to_process', 'Nouvelle demande à traiter', [
      'LEAVE_REQUEST_SUBMITTED',
    ]),
    event('pending_request_reminder', 'Demande en attente depuis plusieurs jours', [
      'LEAVE_REQUEST_REMINDER_*',
    ]),
    event('employee_request_modified', 'Demande modifiée par un collaborateur'),
    event('employee_request_cancelled', 'Demande annulée par un collaborateur'),
    event('new_service_absence', 'Nouvelle absence déclarée dans mon service'),
    event(
      'service_absence_decision',
      'Absence autorisée ou refusée dans mon service',
    ),
    event('overlap_alert', 'Nouvelle alerte de chevauchement'),
    event('minimum_presence_alert', 'Alerte de présence minimale'),
    event('director_unavailability_recorded', 'Indisponibilité du Directeur enregistrée', [
      'CONGE_DIRECTEUR_INFORMATION',
      'ABSENCE_DIRECTEUR_INFORMATION',
    ]),
    event('director_unavailability_modified', 'Indisponibilité du Directeur modifiée', [
      'CONGE_DIRECTEUR_MODIFIE',
      'ABSENCE_DIRECTEUR_MODIFIEE',
    ]),
    event('director_unavailability_cancelled', 'Indisponibilité du Directeur annulée', [
      'CONGE_DIRECTEUR_ANNULE',
      'ABSENCE_DIRECTEUR_ANNULEE',
    ]),
    event('backup_validator_added', 'Je suis désigné comme valideur de secours'),
    event('backup_validator_removed', 'Je ne suis plus valideur de secours'),
    event(
      'temporary_replacement_service',
      'Un remplacement temporaire concerne un collaborateur de mon service',
    ),
    event('my_leave_approved', 'Ma demande approuvée', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('my_leave_refused', 'Ma demande refusée', [
      'LEAVE_REQUEST_REFUSEE',
    ]),
    event('my_absence_authorized', 'Mon absence autorisée'),
    event('my_absence_refused', 'Mon absence refusée'),
    event('my_supporting_document_accepted', 'Mon justificatif accepté'),
    event('my_supporting_document_refused', 'Mon justificatif refusé'),
    event('my_balance_corrected', 'Mon solde corrigé', [
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
      'BALANCE_REMINDER_*',
    ]),
  ],

  [UserRole.RH]: [
    event('new_request_rh_action', 'Nouvelle demande nécessitant une action RH', [
      'LEAVE_REQUEST_SUBMITTED',
    ]),
    event('new_absence_declaration', 'Nouvelle déclaration d’absence'),
    event('new_supporting_document', 'Nouveau justificatif reçu'),
    event('supporting_document_to_review', 'Justificatif à vérifier'),
    event('absence_to_decide', 'Absence à autoriser ou refuser'),
    event('new_derogation', 'Nouvelle demande de dérogation'),
    event('derogation_expiring', 'Dérogation arrivant bientôt à expiration'),
    event('negative_balance_alert', 'Alerte de solde négatif'),
    event('abnormal_balance_alert', 'Alerte de solde anormal'),
    event('balance_correction_done', 'Correction de solde effectuée'),
    event(
      'temporary_replacement_changed',
      'Remplacement temporaire créé, modifié ou supprimé',
    ),
    event(
      'backup_validator_changed',
      'Valideur de secours ajouté ou retiré',
    ),
    event('director_unavailability_recorded', 'Indisponibilité du Directeur enregistrée', [
      'CONGE_DIRECTEUR_INFORMATION',
      'ABSENCE_DIRECTEUR_INFORMATION',
    ]),
    event('director_unavailability_modified', 'Indisponibilité du Directeur modifiée', [
      'CONGE_DIRECTEUR_MODIFIE',
      'ABSENCE_DIRECTEUR_MODIFIEE',
    ]),
    event('director_unavailability_cancelled', 'Indisponibilité du Directeur annulée', [
      'CONGE_DIRECTEUR_ANNULE',
      'ABSENCE_DIRECTEUR_ANNULEE',
    ]),
    event('important_overlap_alert', 'Alerte de chevauchement importante'),
    event('minimum_presence_alert', 'Alerte de présence minimale'),
    event('rh_report_available', 'Rapport récapitulatif RH disponible', [
      'BALANCE_RECAP_*',
    ]),
    event('my_leave_approved', 'Ma demande approuvée par le Directeur', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('my_leave_refused', 'Ma demande refusée', [
      'LEAVE_REQUEST_REFUSEE',
    ]),
    event('my_absence_updated', 'Mon absence enregistrée ou mise à jour'),
    event('my_balance_corrected', 'Mon solde corrigé', [
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
      'BALANCE_REMINDER_*',
    ]),
  ],

  [UserRole.DIRECTEUR]: [
    event(
      'new_request_for_validation',
      'Nouvelle demande nécessitant ma validation',
      ['LEAVE_REQUEST_SUBMITTED'],
    ),
    event('rh_request_to_process', 'Demande RH à traiter'),
    event(
      'manager_request_to_process',
      'Demande Responsable de service à traiter',
    ),
    event('pending_request_reminder', 'Demande en attente depuis plusieurs jours', [
      'LEAVE_REQUEST_REMINDER_*',
    ]),
    event(
      'derogation_needs_intervention',
      'Nouvelle demande de dérogation nécessitant mon intervention',
    ),
    event('important_overlap_alert', 'Alerte de chevauchement importante'),
    event('minimum_presence_alert', 'Alerte de présence minimale'),
    event(
      'critical_service_presence',
      'Service avec un niveau de présence critique',
    ),
    event(
      'important_negative_balance',
      'Alerte de solde négatif importante',
    ),
    event(
      'validator_configuration_changed',
      'Modification importante d’un remplacement ou d’un valideur de secours',
    ),
    event(
      'exceptional_closure_changed',
      'Fermeture exceptionnelle ajoutée ou modifiée',
    ),
    event(
      'calendar_parameter_changed',
      'Jour férié ou paramètre de calendrier modifié',
    ),
    event('periodic_report_available', 'Rapport ou synthèse périodique disponible'),
  ],

  [UserRole.ADMIN]: [
    event('user_created', 'Utilisateur créé'),
    event('user_activation_changed', 'Utilisateur activé ou désactivé'),
    event('user_role_changed', 'Rôle d’un utilisateur modifié'),
    event('user_service_changed', 'Affectation à un service modifiée'),
    event('service_created', 'Service créé'),
    event('service_modified', 'Service modifié'),
    event('service_disabled', 'Service désactivé'),
    event(
      'service_manager_changed',
      'Responsable principal d’un service modifié',
    ),
    event(
      'backup_validator_changed',
      'Valideur de secours ajouté ou retiré',
    ),
    event('global_setting_changed', 'Paramètre global de l’application modifié'),
    event('holiday_changed', 'Jour férié ajouté, modifié ou supprimé'),
    event(
      'exceptional_closure_changed',
      'Fermeture exceptionnelle ajoutée, modifiée ou supprimée',
    ),
    event('export_error', 'Erreur importante lors d’un export'),
    event(
      'document_generation_error',
      'Erreur importante de génération de document',
    ),
    event(
      'system_error',
      'Erreur système nécessitant une intervention Admin',
    ),
  ],
};

function typeMatches(pattern: string, type: string): boolean {
  if (pattern.endsWith('*')) {
    return type.startsWith(pattern.slice(0, -1));
  }
  return pattern === type;
}

export function getNotificationPreferenceDefinitions(
  role: UserRole,
): NotificationPreferenceDefinition[] {
  return NOTIFICATION_PREFERENCES_BY_ROLE[role] ?? [];
}

export function resolveNotificationPreferenceKey(
  role: UserRole,
  notificationType: string,
): string | null {
  const type = notificationType.trim().toUpperCase();
  const definition = getNotificationPreferenceDefinitions(role).find((item) =>
    (item.notificationTypes ?? []).some((pattern) =>
      typeMatches(pattern, type),
    ),
  );

  return definition?.key ?? null;
}
