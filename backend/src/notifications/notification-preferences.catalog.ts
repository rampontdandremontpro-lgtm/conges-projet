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
    event('leave_submitted', 'Demande de congé soumise', [
      'LEAVE_REQUEST_SUBMITTED_SELF',
    ]),
    event('leave_in_progress', 'Demande transmise à la RH', [
      'LEAVE_REQUEST_IN_PROGRESS',
    ]),
    event('leave_approved', 'Demande de congé approuvée', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('leave_refused', 'Demande de congé refusée', [
      'LEAVE_REQUEST_REFUSEE',
      'LEAVE_REQUEST_EXPIRED',
    ]),
    event(
      'leave_changed_by_rh',
      'Demande annulée ou modifiée par la RH',
      ['LEAVE_REQUEST_PREPARED_BY_RH'],
    ),
    event('absence_recorded', 'Absence déclarée enregistrée', [
      'ABSENCE_DECLARATION_RECORDED',
    ]),
    event('absence_authorized', 'Absence autorisée', [
      'ABSENCE_DECLARATION_AUTHORIZED',
    ]),
    event('absence_refused', 'Absence refusée', [
      'ABSENCE_DECLARATION_REFUSED',
    ]),
    event('supporting_document_accepted', 'Justificatif accepté', [
      'SUPPORTING_DOCUMENT_ACCEPTED',
    ]),
    event('supporting_document_refused', 'Justificatif refusé', [
      'SUPPORTING_DOCUMENT_REFUSED',
    ]),
    event('supporting_document_required', 'Justificatif ou document à fournir', [
      'SUPPORTING_DOCUMENT_REQUIRED',
    ]),
    event('derogation_in_progress', 'Dérogation validée par la RH et transmise au Directeur', [
      'DEROGATION_IN_PROGRESS',
    ]),
    event('derogation_approved', 'Dérogation accordée', [
      'DEROGATION_APPROVED',
    ]),
    event('derogation_refused', 'Dérogation refusée', [
      'DEROGATION_REFUSED',
    ]),
    event('balance_corrected', 'Solde de congés corrigé', [
      'BALANCE_CORRECTED',
    ]),
    event('balance_movement', 'Nouveau mouvement sur mon solde', [
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
    ]),
    event(
      'temporary_validator_started',
      'Remplacement temporaire de mon valideur activé',
      ['VALIDATOR_REPLACEMENT_STARTED'],
    ),
    event(
      'temporary_validator_ended',
      'Remplacement temporaire de mon valideur terminé ou annulé',
      ['VALIDATOR_REPLACEMENT_ENDED'],
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
      'LEAVE_REQUEST_VALIDEE_INFO',
      'LEAVE_REQUEST_REFUSEE_INFO',
    ]),
    event('pending_request_reminder', 'Demande en attente depuis plusieurs jours', [
      'LEAVE_REQUEST_REMINDER_*',
      'LEAVE_REQUEST_EXPIRED_INFO',
    ]),
    event('employee_request_modified', 'Demande modifiée par un collaborateur', [
      'LEAVE_REQUEST_MODIFIED',
    ]),
    event('employee_request_cancelled', 'Demande annulée par un collaborateur', [
      'LEAVE_REQUEST_CANCELLED',
    ]),
    event('new_service_absence', 'Nouvelle absence déclarée dans mon service', [
      'ABSENCE_DECLARATION_SUBMITTED_MANAGER',
    ]),
    event(
      'service_absence_decision',
      'Absence autorisée ou refusée dans mon service',
      ['ABSENCE_DECLARATION_DECISION_INFO'],
    ),
    event('overlap_alert', 'Nouvelle alerte de chevauchement', [
      'OVERLAP_ALERT',
    ]),
    event('minimum_presence_alert', 'Alerte de présence minimale', [
      'MINIMUM_PRESENCE_ALERT',
    ]),
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
    event('backup_validator_added', 'Je suis désigné comme valideur de secours', [
      'BACKUP_VALIDATOR_ADDED',
    ]),
    event('backup_validator_removed', 'Je ne suis plus valideur de secours', [
      'BACKUP_VALIDATOR_REMOVED',
    ]),
    event(
      'temporary_replacement_service',
      'Un remplacement temporaire concerne un collaborateur de mon service',
      ['VALIDATOR_REPLACEMENT_SERVICE_CHANGED'],
    ),
    event('my_leave_approved', 'Ma demande approuvée', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('my_leave_refused', 'Ma demande refusée', [
      'LEAVE_REQUEST_REFUSEE',
      'LEAVE_REQUEST_EXPIRED',
    ]),
    event('my_absence_recorded', 'Mon absence enregistrée', [
      'ABSENCE_DECLARATION_RECORDED',
    ]),
    event('my_absence_authorized', 'Mon absence autorisée', [
      'ABSENCE_DECLARATION_AUTHORIZED',
    ]),
    event('my_absence_refused', 'Mon absence refusée', [
      'ABSENCE_DECLARATION_REFUSED',
    ]),
    event('my_supporting_document_accepted', 'Mon justificatif accepté', [
      'SUPPORTING_DOCUMENT_ACCEPTED',
    ]),
    event('my_supporting_document_refused', 'Mon justificatif refusé', [
      'SUPPORTING_DOCUMENT_REFUSED',
    ]),
    event('my_supporting_document_required', 'Justificatif ou document à fournir', [
      'SUPPORTING_DOCUMENT_REQUIRED',
    ]),
    event('my_derogation_approved', 'Ma dérogation accordée', [
      'DEROGATION_APPROVED',
    ]),
    event('my_derogation_refused', 'Ma dérogation refusée', [
      'DEROGATION_REFUSED',
    ]),
    event('my_balance_corrected', 'Mon solde corrigé', [
      'BALANCE_CORRECTED',
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
      'BALANCE_REMINDER_*',
    ]),
  ],

  [UserRole.RH]: [
    event('new_request_rh_action', 'Nouvelle demande nécessitant une action RH', [
      'LEAVE_REQUEST_SUBMITTED',
      'LEAVE_REQUEST_MODIFIED',
      'LEAVE_REQUEST_CANCELLED',
      'LEAVE_REQUEST_VALIDEE_INFO',
      'LEAVE_REQUEST_REFUSEE_INFO',
      'LEAVE_REQUEST_EXPIRED_INFO',
      'LEAVE_REQUEST_RH_FINALIZATION',
    ]),
    event('new_absence_declaration', 'Nouvelle déclaration d’absence', [
      'ABSENCE_DECLARATION_SUBMITTED_RH',
    ]),
    event('new_supporting_document', 'Nouveau justificatif reçu', [
      'SUPPORTING_DOCUMENT_RECEIVED',
    ]),
    event('supporting_document_to_review', 'Justificatif à vérifier', [
      'SUPPORTING_DOCUMENT_TO_REVIEW',
    ]),
    event('absence_to_decide', 'Absence à autoriser ou refuser', [
      'ABSENCE_DECLARATION_TO_REVIEW',
    ]),
    event('new_derogation', 'Nouvelle demande de dérogation', [
      'DEROGATION_SUBMITTED_RH',
    ]),
    event('derogation_expiring', 'Dérogation arrivant bientôt à expiration', [
      'DEROGATION_EXPIRING',
    ]),
    event('negative_balance_alert', 'Alerte de solde négatif', [
      'NEGATIVE_BALANCE_ALERT',
    ]),
    event('abnormal_balance_alert', 'Alerte de solde anormal', [
      'ABNORMAL_BALANCE_ALERT',
    ]),
    event('balance_correction_done', 'Correction de solde effectuée', [
      'BALANCE_CORRECTION_INFO',
    ]),
    event(
      'temporary_replacement_changed',
      'Remplacement temporaire créé, modifié ou supprimé',
      ['VALIDATOR_REPLACEMENT_CHANGED'],
    ),
    event(
      'backup_validator_changed',
      'Valideur de secours ajouté ou retiré',
      ['BACKUP_VALIDATOR_CHANGED'],
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
    event('important_overlap_alert', 'Alerte de chevauchement importante', [
      'OVERLAP_ALERT',
    ]),
    event('minimum_presence_alert', 'Alerte de présence minimale', [
      'MINIMUM_PRESENCE_ALERT',
    ]),
    event('rh_report_available', 'Rapport récapitulatif RH disponible', [
      'BALANCE_RECAP_*',
    ]),
    event('my_leave_approved', 'Ma demande approuvée par le Directeur', [
      'LEAVE_REQUEST_VALIDEE',
    ]),
    event('my_leave_refused', 'Ma demande refusée', [
      'LEAVE_REQUEST_REFUSEE',
      'LEAVE_REQUEST_EXPIRED',
    ]),
    event('my_absence_updated', 'Mon absence enregistrée ou mise à jour', [
      'ABSENCE_DECLARATION_RECORDED',
      'ABSENCE_DECLARATION_AUTHORIZED',
      'ABSENCE_DECLARATION_REFUSED',
    ]),
    event('my_supporting_document_required', 'Justificatif ou document à fournir', [
      'SUPPORTING_DOCUMENT_REQUIRED',
    ]),
    event('my_derogation_approved', 'Ma dérogation accordée', [
      'DEROGATION_APPROVED',
    ]),
    event('my_derogation_refused', 'Ma dérogation refusée', [
      'DEROGATION_REFUSED',
    ]),
    event('my_balance_corrected', 'Mon solde corrigé', [
      'BALANCE_CORRECTED',
      'EXCEPTIONAL_CARRYOVER_APPROVED',
      'REFERENCE_PERIOD_CLOSED',
      'BALANCE_REMINDER_*',
    ]),
  ],

  [UserRole.DIRECTEUR]: [
    event(
      'new_request_for_validation',
      'Nouvelle demande nécessitant ma validation',
      [
        'LEAVE_REQUEST_SUBMITTED',
        'LEAVE_REQUEST_MODIFIED',
        'LEAVE_REQUEST_CANCELLED',
        'LEAVE_REQUEST_VALIDEE_INFO',
        'LEAVE_REQUEST_REFUSEE_INFO',
      ],
    ),
    event('rh_request_to_process', 'Demande RH à traiter', [
      'LEAVE_REQUEST_SUBMITTED_RH',
    ]),
    event(
      'manager_request_to_process',
      'Demande Responsable de service à traiter',
      ['LEAVE_REQUEST_SUBMITTED_MANAGER'],
    ),
    event('pending_request_reminder', 'Demande en attente depuis plusieurs jours', [
      'LEAVE_REQUEST_REMINDER_*',
      'LEAVE_REQUEST_EXPIRED_INFO',
    ]),
    event(
      'derogation_needs_intervention',
      'Nouvelle demande de dérogation nécessitant mon intervention',
      ['DEROGATION_WAITING_DIRECTOR'],
    ),
    event('important_overlap_alert', 'Alerte de chevauchement importante', [
      'OVERLAP_ALERT',
    ]),
    event('minimum_presence_alert', 'Alerte de présence minimale', [
      'MINIMUM_PRESENCE_ALERT',
    ]),
    event(
      'critical_service_presence',
      'Service avec un niveau de présence critique',
      ['CRITICAL_SERVICE_PRESENCE'],
    ),
    event(
      'important_negative_balance',
      'Alerte de solde négatif importante',
      ['NEGATIVE_BALANCE_ALERT'],
    ),
    event(
      'validator_configuration_changed',
      'Modification importante d’un remplacement ou d’un valideur de secours',
      ['VALIDATOR_CONFIGURATION_CHANGED'],
    ),
    event(
      'exceptional_closure_changed',
      'Fermeture exceptionnelle ajoutée ou modifiée',
      ['EXCEPTIONAL_CLOSURE_CHANGED'],
    ),
    event(
      'calendar_parameter_changed',
      'Jour férié ou paramètre de calendrier modifié',
      ['HOLIDAY_CHANGED', 'CALENDAR_PARAMETER_CHANGED'],
    ),
    event('periodic_report_available', 'Rapport ou synthèse périodique disponible', [
      'PERIODIC_REPORT_AVAILABLE',
    ]),
  ],

  [UserRole.ADMIN]: [
    event('user_created', 'Utilisateur créé', ['USER_CREATED']),
    event('user_activation_changed', 'Utilisateur activé ou désactivé', [
      'USER_ACTIVATION_CHANGED',
    ]),
    event('user_role_changed', 'Rôle d’un utilisateur modifié', [
      'USER_ROLE_CHANGED',
    ]),
    event('user_service_changed', 'Affectation à un service modifiée', [
      'USER_SERVICE_CHANGED',
    ]),
    event('service_created', 'Service créé', ['SERVICE_CREATED']),
    event('service_modified', 'Service modifié', ['SERVICE_MODIFIED']),
    event('service_disabled', 'Service désactivé', ['SERVICE_DISABLED']),
    event(
      'service_manager_changed',
      'Responsable principal d’un service modifié',
      ['SERVICE_MANAGER_CHANGED'],
    ),
    event(
      'backup_validator_changed',
      'Valideur de secours ajouté ou retiré',
      ['BACKUP_VALIDATOR_CHANGED'],
    ),
    event('global_setting_changed', 'Paramètre global de l’application modifié', [
      'GLOBAL_SETTING_CHANGED',
    ]),
    event('holiday_changed', 'Jour férié ajouté, modifié ou supprimé', [
      'HOLIDAY_CHANGED',
    ]),
    event(
      'exceptional_closure_changed',
      'Fermeture exceptionnelle ajoutée, modifiée ou supprimée',
      ['EXCEPTIONAL_CLOSURE_CHANGED'],
    ),
    event('export_error', 'Erreur importante lors d’un export', ['EXPORT_ERROR']),
    event(
      'document_generation_error',
      'Erreur importante de génération de document',
      ['DOCUMENT_GENERATION_ERROR'],
    ),
    event(
      'system_error',
      'Erreur système nécessitant une intervention Admin',
      ['SYSTEM_ERROR'],
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
