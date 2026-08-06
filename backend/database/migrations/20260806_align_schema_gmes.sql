-- ============================================================================
-- GMES - Migration de mise en conformité du schéma
-- Date : 2026-08-06
-- Cible : diagramme_bdd_gestion_conges_gmes_v1_simplifie.dbml
--
-- Cette migration :
--   * conserve les données métier existantes ;
--   * renomme les colonnes camelCase en snake_case ;
--   * convertit les identifiants en BIGINT ;
--   * regroupe les PDF de generated_documents dans documents ;
--   * regroupe leave_request_history dans audit_logs ;
--   * migre une éventuelle table leave_cancellations dans leave_requests ;
--   * ajoute settings, notifications et audit_logs ;
--   * supprime uniquement les structures devenues obsolètes après copie.
--
-- IMPORTANT : exécuter d'abord le script de sauvegarde fourni.
-- ============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET SESSION group_concat_max_len = 1048576;

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_exec$$
CREATE PROCEDURE sp_exec(IN p_sql LONGTEXT)
BEGIN
  IF p_sql IS NOT NULL AND CHAR_LENGTH(TRIM(p_sql)) > 0 THEN
    SET @sql_to_run = p_sql;
    PREPARE stmt FROM @sql_to_run;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_align_column$$
CREATE PROCEDURE sp_align_column(
  IN p_table VARCHAR(64),
  IN p_old VARCHAR(64),
  IN p_new VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  DECLARE v_old_exists INT DEFAULT 0;
  DECLARE v_new_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO v_old_exists
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = p_table
    AND COLUMN_NAME = p_old;

  SELECT COUNT(*) INTO v_new_exists
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = p_table
    AND COLUMN_NAME = p_new;

  IF p_old <> p_new AND v_old_exists > 0 AND v_new_exists = 0 THEN
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', p_table, '` CHANGE COLUMN `', p_old, '` `', p_new, '` ', p_definition
    ));
  ELSEIF v_new_exists > 0 THEN
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_new, '` ', p_definition
    ));
  ELSEIF v_old_exists = 0 AND v_new_exists = 0 THEN
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', p_table, '` ADD COLUMN `', p_new, '` ', p_definition
    ));
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_drop_column_if_exists$$
CREATE PROCEDURE sp_drop_column_if_exists(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`'
    ));
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_drop_all_foreign_keys$$
CREATE PROCEDURE sp_drop_all_foreign_keys()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_table VARCHAR(64);
  DECLARE v_constraint VARCHAR(64);
  DECLARE cur CURSOR FOR
    SELECT TABLE_NAME, CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'FOREIGN KEY';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_table, v_constraint;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', v_table, '` DROP FOREIGN KEY `', v_constraint, '`'
    ));
  END LOOP;
  CLOSE cur;
END$$

DROP PROCEDURE IF EXISTS sp_drop_all_checks$$
CREATE PROCEDURE sp_drop_all_checks()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_table VARCHAR(64);
  DECLARE v_constraint VARCHAR(64);
  DECLARE cur CURSOR FOR
    SELECT TABLE_NAME, CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_TYPE = 'CHECK';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_table, v_constraint;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', v_table, '` DROP CHECK `', v_constraint, '`'
    ));
  END LOOP;
  CLOSE cur;
END$$

DROP PROCEDURE IF EXISTS sp_drop_non_primary_indexes$$
CREATE PROCEDURE sp_drop_non_primary_indexes(IN p_table VARCHAR(64))
BEGIN
  DECLARE v_clauses LONGTEXT;

  SELECT GROUP_CONCAT(
    DISTINCT CONCAT('DROP INDEX `', INDEX_NAME, '`')
    ORDER BY INDEX_NAME SEPARATOR ', '
  ) INTO v_clauses
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = p_table
    AND INDEX_NAME <> 'PRIMARY';

  IF v_clauses IS NOT NULL THEN
    CALL sp_exec(CONCAT('ALTER TABLE `', p_table, '` ', v_clauses));
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_add_index$$
CREATE PROCEDURE sp_add_index(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    CALL sp_exec(CONCAT(
      'ALTER TABLE `', p_table, '` ADD ', p_definition
    ));
  END IF;
END$$

DROP PROCEDURE IF EXISTS sp_drop_table_if_exists$$
CREATE PROCEDURE sp_drop_table_if_exists(IN p_table VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
  ) THEN
    CALL sp_exec(CONCAT('DROP TABLE `', p_table, '`'));
  END IF;
END$$

DELIMITER ;

-- 1. Tables prévues par le diagramme et absentes de l'ancienne version.
CREATE TABLE IF NOT EXISTS settings (
  id BIGINT NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(150) NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT NULL,
  updated_by_id BIGINT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY UQ_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  channel ENUM('APPLICATION','EMAIL','LES_DEUX') NOT NULL DEFAULT 'LES_DEUX',
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  leave_request_id BIGINT NULL,
  absence_declaration_id BIGINT NULL,
  derogation_id BIGINT NULL,
  read_at DATETIME NULL,
  email_sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  actor_id BIGINT NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id BIGINT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Les clés étrangères et checks sont retirés temporairement pour permettre
--    les changements de types et de noms sans suppression de données.
CALL sp_drop_all_foreign_keys();
CALL sp_drop_all_checks();

-- 3. Alignement des colonnes : users.
CALL sp_align_column('users', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('users', 'nom', 'nom', 'VARCHAR(100) NOT NULL');
CALL sp_align_column('users', 'prenom', 'prenom', 'VARCHAR(100) NOT NULL');
CALL sp_align_column('users', 'email', 'email', 'VARCHAR(190) NOT NULL');
CALL sp_align_column('users', 'passwordHash', 'password_hash', 'VARCHAR(255) NULL');
CALL sp_align_column('users', 'microsoftId', 'microsoft_id', 'VARCHAR(255) NULL');
CALL sp_align_column('users', 'role', 'role', 'ENUM(''COLLABORATEUR'',''RESPONSABLE_SERVICE'',''RH'',''DIRECTEUR'',''ADMIN'') NOT NULL');
CALL sp_align_column('users', 'employmentType', 'employment_type', 'ENUM(''INTERNE'',''EXTERNE'') NOT NULL DEFAULT ''INTERNE''');
CALL sp_align_column('users', 'serviceId', 'service_id', 'BIGINT NULL');
CALL sp_align_column('users', 'hireDate', 'hire_date', 'DATE NULL');
CALL sp_align_column('users', 'presenceStatus', 'presence_status', 'ENUM(''PRESENT'',''EN_VACANCES'',''ABSENT'') NOT NULL DEFAULT ''PRESENT''');
CALL sp_align_column('users', 'isActive', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('users', 'signatureType', 'signature_type', 'VARCHAR(30) NULL');
CALL sp_align_column('users', 'signatureData', 'signature_data', 'LONGTEXT NULL');
CALL sp_align_column('users', 'signatureUpdatedAt', 'signature_updated_at', 'DATETIME NULL');
CALL sp_align_column('users', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('users', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- 4. services.
CALL sp_align_column('services', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('services', 'name', 'name', 'VARCHAR(180) NOT NULL');
CALL sp_align_column('services', 'serviceType', 'service_type', 'ENUM(''INTERNE'',''EXTERNE'') NOT NULL');
CALL sp_align_column('services', 'externalCompanyName', 'external_company_name', 'VARCHAR(180) NULL');
CALL sp_align_column('services', 'primaryManagerId', 'primary_manager_id', 'BIGINT NULL');
CALL sp_align_column('services', 'validationMode', 'validation_mode', 'ENUM(''RESPONSABLE_PUIS_RELAIS'',''DIRECTEUR_ET_RH'',''DIRECTEUR_SEUL'',''SANS_VALIDATION'') NOT NULL DEFAULT ''DIRECTEUR_ET_RH''');
CALL sp_align_column('services', 'takeoverDelayDays', 'takeover_delay_days', 'INT NOT NULL DEFAULT 7');
CALL sp_align_column('services', 'minimumPresence', 'minimum_presence', 'INT NULL');
CALL sp_align_column('services', 'hasMinimumPresenceRule', 'has_minimum_presence_rule', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('services', 'isActive', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('services', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('services', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- 5. leave_types. Conversion temporaire de category en VARCHAR pour conserver
--    et convertir les anciennes valeurs CONGE / ABSENCE.
CALL sp_align_column('leave_types', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('leave_types', 'name', 'name', 'VARCHAR(160) NOT NULL');
CALL sp_align_column('leave_types', 'category', 'category', 'VARCHAR(40) NOT NULL');
CALL sp_align_column('leave_types', 'deductsPaidLeaveBalance', 'deducts_paid_leave_balance', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_types', 'documentRequired', 'document_required', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_types', 'documentCanBeAddedLater', 'document_can_be_added_later', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'employeeCanCreate', 'employee_can_create', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'rhOnly', 'rh_only', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_types', 'allowsDays', 'allows_days', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'allowsHalfDays', 'allows_half_days', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'allowsHours', 'allows_hours', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_types', 'requiresValidation', 'requires_validation', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'isActive', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('leave_types', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('leave_types', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

UPDATE leave_types
SET category = CASE category
  WHEN 'CONGE' THEN 'DEMANDE_CONGE'
  WHEN 'ABSENCE' THEN 'DECLARATION_ABSENCE'
  ELSE category
END;
ALTER TABLE leave_types
  MODIFY COLUMN category ENUM('DEMANDE_CONGE','DECLARATION_ABSENCE') NOT NULL;

-- 6. leave_requests.
CALL sp_align_column('leave_requests', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('leave_requests', 'employeeId', 'employee_id', 'BIGINT NOT NULL');
CALL sp_align_column('leave_requests', 'createdById', 'created_by_id', 'BIGINT NOT NULL');
CALL sp_align_column('leave_requests', 'leaveTypeId', 'leave_type_id', 'BIGINT NOT NULL');
CALL sp_align_column('leave_requests', 'serviceId', 'service_id', 'BIGINT NOT NULL');
CALL sp_align_column('leave_requests', 'startDate', 'start_date', 'DATE NOT NULL');
CALL sp_align_column('leave_requests', 'endDate', 'end_date', 'DATE NOT NULL');
CALL sp_align_column('leave_requests', 'startPeriod', 'start_period', 'ENUM(''MATIN'',''APRES_MIDI'') NOT NULL DEFAULT ''MATIN''');
CALL sp_align_column('leave_requests', 'endPeriod', 'end_period', 'ENUM(''MATIN'',''APRES_MIDI'') NOT NULL DEFAULT ''APRES_MIDI''');
CALL sp_align_column('leave_requests', 'calendarDuration', 'calendar_duration', 'INT NOT NULL');
CALL sp_align_column('leave_requests', 'deductedDays', 'deducted_days', 'DECIMAL(7,2) NOT NULL');
CALL sp_align_column('leave_requests', 'status', 'status', 'ENUM(''BROUILLON'',''EN_ATTENTE_VALIDATION'',''VALIDEE'',''REFUSEE'',''ANNULEE'',''ANNULATION_EN_ATTENTE_ACCORD'',''ANNULEE_APRES_VALIDATION'',''EXPIREE_NON_VALIDEE'') NOT NULL DEFAULT ''BROUILLON''');
CALL sp_align_column('leave_requests', 'comment', 'comment', 'TEXT NULL');
CALL sp_align_column('leave_requests', 'submittedAt', 'submitted_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'modificationDeadline', 'modification_deadline', 'DATE NULL');
CALL sp_align_column('leave_requests', 'realBalanceBefore', 'real_balance_before', 'DECIMAL(7,2) NULL');
CALL sp_align_column('leave_requests', 'potentialBalanceBefore', 'potential_balance_before', 'DECIMAL(7,2) NULL');
CALL sp_align_column('leave_requests', 'realBalanceAfter', 'real_balance_after', 'DECIMAL(7,2) NULL');
CALL sp_align_column('leave_requests', 'finalDeciderId', 'final_decider_id', 'BIGINT NULL');
CALL sp_align_column('leave_requests', 'finalDeciderRole', 'final_decider_role', 'ENUM(''COLLABORATEUR'',''RESPONSABLE_SERVICE'',''RH'',''DIRECTEUR'',''ADMIN'') NULL');
CALL sp_align_column('leave_requests', 'decisionAt', 'decision_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'refusalComment', 'refusal_comment', 'TEXT NULL');
CALL sp_align_column('leave_requests', 'employeeSignatureType', 'employee_signature_type', 'VARCHAR(30) NULL');
CALL sp_align_column('leave_requests', 'employeeSignatureData', 'employee_signature_data', 'LONGTEXT NULL');
CALL sp_align_column('leave_requests', 'employeeSignedAt', 'employee_signed_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'validatorSignatureType', 'validator_signature_type', 'VARCHAR(30) NULL');
CALL sp_align_column('leave_requests', 'validatorSignatureData', 'validator_signature_data', 'LONGTEXT NULL');
CALL sp_align_column('leave_requests', 'validatorSignedAt', 'validator_signed_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'rhConfirmedDirectorAgreement', 'rh_confirmed_director_agreement', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_requests', 'rhDirectorAgreementConfirmedAt', 'rh_director_agreement_confirmed_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'isUrgent', 'is_urgent', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_requests', 'urgentReason', 'urgent_reason', 'TEXT NULL');
CALL sp_align_column('leave_requests', 'version', 'version', 'INT NOT NULL DEFAULT 1');
CALL sp_align_column('leave_requests', 'lockedAt', 'locked_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'cancellationRequestedById', 'cancellation_requested_by_id', 'BIGINT NULL');
CALL sp_align_column('leave_requests', 'cancellationReason', 'cancellation_reason', 'TEXT NULL');
CALL sp_align_column('leave_requests', 'employeeCancellationConsent', 'employee_cancellation_consent', 'TINYINT(1) NULL');
CALL sp_align_column('leave_requests', 'employeeCancellationResponseAt', 'employee_cancellation_response_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'cancelledAt', 'cancelled_at', 'DATETIME NULL');
CALL sp_align_column('leave_requests', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('leave_requests', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- 7. absence_declarations.
CALL sp_align_column('absence_declarations', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('absence_declarations', 'employeeId', 'employee_id', 'BIGINT NOT NULL');
CALL sp_align_column('absence_declarations', 'createdById', 'created_by_id', 'BIGINT NOT NULL');
CALL sp_align_column('absence_declarations', 'leaveTypeId', 'leave_type_id', 'BIGINT NOT NULL');
CALL sp_align_column('absence_declarations', 'serviceId', 'service_id', 'BIGINT NOT NULL');
CALL sp_align_column('absence_declarations', 'startDate', 'start_date', 'DATE NOT NULL');
CALL sp_align_column('absence_declarations', 'endDate', 'end_date', 'DATE NOT NULL');
CALL sp_align_column('absence_declarations', 'startPeriod', 'start_period', 'ENUM(''MATIN'',''APRES_MIDI'') NULL');
CALL sp_align_column('absence_declarations', 'endPeriod', 'end_period', 'ENUM(''MATIN'',''APRES_MIDI'') NULL');
CALL sp_align_column('absence_declarations', 'durationDays', 'duration_days', 'DECIMAL(7,2) NULL');
CALL sp_align_column('absence_declarations', 'durationHours', 'duration_hours', 'DECIMAL(7,2) NULL');
CALL sp_align_column('absence_declarations', 'status', 'status', 'ENUM(''BROUILLON'',''DECLAREE'',''JUSTIFICATIF_EN_ATTENTE'',''A_VERIFIER_PAR_RH'',''JUSTIFICATIF_REJETE'',''ENREGISTREE'',''ANNULEE'') NOT NULL DEFAULT ''BROUILLON''');
CALL sp_align_column('absence_declarations', 'comment', 'comment', 'TEXT NULL');
CALL sp_align_column('absence_declarations', 'declaredAt', 'declared_at', 'DATETIME NULL');
CALL sp_align_column('absence_declarations', 'verifiedByRhId', 'verified_by_rh_id', 'BIGINT NULL');
CALL sp_align_column('absence_declarations', 'verifiedAt', 'verified_at', 'DATETIME NULL');
CALL sp_align_column('absence_declarations', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('absence_declarations', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- 8. documents.
CALL sp_align_column('documents', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('documents', 'leaveRequestId', 'leave_request_id', 'BIGINT NULL');
CALL sp_align_column('documents', 'absenceDeclarationId', 'absence_declaration_id', 'BIGINT NULL');
CALL sp_align_column('documents', 'documentKind', 'document_kind', 'ENUM(''JUSTIFICATIF'',''PDF_VALIDATION'',''PDF_ANNULATION'') NOT NULL DEFAULT ''JUSTIFICATIF''');
CALL sp_align_column('documents', 'originalName', 'original_name', 'VARCHAR(255) NULL');
CALL sp_align_column('documents', 'storageKey', 'storage_key', 'VARCHAR(500) NOT NULL');
CALL sp_align_column('documents', 'mimeType', 'mime_type', 'VARCHAR(100) NULL');
CALL sp_align_column('documents', 'fileSize', 'file_size', 'BIGINT NULL');
CALL sp_align_column('documents', 'status', 'status', 'ENUM(''EN_ATTENTE'',''ACCEPTE'',''REJETE'',''ARCHIVE'',''SUPPRIME'') NOT NULL DEFAULT ''EN_ATTENTE''');
CALL sp_align_column('documents', 'uploadedById', 'uploaded_by_id', 'BIGINT NOT NULL');
CALL sp_align_column('documents', 'verifiedByRhId', 'verified_by_rh_id', 'BIGINT NULL');
CALL sp_align_column('documents', 'rejectionReason', 'rejection_reason', 'TEXT NULL');
CALL sp_align_column('documents', 'retentionUntil', 'retention_until', 'DATE NULL');
CALL sp_align_column('documents', 'uploadedAt', 'uploaded_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('documents', 'verifiedAt', 'verified_at', 'DATETIME NULL');
CALL sp_align_column('documents', 'deletedAt', 'deleted_at', 'DATETIME NULL');

-- 9. derogations. Les anciens BROUILLON sont transmis en EN_ATTENTE_RH.
CALL sp_align_column('derogations', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('derogations', 'employee_id', 'employee_id', 'BIGINT NOT NULL');
CALL sp_align_column('derogations', 'leave_type_id', 'leave_type_id', 'BIGINT NOT NULL');
CALL sp_align_column('derogations', 'leave_request_id', 'leave_request_id', 'BIGINT NULL');
CALL sp_align_column('derogations', 'requested_start_date', 'requested_start_date', 'DATE NOT NULL');
CALL sp_align_column('derogations', 'requested_end_date', 'requested_end_date', 'DATE NOT NULL');
CALL sp_align_column('derogations', 'reason', 'reason', 'TEXT NOT NULL');
CALL sp_align_column('derogations', 'status', 'status', 'VARCHAR(40) NOT NULL');
CALL sp_align_column('derogations', 'requested_at', 'requested_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL sp_align_column('derogations', 'decided_by_rh_id', 'decided_by_rh_id', 'BIGINT NULL');
CALL sp_align_column('derogations', 'decision_comment', 'decision_comment', 'TEXT NULL');
CALL sp_align_column('derogations', 'decided_at', 'decided_at', 'DATETIME NULL');
CALL sp_align_column('derogations', 'expires_at', 'expires_at', 'DATETIME NULL');
CALL sp_align_column('derogations', 'used_at', 'used_at', 'DATETIME NULL');
UPDATE derogations SET status = 'EN_ATTENTE_RH' WHERE status = 'BROUILLON';
ALTER TABLE derogations
  MODIFY COLUMN status ENUM('EN_ATTENTE_RH','ACCORDEE','REFUSEE','UTILISEE','EXPIREE') NOT NULL DEFAULT 'EN_ATTENTE_RH';

-- 10. leave_balances et balance_movements.
CALL sp_align_column('leave_balances', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('leave_balances', 'employee_id', 'employee_id', 'BIGINT NOT NULL');
CALL sp_align_column('leave_balances', 'reference_period', 'reference_period', 'VARCHAR(20) NOT NULL');
CALL sp_align_column('leave_balances', 'counter_type', 'counter_type', 'VARCHAR(20) NOT NULL');
CALL sp_align_column('leave_balances', 'acquired_days', 'acquired_days', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_balances', 'reserved_days', 'reserved_days', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_balances', 'consumed_days', 'consumed_days', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_balances', 'available_days', 'available_days', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
CALL sp_align_column('leave_balances', 'updated_at', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

CALL sp_align_column('balance_movements', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('balance_movements', 'employee_id', 'employee_id', 'BIGINT NOT NULL');
CALL sp_align_column('balance_movements', 'leave_balance_id', 'leave_balance_id', 'BIGINT NOT NULL');
CALL sp_align_column('balance_movements', 'leave_request_id', 'leave_request_id', 'BIGINT NULL');
CALL sp_align_column('balance_movements', 'actor_id', 'actor_id', 'BIGINT NULL');
CALL sp_align_column('balance_movements', 'movement_type', 'movement_type', 'ENUM(''ACQUISITION'',''RESERVATION'',''LIBERATION_RESERVATION'',''DEDUCTION'',''CORRECTION_POSITIVE'',''CORRECTION_NEGATIVE'',''RECREDIT'',''REMISE_A_ZERO'') NOT NULL');
CALL sp_align_column('balance_movements', 'days', 'days', 'DECIMAL(7,2) NOT NULL');
CALL sp_align_column('balance_movements', 'balance_before', 'balance_before', 'DECIMAL(7,2) NOT NULL');
CALL sp_align_column('balance_movements', 'balance_after', 'balance_after', 'DECIMAL(7,2) NOT NULL');
CALL sp_align_column('balance_movements', 'reason', 'reason', 'TEXT NULL');
CALL sp_align_column('balance_movements', 'created_at', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

-- 11. holidays.
CALL sp_align_column('holidays', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('holidays', 'date', 'date', 'DATE NOT NULL');
CALL sp_align_column('holidays', 'name', 'name', 'VARCHAR(180) NOT NULL');
CALL sp_align_column('holidays', 'holidayType', 'holiday_type', 'ENUM(''NATIONAL'',''MARTINIQUE'',''FERMETURE_GMES'') NOT NULL');
CALL sp_align_column('holidays', 'deductible', 'deductible', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_align_column('holidays', 'source', 'source', 'VARCHAR(80) NULL');
CALL sp_align_column('holidays', 'createdById', 'created_by_id', 'BIGINT NULL');
CALL sp_align_column('holidays', 'isActive', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_align_column('holidays', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

-- 12. Alignement des trois nouvelles tables si elles existaient déjà sous une
--     forme intermédiaire.
CALL sp_align_column('settings', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('settings', 'settingKey', 'setting_key', 'VARCHAR(150) NOT NULL');
CALL sp_align_column('settings', 'settingValue', 'setting_value', 'TEXT NOT NULL');
CALL sp_align_column('settings', 'description', 'description', 'TEXT NULL');
CALL sp_align_column('settings', 'updatedById', 'updated_by_id', 'BIGINT NULL');
CALL sp_align_column('settings', 'updatedAt', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

CALL sp_align_column('notifications', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('notifications', 'userId', 'user_id', 'BIGINT NOT NULL');
CALL sp_align_column('notifications', 'channel', 'channel', 'ENUM(''APPLICATION'',''EMAIL'',''LES_DEUX'') NOT NULL DEFAULT ''LES_DEUX''');
CALL sp_align_column('notifications', 'type', 'type', 'VARCHAR(100) NOT NULL');
CALL sp_align_column('notifications', 'title', 'title', 'VARCHAR(255) NOT NULL');
CALL sp_align_column('notifications', 'message', 'message', 'TEXT NOT NULL');
CALL sp_align_column('notifications', 'leaveRequestId', 'leave_request_id', 'BIGINT NULL');
CALL sp_align_column('notifications', 'absenceDeclarationId', 'absence_declaration_id', 'BIGINT NULL');
CALL sp_align_column('notifications', 'derogationId', 'derogation_id', 'BIGINT NULL');
CALL sp_align_column('notifications', 'readAt', 'read_at', 'DATETIME NULL');
CALL sp_align_column('notifications', 'emailSentAt', 'email_sent_at', 'DATETIME NULL');
CALL sp_align_column('notifications', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

CALL sp_align_column('audit_logs', 'id', 'id', 'BIGINT NOT NULL AUTO_INCREMENT');
CALL sp_align_column('audit_logs', 'actorId', 'actor_id', 'BIGINT NULL');
CALL sp_align_column('audit_logs', 'action', 'action', 'VARCHAR(120) NOT NULL');
CALL sp_align_column('audit_logs', 'resourceType', 'resource_type', 'VARCHAR(100) NOT NULL');
CALL sp_align_column('audit_logs', 'resourceId', 'resource_id', 'BIGINT NULL');
CALL sp_align_column('audit_logs', 'oldValue', 'old_value', 'JSON NULL');
CALL sp_align_column('audit_logs', 'newValue', 'new_value', 'JSON NULL');
CALL sp_align_column('audit_logs', 'ipAddress', 'ip_address', 'VARCHAR(64) NULL');
CALL sp_align_column('audit_logs', 'createdAt', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

-- 13. Conservation des anciens réglages de type avant suppression des colonnes
--     non présentes dans le diagramme.
SET @has_legacy_leave_type_columns = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_types'
    AND COLUMN_NAME IN (
      'requiresEmployeeSignature', 'requires_employee_signature',
      'accrualMode', 'accrual_mode',
      'monthlyAccrualDays', 'monthly_accrual_days'
    )
);

-- Les colonnes sont normalisées temporairement pour pouvoir copier leurs valeurs.
CALL sp_align_column('leave_types', 'requiresEmployeeSignature', 'requires_employee_signature', 'TINYINT(1) NULL');
CALL sp_align_column('leave_types', 'accrualMode', 'accrual_mode', 'VARCHAR(30) NULL');
CALL sp_align_column('leave_types', 'monthlyAccrualDays', 'monthly_accrual_days', 'DECIMAL(4,2) NULL');

INSERT INTO audit_logs (
  actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
)
SELECT
  NULL,
  'MIGRATION_LEAVE_TYPE_PARAMETERS',
  'LEAVE_TYPE',
  lt.id,
  JSON_OBJECT(
    'requires_employee_signature', lt.requires_employee_signature,
    'accrual_mode', lt.accrual_mode,
    'monthly_accrual_days', lt.monthly_accrual_days
  ),
  JSON_OBJECT(
    'signature_rule', 'Toute demande de congé est signée selon le workflow',
    'monthly_rate_setting', 'MONTHLY_ACCRUAL_RATE'
  ),
  NULL,
  NOW()
FROM leave_types lt
WHERE @has_legacy_leave_type_columns > 0;

INSERT INTO settings (setting_key, setting_value, description, updated_by_id, updated_at)
SELECT
  'MONTHLY_ACCRUAL_RATE',
  COALESCE(
    CAST(MAX(CASE WHEN deducts_paid_leave_balance = 1 THEN monthly_accrual_days END) AS CHAR),
    '2.5'
  ),
  'Nombre de jours ouvrables acquis pour un mois complet travaillé.',
  NULL,
  NOW()
FROM leave_types
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description),
  updated_at = VALUES(updated_at);

-- 14. Préservation des informations mensuelles avant retrait des deux colonnes
--     non présentes dans balance_movements du diagramme.
-- Les anciennes versions ont pu utiliser camelCase ou snake_case.
-- Les colonnes sont ajoutées temporairement si elles n'existaient pas afin que
-- les requêtes de préservation restent exécutables dans tous les cas.
CALL sp_align_column('balance_movements', 'accrualMonth', 'accrual_month', 'VARCHAR(7) NULL');
CALL sp_align_column('balance_movements', 'effectiveDate', 'effective_date', 'DATE NULL');
SET @has_accrual_month = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'balance_movements'
    AND COLUMN_NAME = 'accrual_month'
);
SET @has_effective_date = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'balance_movements'
    AND COLUMN_NAME = 'effective_date'
);

INSERT INTO audit_logs (
  actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
)
SELECT
  actor_id,
  'MIGRATION_ACQUISITION_MONTH_METADATA',
  'BALANCE_MOVEMENT',
  id,
  JSON_OBJECT('accrual_month', accrual_month, 'effective_date', effective_date),
  JSON_OBJECT('month_preserved_in_reason', reason, 'effective_date_preserved_in_created_at', effective_date),
  NULL,
  NOW()
FROM balance_movements
WHERE @has_accrual_month > 0
  AND movement_type = 'ACQUISITION'
  AND accrual_month IS NOT NULL;

UPDATE balance_movements
SET
  reason = CASE
    WHEN accrual_month IS NOT NULL AND (reason IS NULL OR reason NOT LIKE CONCAT('%', accrual_month, '%'))
      THEN CONCAT(COALESCE(reason, 'Acquisition mensuelle'), ' [mois ', accrual_month, ']')
    ELSE reason
  END,
  created_at = CASE
    WHEN effective_date IS NOT NULL THEN TIMESTAMP(effective_date, '23:59:59')
    ELSE created_at
  END
WHERE @has_accrual_month > 0 OR @has_effective_date > 0;

-- 15. Migration d'une éventuelle table leave_cancellations vers les colonnes
--     intégrées à leave_requests.
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_migrate_leave_cancellations$$
CREATE PROCEDURE sp_migrate_leave_cancellations()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_cancellations'
  ) THEN
    UPDATE leave_requests lr
    INNER JOIN leave_cancellations lc ON lc.leave_request_id = lr.id
    SET
      lr.cancellation_requested_by_id = lc.initiated_by_id,
      lr.cancellation_reason = lc.reason,
      lr.employee_cancellation_consent = lc.employee_consent,
      lr.employee_cancellation_response_at = lc.employee_response_at,
      lr.cancelled_at = CASE WHEN lc.status = 'TERMINEE' THEN lc.completed_at ELSE lr.cancelled_at END,
      lr.status = CASE
        WHEN lc.status = 'TERMINEE' THEN 'ANNULEE_APRES_VALIDATION'
        WHEN lc.status = 'REFUSEE' THEN 'VALIDEE'
        ELSE 'ANNULATION_EN_ATTENTE_ACCORD'
      END,
      lr.updated_at = NOW();

    INSERT INTO audit_logs (
      actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
    )
    SELECT
      lc.initiated_by_id,
      'MIGRATION_LEAVE_CANCELLATION',
      'LEAVE_REQUEST',
      lc.leave_request_id,
      JSON_OBJECT(
        'legacy_cancellation_id', lc.id,
        'legacy_status', lc.status,
        'balance_movement_id', lc.balance_movement_id
      ),
      JSON_OBJECT(
        'cancellation_requested_by_id', lc.initiated_by_id,
        'employee_cancellation_consent', lc.employee_consent,
        'cancelled_at', lc.completed_at
      ),
      NULL,
      COALESCE(lc.completed_at, lc.created_at, NOW())
    FROM leave_cancellations lc;
  END IF;
END$$
DELIMITER ;
CALL sp_migrate_leave_cancellations();

-- 16. Migration de l'historique spécialisé vers audit_logs.
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_migrate_leave_request_history$$
CREATE PROCEDURE sp_migrate_leave_request_history()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_request_history'
  ) THEN
    INSERT INTO audit_logs (
      actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
    )
    SELECT
      actor_id,
      action,
      'LEAVE_REQUEST',
      leave_request_id,
      JSON_OBJECT('status', old_status),
      JSON_OBJECT('status', new_status, 'comment', comment, 'metadata', metadata),
      NULL,
      created_at
    FROM leave_request_history;
  END IF;
END$$
DELIMITER ;
CALL sp_migrate_leave_request_history();

-- 17. Migration de generated_documents dans documents.
DELIMITER $$
DROP PROCEDURE IF EXISTS sp_migrate_generated_documents$$
CREATE PROCEDURE sp_migrate_generated_documents()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'generated_documents'
  ) THEN
    -- Normalisation des noms de colonnes de la table héritée.
    CALL sp_align_column('generated_documents', 'leaveRequestId', 'leave_request_id', 'BIGINT NOT NULL');
    CALL sp_align_column('generated_documents', 'leaveCancellationId', 'leave_cancellation_id', 'BIGINT NULL');
    CALL sp_align_column('generated_documents', 'documentType', 'document_type', 'VARCHAR(40) NOT NULL');
    CALL sp_align_column('generated_documents', 'referenceNumber', 'reference_number', 'VARCHAR(100) NULL');
    CALL sp_align_column('generated_documents', 'storageKey', 'storage_key', 'VARCHAR(500) NOT NULL');
    CALL sp_align_column('generated_documents', 'checksum', 'checksum', 'VARCHAR(255) NULL');
    CALL sp_align_column('generated_documents', 'generatedAt', 'generated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    CALL sp_align_column('generated_documents', 'generatedByUserId', 'generated_by_user_id', 'BIGINT NULL');

    INSERT INTO documents (
      leave_request_id,
      absence_declaration_id,
      document_kind,
      original_name,
      storage_key,
      mime_type,
      file_size,
      status,
      uploaded_by_id,
      verified_by_rh_id,
      rejection_reason,
      retention_until,
      uploaded_at,
      verified_at,
      deleted_at
    )
    SELECT
      gd.leave_request_id,
      NULL,
      CASE gd.document_type
        WHEN 'VALIDATION_PDF' THEN 'PDF_VALIDATION'
        WHEN 'CANCELLATION_PDF' THEN 'PDF_ANNULATION'
        ELSE 'PDF_VALIDATION'
      END,
      CASE
        WHEN gd.reference_number IS NULL THEN NULL
        WHEN gd.reference_number LIKE '%.pdf' THEN gd.reference_number
        ELSE CONCAT(gd.reference_number, '.pdf')
      END,
      gd.storage_key,
      'application/pdf',
      NULL,
      'ACCEPTE',
      COALESCE(gd.generated_by_user_id, lr.final_decider_id, lr.employee_id),
      NULL,
      NULL,
      NULL,
      gd.generated_at,
      NULL,
      NULL
    FROM generated_documents gd
    INNER JOIN leave_requests lr ON lr.id = gd.leave_request_id
    LEFT JOIN documents d ON d.storage_key = gd.storage_key
    WHERE d.id IS NULL;

    INSERT INTO audit_logs (
      actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
    )
    SELECT
      gd.generated_by_user_id,
      'MIGRATION_GENERATED_DOCUMENT',
      'LEAVE_REQUEST',
      gd.leave_request_id,
      JSON_OBJECT(
        'generated_document_id', gd.id,
        'document_type', gd.document_type,
        'reference_number', gd.reference_number,
        'checksum', gd.checksum
      ),
      JSON_OBJECT('storage_key', gd.storage_key, 'target_table', 'documents'),
      NULL,
      gd.generated_at
    FROM generated_documents gd;
  END IF;
END$$
DELIMITER ;
CALL sp_migrate_generated_documents();

-- 18. Paramètres standards du diagramme.
INSERT INTO settings (setting_key, setting_value, description, updated_by_id, updated_at) VALUES
  ('NORMAL_REQUEST_DEADLINE_DAYS', '30', 'Délai normal de dépôt en jours calendaires.', NULL, NOW()),
  ('SPECIAL_REQUEST_DEADLINE_DAYS', '60', 'Délai spécial de dépôt en jours calendaires.', NULL, NOW()),
  ('SPECIAL_DURATION_THRESHOLD_DAYS', '21', 'Durée calendaire déclenchant le délai spécial.', NULL, NOW()),
  ('MODIFICATION_DEADLINE_DAYS', '7', 'Dernier délai de modification avant le départ.', NULL, NOW()),
  ('DEROGATION_LAST_ALLOWED_DAY', '3', 'Dernier jour autorisé avec dérogation RH.', NULL, NOW()),
  ('SUMMER_PERIOD_START', '05-01', 'Début de la période estivale.', NULL, NOW()),
  ('SUMMER_PERIOD_END', '10-31', 'Fin de la période estivale.', NULL, NOW()),
  ('REFERENCE_PERIOD_START', '06-01', 'Début de la période annuelle de référence.', NULL, NOW())
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  updated_at = VALUES(updated_at);

-- 19. Suppression des colonnes et tables devenues obsolètes, seulement après
--     copie de leurs informations utiles.
CALL sp_drop_column_if_exists('users', 'passwordResetTokenHash');
CALL sp_drop_column_if_exists('users', 'password_reset_token_hash');
CALL sp_drop_column_if_exists('users', 'passwordResetTokenExpiresAt');
CALL sp_drop_column_if_exists('users', 'password_reset_token_expires_at');

CALL sp_drop_column_if_exists('leave_types', 'requires_employee_signature');
CALL sp_drop_column_if_exists('leave_types', 'accrual_mode');
CALL sp_drop_column_if_exists('leave_types', 'monthly_accrual_days');

CALL sp_drop_column_if_exists('balance_movements', 'accrual_month');
CALL sp_drop_column_if_exists('balance_movements', 'effective_date');
CALL sp_drop_column_if_exists('holidays', 'updatedAt');
CALL sp_drop_column_if_exists('holidays', 'updated_at');

CALL sp_drop_table_if_exists('leave_request_history');
CALL sp_drop_table_if_exists('generated_documents');
CALL sp_drop_table_if_exists('leave_cancellations');

-- 20. Recréation exacte des index du diagramme.
CALL sp_drop_non_primary_indexes('users');
CALL sp_drop_non_primary_indexes('services');
CALL sp_drop_non_primary_indexes('leave_types');
CALL sp_drop_non_primary_indexes('leave_requests');
CALL sp_drop_non_primary_indexes('absence_declarations');
CALL sp_drop_non_primary_indexes('documents');
CALL sp_drop_non_primary_indexes('derogations');
CALL sp_drop_non_primary_indexes('leave_balances');
CALL sp_drop_non_primary_indexes('balance_movements');
CALL sp_drop_non_primary_indexes('holidays');
CALL sp_drop_non_primary_indexes('settings');
CALL sp_drop_non_primary_indexes('notifications');
CALL sp_drop_non_primary_indexes('audit_logs');

CALL sp_add_index('users', 'UQ_users_email', 'UNIQUE INDEX `UQ_users_email` (`email`)');
CALL sp_add_index('users', 'UQ_users_microsoft_id', 'UNIQUE INDEX `UQ_users_microsoft_id` (`microsoft_id`)');
CALL sp_add_index('services', 'UQ_services_name_company', 'UNIQUE INDEX `UQ_services_name_company` (`name`, `external_company_name`)');
CALL sp_add_index('leave_types', 'UQ_leave_types_name', 'UNIQUE INDEX `UQ_leave_types_name` (`name`)');
CALL sp_add_index('leave_requests', 'IDX_leave_requests_employee_dates', 'INDEX `IDX_leave_requests_employee_dates` (`employee_id`, `start_date`, `end_date`)');
CALL sp_add_index('leave_requests', 'IDX_leave_requests_service_status', 'INDEX `IDX_leave_requests_service_status` (`service_id`, `status`)');
CALL sp_add_index('leave_requests', 'IDX_leave_requests_status_submitted', 'INDEX `IDX_leave_requests_status_submitted` (`status`, `submitted_at`)');
CALL sp_add_index('absence_declarations', 'IDX_absence_employee_dates', 'INDEX `IDX_absence_employee_dates` (`employee_id`, `start_date`, `end_date`)');
CALL sp_add_index('absence_declarations', 'IDX_absence_status_declared', 'INDEX `IDX_absence_status_declared` (`status`, `declared_at`)');
CALL sp_add_index('documents', 'UQ_documents_storage_key', 'UNIQUE INDEX `UQ_documents_storage_key` (`storage_key`)');
CALL sp_add_index('documents', 'IDX_documents_leave_request', 'INDEX `IDX_documents_leave_request` (`leave_request_id`)');
CALL sp_add_index('documents', 'IDX_documents_absence_declaration', 'INDEX `IDX_documents_absence_declaration` (`absence_declaration_id`)');
CALL sp_add_index('documents', 'IDX_documents_kind_status', 'INDEX `IDX_documents_kind_status` (`document_kind`, `status`)');
CALL sp_add_index('derogations', 'UQ_derogations_leave_request', 'UNIQUE INDEX `UQ_derogations_leave_request` (`leave_request_id`)');
CALL sp_add_index('derogations', 'IDX_derogations_employee_status', 'INDEX `IDX_derogations_employee_status` (`employee_id`, `status`)');
CALL sp_add_index('derogations', 'IDX_derogations_status_requested', 'INDEX `IDX_derogations_status_requested` (`status`, `requested_at`)');
CALL sp_add_index('leave_balances', 'UQ_leave_balances_employee_period_counter', 'UNIQUE INDEX `UQ_leave_balances_employee_period_counter` (`employee_id`, `reference_period`, `counter_type`)');
CALL sp_add_index('balance_movements', 'IDX_balance_movements_employee_created', 'INDEX `IDX_balance_movements_employee_created` (`employee_id`, `created_at`)');
CALL sp_add_index('balance_movements', 'IDX_balance_movements_leave_request', 'INDEX `IDX_balance_movements_leave_request` (`leave_request_id`)');
CALL sp_add_index('holidays', 'UQ_holidays_date_type', 'UNIQUE INDEX `UQ_holidays_date_type` (`date`, `holiday_type`)');
CALL sp_add_index('settings', 'UQ_settings_key', 'UNIQUE INDEX `UQ_settings_key` (`setting_key`)');
CALL sp_add_index('notifications', 'IDX_notifications_user_read', 'INDEX `IDX_notifications_user_read` (`user_id`, `read_at`)');
CALL sp_add_index('notifications', 'IDX_notifications_type_created', 'INDEX `IDX_notifications_type_created` (`type`, `created_at`)');
CALL sp_add_index('audit_logs', 'IDX_audit_resource', 'INDEX `IDX_audit_resource` (`resource_type`, `resource_id`, `created_at`)');
CALL sp_add_index('audit_logs', 'IDX_audit_actor', 'INDEX `IDX_audit_actor` (`actor_id`, `created_at`)');

-- 21. Clés étrangères du diagramme.
ALTER TABLE users
  ADD CONSTRAINT FK_users_service
  FOREIGN KEY (service_id) REFERENCES services(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE services
  ADD CONSTRAINT FK_services_primary_manager
  FOREIGN KEY (primary_manager_id) REFERENCES users(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE leave_requests
  ADD CONSTRAINT FK_leave_requests_employee
    FOREIGN KEY (employee_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_leave_requests_created_by
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_leave_requests_leave_type
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_leave_requests_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_leave_requests_final_decider
    FOREIGN KEY (final_decider_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT FK_leave_requests_cancellation_requester
    FOREIGN KEY (cancellation_requested_by_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE absence_declarations
  ADD CONSTRAINT FK_absence_employee
    FOREIGN KEY (employee_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_absence_created_by
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_absence_leave_type
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_absence_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_absence_verified_by_rh
    FOREIGN KEY (verified_by_rh_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE documents
  ADD CONSTRAINT FK_documents_leave_request
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_documents_absence_declaration
    FOREIGN KEY (absence_declaration_id) REFERENCES absence_declarations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_documents_uploaded_by
    FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_documents_verified_by_rh
    FOREIGN KEY (verified_by_rh_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE derogations
  ADD CONSTRAINT FK_derogations_employee
    FOREIGN KEY (employee_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_derogations_leave_type
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_derogations_leave_request
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT FK_derogations_decided_by_rh
    FOREIGN KEY (decided_by_rh_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE leave_balances
  ADD CONSTRAINT FK_leave_balances_employee
  FOREIGN KEY (employee_id) REFERENCES users(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE balance_movements
  ADD CONSTRAINT FK_balance_movements_employee
    FOREIGN KEY (employee_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_balance_movements_leave_balance
    FOREIGN KEY (leave_balance_id) REFERENCES leave_balances(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT FK_balance_movements_leave_request
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT FK_balance_movements_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE holidays
  ADD CONSTRAINT FK_holidays_created_by
  FOREIGN KEY (created_by_id) REFERENCES users(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE settings
  ADD CONSTRAINT FK_settings_updated_by
  FOREIGN KEY (updated_by_id) REFERENCES users(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE notifications
  ADD CONSTRAINT FK_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT FK_notifications_leave_request
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT FK_notifications_absence
    FOREIGN KEY (absence_declaration_id) REFERENCES absence_declarations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT FK_notifications_derogation
    FOREIGN KEY (derogation_id) REFERENCES derogations(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE audit_logs
  ADD CONSTRAINT FK_audit_logs_actor
  FOREIGN KEY (actor_id) REFERENCES users(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- 22. Contrôles de fin de migration.
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'services', COUNT(*) FROM services
UNION ALL SELECT 'leave_types', COUNT(*) FROM leave_types
UNION ALL SELECT 'leave_requests', COUNT(*) FROM leave_requests
UNION ALL SELECT 'absence_declarations', COUNT(*) FROM absence_declarations
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'derogations', COUNT(*) FROM derogations
UNION ALL SELECT 'leave_balances', COUNT(*) FROM leave_balances
UNION ALL SELECT 'balance_movements', COUNT(*) FROM balance_movements
UNION ALL SELECT 'holidays', COUNT(*) FROM holidays
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- Nettoyage des procédures temporaires.
DROP PROCEDURE IF EXISTS sp_migrate_generated_documents;
DROP PROCEDURE IF EXISTS sp_migrate_leave_request_history;
DROP PROCEDURE IF EXISTS sp_migrate_leave_cancellations;
DROP PROCEDURE IF EXISTS sp_drop_table_if_exists;
DROP PROCEDURE IF EXISTS sp_add_index;
DROP PROCEDURE IF EXISTS sp_drop_non_primary_indexes;
DROP PROCEDURE IF EXISTS sp_drop_all_checks;
DROP PROCEDURE IF EXISTS sp_drop_all_foreign_keys;
DROP PROCEDURE IF EXISTS sp_drop_column_if_exists;
DROP PROCEDURE IF EXISTS sp_align_column;
DROP PROCEDURE IF EXISTS sp_exec;
