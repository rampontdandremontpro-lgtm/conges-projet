-- Vérification post-migration du schéma GMES V1.
-- Le résultat attendu est exactement 13 tables métier.

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'users', 'services', 'leave_types', 'leave_requests',
    'absence_declarations', 'documents', 'derogations',
    'leave_balances', 'balance_movements', 'holidays',
    'settings', 'notifications', 'audit_logs'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT
  TABLE_NAME,
  CONSTRAINT_NAME,
  CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME;

SELECT
  'tables_obsoletes' AS verification,
  COUNT(*) AS nombre
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'generated_documents',
    'leave_request_history',
    'leave_cancellations',
    'leave_balance_movements'
  );
