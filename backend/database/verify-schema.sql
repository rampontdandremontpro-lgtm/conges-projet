USE `gestion_conges_gmes`;

DROP TEMPORARY TABLE IF EXISTS `expected_schema_tables`;
CREATE TEMPORARY TABLE `expected_schema_tables` (
  `table_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `column_count` INT NOT NULL
);

INSERT INTO `expected_schema_tables` (`table_name`, `column_count`) VALUES
  ('services', 12),
  ('users', 17),
  ('leave_types', 15),
  ('leave_requests', 41),
  ('absence_declarations', 18),
  ('documents', 16),
  ('derogations', 14),
  ('leave_balances', 9),
  ('balance_movements', 11),
  ('holidays', 9),
  ('settings', 6),
  ('notifications', 12),
  ('audit_logs', 9);

DELIMITER $$
DROP PROCEDURE IF EXISTS `verify_gmes_schema`$$
CREATE PROCEDURE `verify_gmes_schema`()
BEGIN
  DECLARE v_missing TEXT;
  DECLARE v_unexpected TEXT;
  DECLARE v_wrong_columns TEXT;
  DECLARE v_message TEXT;

  SELECT GROUP_CONCAT(e.table_name ORDER BY e.table_name SEPARATOR ', ')
    INTO v_missing
  FROM expected_schema_tables e
  LEFT JOIN information_schema.TABLES t
    ON t.TABLE_SCHEMA = DATABASE()
   AND t.TABLE_NAME = e.table_name
   AND t.TABLE_TYPE = 'BASE TABLE'
  WHERE t.TABLE_NAME IS NULL;

  SELECT GROUP_CONCAT(t.TABLE_NAME ORDER BY t.TABLE_NAME SEPARATOR ', ')
    INTO v_unexpected
  FROM information_schema.TABLES t
  LEFT JOIN expected_schema_tables e
    ON e.table_name = t.TABLE_NAME
  WHERE t.TABLE_SCHEMA = DATABASE()
    AND t.TABLE_TYPE = 'BASE TABLE'
    AND e.table_name IS NULL;

  SELECT GROUP_CONCAT(
    CONCAT(e.table_name, ' attendu=', e.column_count, ' obtenu=', actual.column_count)
    ORDER BY e.table_name SEPARATOR '; '
  ) INTO v_wrong_columns
  FROM expected_schema_tables e
  JOIN (
    SELECT TABLE_NAME, COUNT(*) AS column_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    GROUP BY TABLE_NAME
  ) actual ON actual.TABLE_NAME = e.table_name
  WHERE actual.column_count <> e.column_count;

  IF v_missing IS NOT NULL THEN
    SET v_message = CONCAT('Tables manquantes : ', v_missing);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
  END IF;

  IF v_unexpected IS NOT NULL THEN
    SET v_message = CONCAT('Tables non prévues par le diagramme : ', v_unexpected);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
  END IF;

  IF v_wrong_columns IS NOT NULL THEN
    SET v_message = CONCAT('Nombre de colonnes incorrect : ', v_wrong_columns);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_message;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND NOT (BINARY COLUMN_NAME REGEXP '^[a-z][a-z0-9_]*$')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Une ou plusieurs colonnes ne respectent pas le snake_case.';
  END IF;

  SELECT
    'OK' AS verification,
    COUNT(*) AS tables_conformes,
    'Schéma conforme au diagramme GMES V1' AS message
  FROM expected_schema_tables;
END$$
DELIMITER ;

CALL `verify_gmes_schema`();
DROP PROCEDURE `verify_gmes_schema`;

SELECT
  t.TABLE_NAME AS table_name,
  COUNT(c.COLUMN_NAME) AS columns_count
FROM information_schema.TABLES t
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
 AND c.TABLE_NAME = t.TABLE_NAME
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_TYPE = 'BASE TABLE'
GROUP BY t.TABLE_NAME
ORDER BY t.TABLE_NAME;
