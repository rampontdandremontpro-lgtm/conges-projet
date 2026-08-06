import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import mysql from 'mysql2/promise';

const backendRoot = process.cwd();
const envPath = path.join(backendRoot, '.env');
const TEST_DATABASE = 'gestion_conges_gmes_test';
const SOURCE_DATABASE = 'gestion_conges_gmes';
const EXPECTED_TABLES = [
  'absence_declarations',
  'audit_logs',
  'balance_movements',
  'derogations',
  'documents',
  'holidays',
  'leave_balances',
  'leave_requests',
  'leave_types',
  'notifications',
  'services',
  'settings',
  'users',
].sort();

function parseDotEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readConfiguration() {
  let fileValues = {};
  try {
    fileValues = parseDotEnv(await fs.readFile(envPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const get = (key, fallback) => process.env[key] ?? fileValues[key] ?? fallback;
  const requestedDatabase = get('TEST_DB_DATABASE', TEST_DATABASE);
  if (requestedDatabase !== TEST_DATABASE) {
    throw new Error(
      `Base de test refusée : ${requestedDatabase}. La seule valeur autorisée est ${TEST_DATABASE}.`,
    );
  }

  return {
    host: get('DB_HOST', 'localhost'),
    port: Number(get('DB_PORT', '3306')),
    user: get('DB_USERNAME', 'root'),
    password: get('DB_PASSWORD', ''),
    database: requestedDatabase,
  };
}

async function loadSql(fileName) {
  const filePath = path.join(backendRoot, 'database', fileName);
  const source = await fs.readFile(filePath, 'utf8');
  return source.replaceAll(SOURCE_DATABASE, TEST_DATABASE);
}

async function verifySchema(connection) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [TEST_DATABASE],
  );
  const actualTables = tableRows.map((row) => row.tableName).sort();
  const missing = EXPECTED_TABLES.filter((table) => !actualTables.includes(table));
  const unexpected = actualTables.filter((table) => !EXPECTED_TABLES.includes(table));

  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?`,
    [TEST_DATABASE],
  );
  const invalidColumns = columnRows.filter(
    (row) => !/^[a-z][a-z0-9_]*$/.test(row.columnName),
  );

  if (missing.length || unexpected.length || invalidColumns.length) {
    const details = [
      missing.length ? `Tables manquantes : ${missing.join(', ')}` : null,
      unexpected.length ? `Tables imprévues : ${unexpected.join(', ')}` : null,
      invalidColumns.length
        ? `Colonnes non snake_case : ${invalidColumns
            .map((row) => `${row.tableName}.${row.columnName}`)
            .join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(`Le schéma de test n'est pas conforme.\n${details}`);
  }

  return { tableCount: actualTables.length, columnCount: columnRows.length };
}

async function main() {
  const configuration = await readConfiguration();
  console.log(`Réinitialisation isolée de ${configuration.database}...`);

  const connection = await mysql.createConnection({
    host: configuration.host,
    port: configuration.port,
    user: configuration.user,
    password: configuration.password,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  try {
    for (const fileName of ['schema.sql', 'seed.sql', 'seed-test-accounts.sql']) {
      console.log(`Exécution de ${fileName} dans la base de test...`);
      await connection.query(await loadSql(fileName));
    }

    const verification = await verifySchema(connection);
    console.log(
      `OK — ${configuration.database} contient ${verification.tableCount} tables et ${verification.columnCount} colonnes conformes.`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
