-- FALLBACK MANUEL UNIQUEMENT.
-- Depuis la correction du 27/08/2026, la migration TypeORM correspondante
-- est exécutée automatiquement au démarrage du backend (migrationsRun=true).
-- Ce fichier reste disponible si une intervention manuelle sur MySQL est
-- nécessaire. Il faut l'exécuter sur la base configurée par DB_DATABASE.

-- GMES — gestion des congés prévisionnels et consolidation des soldes.
-- Le script est conçu pour être relançable sur MySQL 8+.

SET @has_column := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_requests'
    AND COLUMN_NAME = 'balance_processing_status'
);

SET @sql := IF(
  @has_column = 0,
  "ALTER TABLE leave_requests ADD COLUMN balance_processing_status ENUM('DEMANDE_ACTUELLE','CONGE_PREVISIONNEL','A_CONSOLIDER','DEFINITIF') NOT NULL DEFAULT 'DEMANDE_ACTUELLE' AFTER status",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Les demandes déjà validées avant cette évolution ont déjà été imputées
-- par l'ancien moteur : uniquement lors de la création initiale de la colonne,
-- on les marque DEFINITIF pour éviter un double débit. Lors d'une relance du
-- script, les nouveaux statuts CONGE_PREVISIONNEL/A_CONSOLIDER sont conservés.
SET @sql := IF(
  @has_column = 0,
  "UPDATE leave_requests SET balance_processing_status = 'DEFINITIF' WHERE status = 'VALIDEE'",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'leave_requests'
    AND INDEX_NAME = 'IDX_leave_requests_balance_processing'
);
SET @sql := IF(
  @has_index = 0,
  'CREATE INDEX IDX_leave_requests_balance_processing ON leave_requests (status, balance_processing_status, start_date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
