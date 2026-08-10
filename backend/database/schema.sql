
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 0;

DROP DATABASE IF EXISTS `gestion_conges_gmes`;
CREATE DATABASE `gestion_conges_gmes`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `gestion_conges_gmes`;

CREATE TABLE `services` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(180) NOT NULL,
  `service_type` ENUM('INTERNE','EXTERNE') NOT NULL,
  `external_company_name` VARCHAR(180) NULL,
  `primary_manager_id` BIGINT NULL,
  `validation_mode` ENUM(
    'RESPONSABLE_PUIS_RELAIS',
    'DIRECTEUR_ET_RH',
    'DIRECTEUR_SEUL',
    'SANS_VALIDATION'
  ) NOT NULL,
  `takeover_delay_days` INT NOT NULL DEFAULT 7,
  `minimum_presence` INT NULL,
  `has_minimum_presence_rule` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_services_name_company` (`name`, `external_company_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nom` VARCHAR(100) NOT NULL,
  `prenom` VARCHAR(100) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(255) NULL,
  `microsoft_id` VARCHAR(255) NULL,
  `role` ENUM(
    'COLLABORATEUR',
    'RESPONSABLE_SERVICE',
    'RH',
    'DIRECTEUR',
    'ADMIN'
  ) NOT NULL,
  `employment_type` ENUM('INTERNE','EXTERNE') NOT NULL DEFAULT 'INTERNE',
  `service_id` BIGINT NULL,
  `hire_date` DATE NULL,
  `presence_status` ENUM('PRESENT','EN_VACANCES','ABSENT') NOT NULL DEFAULT 'PRESENT',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `signature_type` VARCHAR(30) NULL,
  `signature_data` LONGTEXT NULL,
  `signature_updated_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_users_email` (`email`),
  UNIQUE KEY `UQ_users_microsoft_id` (`microsoft_id`),
  KEY `IDX_users_service_id` (`service_id`),
  CONSTRAINT `FK_users_service`
    FOREIGN KEY (`service_id`) REFERENCES `services` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `services`
  ADD KEY `IDX_services_primary_manager_id` (`primary_manager_id`),
  ADD CONSTRAINT `FK_services_primary_manager`
    FOREIGN KEY (`primary_manager_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE `leave_types` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `category` ENUM('DEMANDE_CONGE','DECLARATION_ABSENCE') NOT NULL,
  `deducts_paid_leave_balance` TINYINT(1) NOT NULL DEFAULT 0,
  `document_required` TINYINT(1) NOT NULL DEFAULT 0,
  `document_can_be_added_later` TINYINT(1) NOT NULL DEFAULT 1,
  `employee_can_create` TINYINT(1) NOT NULL DEFAULT 1,
  `rh_only` TINYINT(1) NOT NULL DEFAULT 0,
  `allows_days` TINYINT(1) NOT NULL DEFAULT 1,
  `allows_half_days` TINYINT(1) NOT NULL DEFAULT 1,
  `allows_hours` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_validation` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_leave_types_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `created_by_id` BIGINT NOT NULL,
  `leave_type_id` BIGINT NOT NULL,
  `service_id` BIGINT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `start_period` ENUM('MATIN','APRES_MIDI') NOT NULL DEFAULT 'MATIN',
  `end_period` ENUM('MATIN','APRES_MIDI') NOT NULL DEFAULT 'APRES_MIDI',
  `calendar_duration` INT NOT NULL,
  `deducted_days` DECIMAL(7,2) NOT NULL,
  `status` ENUM(
    'BROUILLON',
    'EN_ATTENTE_VALIDATION',
    'VALIDEE',
    'REFUSEE',
    'ANNULEE',
    'ANNULATION_EN_ATTENTE_ACCORD',
    'ANNULEE_APRES_VALIDATION',
    'EXPIREE_NON_VALIDEE'
  ) NOT NULL DEFAULT 'BROUILLON',
  `comment` TEXT NULL,
  `submitted_at` DATETIME NULL,
  `modification_deadline` DATE NULL,
  `real_balance_before` DECIMAL(7,2) NULL,
  `potential_balance_before` DECIMAL(7,2) NULL,
  `real_balance_after` DECIMAL(7,2) NULL,
  `final_decider_id` BIGINT NULL,
  `final_decider_role` ENUM(
    'COLLABORATEUR',
    'RESPONSABLE_SERVICE',
    'RH',
    'DIRECTEUR',
    'ADMIN'
  ) NULL,
  `decision_at` DATETIME NULL,
  `refusal_comment` TEXT NULL,
  `employee_signature_type` VARCHAR(30) NULL,
  `employee_signature_data` LONGTEXT NULL,
  `employee_signed_at` DATETIME NULL,
  `validator_signature_type` VARCHAR(30) NULL,
  `validator_signature_data` LONGTEXT NULL,
  `validator_signed_at` DATETIME NULL,
  `rh_confirmed_director_agreement` TINYINT(1) NOT NULL DEFAULT 0,
  `rh_director_agreement_confirmed_at` DATETIME NULL,
  `is_urgent` TINYINT(1) NOT NULL DEFAULT 0,
  `urgent_reason` TEXT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `locked_at` DATETIME NULL,
  `cancellation_requested_by_id` BIGINT NULL,
  `cancellation_reason` TEXT NULL,
  `employee_cancellation_consent` TINYINT(1) NULL,
  `employee_cancellation_response_at` DATETIME NULL,
  `cancelled_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_leave_requests_employee_dates` (`employee_id`,`start_date`,`end_date`),
  KEY `IDX_leave_requests_service_status` (`service_id`,`status`),
  KEY `IDX_leave_requests_status_submitted` (`status`,`submitted_at`),
  KEY `IDX_leave_requests_created_by_id` (`created_by_id`),
  KEY `IDX_leave_requests_leave_type_id` (`leave_type_id`),
  KEY `IDX_leave_requests_final_decider_id` (`final_decider_id`),
  KEY `IDX_leave_requests_cancellation_requested_by_id` (`cancellation_requested_by_id`),
  CONSTRAINT `FK_leave_requests_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_leave_requests_created_by`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_leave_requests_leave_type`
    FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_leave_requests_service`
    FOREIGN KEY (`service_id`) REFERENCES `services` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_leave_requests_final_decider`
    FOREIGN KEY (`final_decider_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_leave_requests_cancellation_requested_by`
    FOREIGN KEY (`cancellation_requested_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `absence_declarations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `created_by_id` BIGINT NOT NULL,
  `leave_type_id` BIGINT NOT NULL,
  `service_id` BIGINT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `start_period` ENUM('MATIN','APRES_MIDI') NULL,
  `end_period` ENUM('MATIN','APRES_MIDI') NULL,
  `duration_days` DECIMAL(7,2) NULL,
  `duration_hours` DECIMAL(7,2) NULL,
  `status` ENUM(
    'BROUILLON',
    'DECLAREE',
    'JUSTIFICATIF_EN_ATTENTE',
    'A_VERIFIER_PAR_RH',
    'JUSTIFICATIF_REJETE',
    'ENREGISTREE',
    'ANNULEE'
  ) NOT NULL DEFAULT 'BROUILLON',
  `comment` TEXT NULL,
  `declared_at` DATETIME NULL,
  `verified_by_rh_id` BIGINT NULL,
  `verified_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_absence_employee_dates` (`employee_id`,`start_date`,`end_date`),
  KEY `IDX_absence_status_declared` (`status`,`declared_at`),
  KEY `IDX_absence_created_by_id` (`created_by_id`),
  KEY `IDX_absence_leave_type_id` (`leave_type_id`),
  KEY `IDX_absence_service_id` (`service_id`),
  KEY `IDX_absence_verified_by_rh_id` (`verified_by_rh_id`),
  CONSTRAINT `FK_absence_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_absence_created_by`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_absence_leave_type`
    FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_absence_service`
    FOREIGN KEY (`service_id`) REFERENCES `services` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_absence_verified_by_rh`
    FOREIGN KEY (`verified_by_rh_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `documents` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `leave_request_id` BIGINT NULL,
  `absence_declaration_id` BIGINT NULL,
  `document_kind` ENUM('JUSTIFICATIF','PDF_VALIDATION','PDF_ANNULATION') NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `storage_key` VARCHAR(500) NOT NULL,
  `mime_type` VARCHAR(100) NULL,
  `file_size` BIGINT NULL,
  `status` ENUM('EN_ATTENTE','ACCEPTE','REJETE','ARCHIVE','SUPPRIME') NOT NULL DEFAULT 'EN_ATTENTE',
  `uploaded_by_id` BIGINT NOT NULL,
  `verified_by_rh_id` BIGINT NULL,
  `rejection_reason` TEXT NULL,
  `retention_until` DATE NULL,
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_documents_storage_key` (`storage_key`),
  KEY `IDX_documents_leave_request` (`leave_request_id`),
  KEY `IDX_documents_absence_declaration` (`absence_declaration_id`),
  KEY `IDX_documents_kind_status` (`document_kind`,`status`),
  KEY `IDX_documents_uploaded_by_id` (`uploaded_by_id`),
  KEY `IDX_documents_verified_by_rh_id` (`verified_by_rh_id`),
  CONSTRAINT `FK_documents_leave_request`
    FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_documents_absence_declaration`
    FOREIGN KEY (`absence_declaration_id`) REFERENCES `absence_declarations` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_documents_uploaded_by`
    FOREIGN KEY (`uploaded_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_documents_verified_by_rh`
    FOREIGN KEY (`verified_by_rh_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `derogations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `leave_type_id` BIGINT NOT NULL,
  `leave_request_id` BIGINT NULL,
  `requested_start_date` DATE NOT NULL,
  `requested_end_date` DATE NOT NULL,
  `reason` TEXT NOT NULL,
  `status` ENUM('EN_ATTENTE_RH','ACCORDEE','REFUSEE','UTILISEE','EXPIREE') NOT NULL DEFAULT 'EN_ATTENTE_RH',
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by_rh_id` BIGINT NULL,
  `decision_comment` TEXT NULL,
  `decided_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `used_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_derogations_leave_request_id` (`leave_request_id`),
  KEY `IDX_derogations_employee_status` (`employee_id`,`status`),
  KEY `IDX_derogations_status_requested` (`status`,`requested_at`),
  KEY `IDX_derogations_leave_type_id` (`leave_type_id`),
  KEY `IDX_derogations_decided_by_rh_id` (`decided_by_rh_id`),
  CONSTRAINT `FK_derogations_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_derogations_leave_type`
    FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_derogations_leave_request`
    FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_derogations_decided_by_rh`
    FOREIGN KEY (`decided_by_rh_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `leave_balances` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `reference_period` VARCHAR(20) NOT NULL,
  `counter_type` VARCHAR(20) NOT NULL,
  `acquired_days` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `reserved_days` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `consumed_days` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `available_days` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_leave_balances_employee_period_counter` (`employee_id`,`reference_period`,`counter_type`),
  CONSTRAINT `FK_leave_balances_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `balance_movements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `leave_balance_id` BIGINT NOT NULL,
  `leave_request_id` BIGINT NULL,
  `actor_id` BIGINT NULL,
  `movement_type` ENUM(
    'ACQUISITION',
    'RESERVATION',
    'LIBERATION_RESERVATION',
    'DEDUCTION',
    'CORRECTION_POSITIVE',
    'CORRECTION_NEGATIVE',
    'RECREDIT',
    'REMISE_A_ZERO'
  ) NOT NULL,
  `days` DECIMAL(7,2) NOT NULL,
  `balance_before` DECIMAL(7,2) NOT NULL,
  `balance_after` DECIMAL(7,2) NOT NULL,
  `reason` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_balance_movements_employee_created` (`employee_id`,`created_at`),
  KEY `IDX_balance_movements_leave_request` (`leave_request_id`),
  KEY `IDX_balance_movements_leave_balance_id` (`leave_balance_id`),
  KEY `IDX_balance_movements_actor_id` (`actor_id`),
  CONSTRAINT `FK_balance_movements_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_balance_movements_leave_balance`
    FOREIGN KEY (`leave_balance_id`) REFERENCES `leave_balances` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_balance_movements_leave_request`
    FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_balance_movements_actor`
    FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `holidays` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `date` DATE NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `holiday_type` ENUM('NATIONAL','MARTINIQUE','FERMETURE_GMES') NOT NULL,
  `deductible` TINYINT(1) NOT NULL DEFAULT 0,
  `source` VARCHAR(80) NULL,
  `created_by_id` BIGINT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_holidays_date_type` (`date`,`holiday_type`),
  KEY `IDX_holidays_created_by_id` (`created_by_id`),
  CONSTRAINT `FK_holidays_created_by`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(150) NOT NULL,
  `setting_value` TEXT NOT NULL,
  `description` TEXT NULL,
  `updated_by_id` BIGINT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_settings_key` (`setting_key`),
  KEY `IDX_settings_updated_by_id` (`updated_by_id`),
  CONSTRAINT `FK_settings_updated_by`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `channel` ENUM('APPLICATION','EMAIL','LES_DEUX') NOT NULL DEFAULT 'LES_DEUX',
  `type` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `leave_request_id` BIGINT NULL,
  `absence_declaration_id` BIGINT NULL,
  `derogation_id` BIGINT NULL,
  `read_at` DATETIME NULL,
  `email_sent_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_notifications_user_read` (`user_id`,`read_at`),
  KEY `IDX_notifications_type_created` (`type`,`created_at`),
  KEY `IDX_notifications_leave_request_id` (`leave_request_id`),
  KEY `IDX_notifications_absence_declaration_id` (`absence_declaration_id`),
  KEY `IDX_notifications_derogation_id` (`derogation_id`),
  CONSTRAINT `FK_notifications_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `FK_notifications_leave_request`
    FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_notifications_absence_declaration`
    FOREIGN KEY (`absence_declaration_id`) REFERENCES `absence_declarations` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `FK_notifications_derogation`
    FOREIGN KEY (`derogation_id`) REFERENCES `derogations` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actor_id` BIGINT NULL,
  `action` VARCHAR(120) NOT NULL,
  `resource_type` VARCHAR(100) NOT NULL,
  `resource_id` BIGINT NULL,
  `old_value` JSON NULL,
  `new_value` JSON NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_audit_resource` (`resource_type`,`resource_id`,`created_at`),
  KEY `IDX_audit_actor` (`actor_id`,`created_at`),
  CONSTRAINT `FK_audit_actor`
    FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `service_backup_validators` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `service_id` BIGINT NOT NULL,
  `validator_id` BIGINT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_service_backup_validators_service_validator` (`service_id`, `validator_id`),
  KEY `IDX_service_backup_validators_service_active` (`service_id`, `is_active`),
  CONSTRAINT `FK_service_backup_validators_service`
    FOREIGN KEY (`service_id`) REFERENCES `services` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_service_backup_validators_validator`
    FOREIGN KEY (`validator_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `validator_replacements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT NOT NULL,
  `replacement_validator_id` BIGINT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` TEXT NULL,
  `created_by_rh_id` BIGINT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_validator_replacements_employee_active_dates` (`employee_id`, `is_active`, `start_date`, `end_date`),
  CONSTRAINT `CHK_validator_replacements_dates` CHECK (`start_date` <= `end_date`),
  CONSTRAINT `CHK_validator_replacements_distinct` CHECK (`employee_id` <> `replacement_validator_id`),
  CONSTRAINT `FK_validator_replacements_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_validator_replacements_validator`
    FOREIGN KEY (`replacement_validator_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `FK_validator_replacements_created_by_rh`
    FOREIGN KEY (`created_by_rh_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
