
USE `gestion_conges_gmes`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('NORMAL_REQUEST_DEADLINE_DAYS', '30', 'Délai normal de dépôt d’une demande, en jours calendaires.'),
  ('SPECIAL_REQUEST_DEADLINE_DAYS', '60', 'Délai spécial de dépôt d’une demande, en jours calendaires.'),
  ('SPECIAL_DURATION_THRESHOLD_DAYS', '21', 'Durée calendaire à partir de laquelle le délai spécial s’applique.'),
  ('MODIFICATION_DEADLINE_DAYS', '7', 'Dernier délai de modification avant le départ, en jours calendaires.'),
  ('DEROGATION_LAST_ALLOWED_DAY', '3', 'Dernier jour autorisé pour une soumission avec dérogation RH.'),
  ('SUMMER_PERIOD_START', '05-01', 'Début de la période estivale, au format MM-JJ.'),
  ('SUMMER_PERIOD_END', '10-31', 'Fin de la période estivale, au format MM-JJ.'),
  ('MONTHLY_ACCRUAL_RATE', '2.5', 'Nombre de jours ouvrables acquis pour un mois complet travaillé.'),
  ('REFERENCE_PERIOD_START', '06-01', 'Début de la période de référence, au format MM-JJ.'),
  ('AFTERNOON_START_HOUR', '12:00', 'Heure de début de la période APRES_MIDI, fuseau America/Martinique. Format HH:MM. Avant cette heure : MATIN ; à partir de cette heure (inclus) : APRES_MIDI.');

INSERT INTO `services`
  (`name`, `service_type`, `external_company_name`, `primary_manager_id`, `validation_mode`, `takeover_delay_days`, `minimum_presence`, `has_minimum_presence_rule`)
VALUES
  ('Équipe Administrative', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Équipe Comptable', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Équipe Commerciale', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Équipe technique', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, 3, 1),
  ('Pôle Applicatif — Applications & Logiciels', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, 1, 1),
  ('Équipe RH', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Pôle R&D — Intelligence Artificielle', 'INTERNE', NULL, NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0);

INSERT INTO `services`
  (`name`, `service_type`, `external_company_name`, `primary_manager_id`, `validation_mode`, `takeover_delay_days`, `minimum_presence`, `has_minimum_presence_rule`)
VALUES
  ('Service Informatique', 'EXTERNE', 'GFA Caraïbes', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service SEI', 'EXTERNE', 'EDF Martinique', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service SEI MAR Clientèle Production', 'EXTERNE', 'EDF Martinique', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service SEI MAR Réseau Distribution', 'EXTERNE', 'EDF Martinique', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service de la Transformation Digitale', 'EXTERNE', 'SARA', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service Applications', 'EXTERNE', 'SARA', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service Informatique', 'EXTERNE', 'Port Maritime', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0),
  ('Service Informatique', 'EXTERNE', 'Ville de Fort-de-France', NULL, 'DIRECTEUR_ET_RH', 7, NULL, 0);

INSERT INTO `users`
  (`nom`, `prenom`, `email`, `password_hash`, `microsoft_id`, `role`, `employment_type`, `service_id`, `hire_date`, `presence_status`, `is_active`)
VALUES
  ('ADMINISTRATION', 'GMES', 'admin@gmes.fr', NULL, NULL, 'ADMIN', 'INTERNE', NULL, NULL, 'PRESENT', 1);

INSERT INTO `leave_types`
  (`name`, `category`, `deducts_paid_leave_balance`, `document_required`, `document_can_be_added_later`, `employee_can_create`, `rh_only`, `allows_days`, `allows_half_days`, `allows_hours`, `requires_validation`, `is_active`)
VALUES
  ('Congés payés', 'DEMANDE_CONGE', 1, 0, 1, 1, 0, 1, 1, 0, 1, 1),
  ('Congé sans solde', 'DEMANDE_CONGE', 0, 0, 1, 1, 0, 1, 1, 0, 1, 1);

INSERT INTO `leave_types`
  (`name`, `category`, `deducts_paid_leave_balance`, `document_required`, `document_can_be_added_later`, `employee_can_create`, `rh_only`, `allows_days`, `allows_half_days`, `allows_hours`, `requires_validation`, `is_active`)
VALUES
  ('Congé maternité', 'DECLARATION_ABSENCE', 0, 1, 1, 1, 0, 1, 1, 0, 0, 1),
  ('Congé paternité et d’accueil de l’enfant', 'DECLARATION_ABSENCE', 0, 1, 1, 1, 0, 1, 1, 0, 0, 1),
  ('Arrêt maladie', 'DECLARATION_ABSENCE', 0, 1, 1, 1, 0, 1, 1, 0, 0, 1),
  ('Enfant malade', 'DECLARATION_ABSENCE', 0, 1, 1, 1, 0, 1, 1, 0, 0, 1),
  ('Événement familial', 'DECLARATION_ABSENCE', 0, 1, 1, 1, 0, 1, 1, 0, 0, 1),
  ('Absence autorisée', 'DECLARATION_ABSENCE', 0, 0, 1, 0, 1, 1, 1, 1, 0, 1);
