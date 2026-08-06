import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash, createHmac } from 'node:crypto';
import mysql from 'mysql2/promise';

const apiBaseUrl = (process.env.API_URL ?? 'http://localhost:3010/api').replace(/\/$/, '');
const runExternalApiTests = String(process.env.RUN_EXTERNAL_API_TESTS ?? '').toLowerCase() === 'true';
const backendRoot = process.cwd();
const resultsRoot = path.join(backendRoot, 'test-results');
const testDatabase = process.env.TEST_DB_DATABASE ?? process.env.DB_DATABASE ?? 'gestion_conges_gmes_test';
const expectedTestDatabase = 'gestion_conges_gmes_test';

const baseAccounts = {
  admin: ['admin@gmes.fr', 'AdminGMES@2026!', 'ADMIN'],
  rh: ['rh@gmes.fr', 'RhGMES@2026!', 'RH'],
  directeur: ['directeur@gmes.fr', 'DirecteurGMES@2026!', 'DIRECTEUR'],
  responsable: ['responsable@gmes.fr', 'ResponsableGMES@2026!', 'RESPONSABLE_SERVICE'],
  collaborateur: ['collaborateur@gmes.fr', 'CollaborateurGMES@2026!', 'COLLABORATEUR'],
};

const results = [];
let currentSection = 'Initialisation';
let db;
let jwtSecret = '';
let tokens = {};
let fixtures = {};

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

async function databaseConfiguration() {
  let fileValues = {};
  try {
    fileValues = parseDotEnv(await fs.readFile(path.join(backendRoot, '.env'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const get = (key, fallback) => process.env[key] ?? fileValues[key] ?? fallback;
  const database = get('TEST_DB_DATABASE', testDatabase);
  if (database !== expectedTestDatabase) {
    throw new Error(
      `Les tests complets refusent la base ${database}. Utilise uniquement ${expectedTestDatabase}.`,
    );
  }
  return {
    host: get('DB_HOST', 'localhost'),
    port: Number(get('DB_PORT', '3306')),
    user: get('DB_USERNAME', 'root'),
    password: get('DB_PASSWORD', ''),
    database,
    charset: 'utf8mb4',
    jwtSecret: get('JWT_SECRET', ''),
  };
}

function section(title) {
  currentSection = title;
  console.log(`\n=== ${title} ===`);
}

function record(label, status, detail = '', durationMs = null) {
  const entry = {
    section: currentSection,
    label,
    status,
    detail,
    durationMs,
    recordedAt: new Date().toISOString(),
  };
  results.push(entry);
  const prefix = status === 'PASS' ? 'OK ' : status === 'SKIP' ? 'SKIP' : 'KO ';
  console.log(`${prefix} ${label}${detail ? ` — ${detail}` : ''}`);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, { token, method = 'GET', body, form, binary = false } = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method,
    headers: {
      Accept: binary ? '*/*' : 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  let responseBody;
  if (binary) {
    responseBody = Buffer.from(await response.arrayBuffer());
  } else if (response.status === 204) {
    responseBody = null;
  } else {
    const contentType = response.headers.get('content-type') ?? '';
    responseBody = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  }

  return {
    response,
    body: responseBody,
    durationMs: Date.now() - startedAt,
  };
}

async function expectStatus(label, expectedStatuses, pathname, options = {}, validate) {
  const accepted = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  const result = await request(pathname, options);
  let ok = accepted.includes(result.response.status);
  let validationDetail = '';

  if (ok && validate) {
    try {
      const validationResult = await validate(result.body, result.response);
      if (validationResult === false) {
        ok = false;
        validationDetail = 'Réponse non conforme.';
      }
    } catch (error) {
      ok = false;
      validationDetail = error instanceof Error ? error.message : String(error);
    }
  }

  const detail = ok
    ? `HTTP ${result.response.status}`
    : `HTTP ${result.response.status}; attendu ${accepted.join('/')} — ${validationDetail || summarize(result.body)}`;
  record(label, ok ? 'PASS' : 'FAIL', detail, result.durationMs);
  if (!ok) throw new Error(`${label}: ${detail}`);
  return result;
}

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function login(label, [email, password, role]) {
  const result = await expectStatus(
    `Connexion ${label}`,
    200,
    '/auth/login',
    { method: 'POST', body: { email, password } },
    (body) => {
      invariant(typeof body?.accessToken === 'string', 'Jeton JWT absent.');
      invariant(body?.user?.role === role, `Rôle obtenu ${body?.user?.role}, attendu ${role}.`);
      return true;
    },
  );
  return result.body.accessToken;
}

function martiniqueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nonSunday(dateValue) {
  let result = dateValue;
  while (new Date(`${result}T00:00:00.000Z`).getUTCDay() === 0) {
    result = addDays(result, 1);
  }
  return result;
}

async function nextOpenDate(dateValue) {
  let candidate = nonSunday(dateValue);

  for (let attempt = 0; attempt < 370; attempt += 1) {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM holidays
        WHERE date = ? AND is_active = 1 AND deductible = 0`,
      [candidate],
    );
    if (Number(rows[0]?.total ?? 0) === 0) {
      return candidate;
    }
    candidate = nonSunday(addDays(candidate, 1));
  }

  throw new Error('Aucune date ouvrée disponible n’a été trouvée pour le scénario E2E.');
}

function previousMonth() {
  const today = new Date(`${martiniqueToday()}T00:00:00.000Z`);
  today.setUTCDate(1);
  today.setUTCMonth(today.getUTCMonth() - 1);
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentReferencePeriod() {
  const today = new Date(`${martiniqueToday()}T00:00:00.000Z`);
  const year = today.getUTCFullYear();
  const startYear = today.getUTCMonth() + 1 >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function containsKey(value, blockedKeys) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, blockedKeys));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => blockedKeys.has(key) || containsKey(child, blockedKeys),
  );
}


function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPasswordResetToken({ userId, email, passwordHash, secret }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    sub: userId,
    email,
    purpose: 'password-reset',
    passwordFingerprint: createHash('sha256')
      .update(passwordHash ?? 'NO_PASSWORD_DEFINED')
      .digest('hex'),
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

async function createFixtures() {
  const [hashRows] = await db.query(
    `SELECT email, password_hash AS passwordHash FROM users
      WHERE email IN ('responsable@gmes.fr', 'collaborateur@gmes.fr')`,
  );
  const hashes = Object.fromEntries(hashRows.map((row) => [row.email, row.passwordHash]));
  invariant(hashes['responsable@gmes.fr'], 'Hash du Responsable de test introuvable.');
  invariant(hashes['collaborateur@gmes.fr'], 'Hash du Collaborateur de test introuvable.');

  const tag = Date.now().toString(36);
  const [serviceResult] = await db.execute(
    `INSERT INTO services
      (name, service_type, validation_mode, takeover_delay_days, minimum_presence, has_minimum_presence_rule, is_active)
     VALUES (?, 'INTERNE', 'RESPONSABLE_PUIS_RELAIS', 7, 3, 1, 1)`,
    [`ZZ E2E Circuit ${tag}`],
  );
  const serviceId = Number(serviceResult.insertId);

  const insertUser = async ({ nom, prenom, email, role, passwordHash, hireDate = '2024-01-01' }) => {
    const [result] = await db.execute(
      `INSERT INTO users
        (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
       VALUES (?, ?, ?, ?, ?, 'INTERNE', ?, ?, 'PRESENT', 1)`,
      [nom, prenom, email, passwordHash, role, serviceId, hireDate],
    );
    return Number(result.insertId);
  };

  const manager = {
    id: await insertUser({
      nom: 'TEST-MANAGER', prenom: 'Mélanie', email: `manager-${tag}@gmes.test`,
      role: 'RESPONSABLE_SERVICE', passwordHash: hashes['responsable@gmes.fr'],
    }),
    email: `manager-${tag}@gmes.test`,
    password: 'ResponsableGMES@2026!',
  };
  await db.execute('UPDATE services SET primary_manager_id = ? WHERE id = ?', [manager.id, serviceId]);

  const collaborators = {};
  for (const [key, nom, prenom] of [
    ['a', 'TEST-ALPHA', 'Alice'],
    ['b', 'TEST-BETA', 'Benoît'],
    ['c', 'TEST-GAMMA', 'Chloé'],
  ]) {
    const email = `collab-${key}-${tag}@gmes.test`;
    collaborators[key] = {
      id: await insertUser({
        nom, prenom, email, role: 'COLLABORATEUR',
        passwordHash: hashes['collaborateur@gmes.fr'],
      }),
      email,
      password: 'CollaborateurGMES@2026!',
    };
  }

  const month = previousMonth();
  const midMonthHireDate = `${month}-15`;
  const prorataEmail = `prorata-${tag}@gmes.test`;
  const prorataUser = {
    id: await insertUser({
      nom: 'TEST-PRORATA', prenom: 'Patricia', email: prorataEmail,
      role: 'COLLABORATEUR', passwordHash: hashes['collaborateur@gmes.fr'],
      hireDate: midMonthHireDate,
    }),
    email: prorataEmail,
    password: 'CollaborateurGMES@2026!',
    hireDate: midMonthHireDate,
  };

  return { tag, serviceId, manager, collaborators, prorataUser };
}

async function initializeBalance(employeeId, referencePeriod, counterType, acquiredDays) {
  const result = await expectStatus(
    `Initialisation ${counterType} ${referencePeriod} pour l'utilisateur ${employeeId}`,
    201,
    '/leave-balances/initialize',
    {
      token: tokens.rh,
      method: 'POST',
      body: {
        employeeId,
        referencePeriod,
        counterType,
        acquiredDays,
        reason: 'Initialisation automatisée du scénario E2E.',
      },
    },
  );
  return result.body;
}

async function createRequest(token, leaveTypeId, date, comment, periods = {}) {
  const result = await expectStatus(
    `Création du brouillon « ${comment} »`,
    201,
    '/leave-requests',
    {
      token,
      method: 'POST',
      body: {
        leaveTypeId,
        startDate: date,
        endDate: date,
        startPeriod: periods.startPeriod ?? 'MATIN',
        endPeriod: periods.endPeriod ?? 'APRES_MIDI',
        comment,
      },
    },
  );
  return result.body;
}

async function submitRequest(token, requestId, expected = 200) {
  return expectStatus(
    `Soumission de la demande ${requestId}`,
    expected,
    `/leave-requests/${requestId}/submit`,
    {
      token,
      method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'TG' },
    },
  );
}

async function uploadPdf(pathname, token, fileName = 'justificatif-test.pdf') {
  const form = new FormData();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), fileName);
  return request(pathname, { token, method: 'POST', form });
}

async function main() {
  await fs.mkdir(resultsRoot, { recursive: true });
  console.log(`API testée : ${apiBaseUrl}`);
  console.log(`Base isolée : ${testDatabase}`);
  console.log(`API externe jours fériés : ${runExternalApiTests ? 'activée' : 'désactivée'}`);

  const { jwtSecret: configuredJwtSecret, ...dbConfiguration } = await databaseConfiguration();
  invariant(configuredJwtSecret.length > 0, 'JWT_SECRET est absent de backend/.env.');
  jwtSecret = configuredJwtSecret;
  db = await mysql.createConnection(dbConfiguration);
  fixtures = await createFixtures();

  section('Authentification et identité');
  await expectStatus('Racine de l’API disponible', 200, '');
  await expectStatus(
    'Connexion refusée avec un mauvais mot de passe',
    401,
    '/auth/login',
    { method: 'POST', body: { email: 'admin@gmes.fr', password: 'mot-de-passe-invalide' } },
  );
  const knownPasswordRequest = await expectStatus(
    'Demande de définition de mot de passe pour un compte connu',
    200,
    '/auth/request-password',
    { method: 'POST', body: { email: 'admin@gmes.fr' } },
  );
  const unknownPasswordRequest = await expectStatus(
    'Demande de définition de mot de passe pour un compte inconnu',
    200,
    '/auth/request-password',
    { method: 'POST', body: { email: 'inconnu@gmes.test' } },
  );
  const enumerationProtected = JSON.stringify(knownPasswordRequest.body) === JSON.stringify(unknownPasswordRequest.body);
  record(
    'La récupération de mot de passe ne révèle pas l’existence du compte',
    enumerationProtected ? 'PASS' : 'FAIL',
    enumerationProtected ? 'Réponse publique identique.' : 'Réponses différentes.',
  );
  invariant(enumerationProtected, 'Protection contre l’énumération de comptes absente.');

  for (const [name, account] of Object.entries(baseAccounts)) {
    tokens[name] = await login(name, account);
  }
  tokens.manager = await login('manager E2E', [fixtures.manager.email, fixtures.manager.password, 'RESPONSABLE_SERVICE']);
  for (const key of ['a', 'b', 'c']) {
    const account = fixtures.collaborators[key];
    tokens[`collab${key.toUpperCase()}`] = await login(`collaborateur E2E ${key.toUpperCase()}`, [account.email, account.password, 'COLLABORATEUR']);
  }

  for (const [name, token] of Object.entries(tokens)) {
    await expectStatus(`/auth/me pour ${name}`, 200, '/auth/me', { token });
  }
  await expectStatus('/auth/me sans jeton', 401, '/auth/me');

  section('Matrice des rôles et confidentialité');
  const forbiddenChecks = [
    ['Collaborateur ne consulte pas les utilisateurs', tokens.collaborateur, '/users'],
    ['Collaborateur ne consulte pas les services administratifs', tokens.collaborateur, '/services'],
    ['Collaborateur ne consulte pas tous les paramètres', tokens.collaborateur, '/settings'],
    ['Collaborateur ne consulte pas les audits', tokens.collaborateur, '/audit-logs'],
    ['Collaborateur ne télécharge pas les exports RH', tokens.collaborateur, '/exports/leave-requests?format=csv'],
    ['RH ne consulte pas les statistiques Directeur', tokens.rh, '/reports/director/statistics'],
    ['Admin ne consulte pas les soldes personnels', tokens.admin, '/leave-balances/my'],
    ['Directeur ne consulte pas la gestion des justificatifs', tokens.directeur, '/documents/management'],
    ['Responsable ne consulte pas la gestion des dérogations', tokens.responsable, '/derogations/management'],
    ['Collaborateur ne consulte pas la gestion des absences', tokens.collaborateur, '/absence-declarations/management'],
  ];
  for (const [label, token, pathname] of forbiddenChecks) {
    await expectStatus(label, 403, pathname, { token });
  }
  for (const pathname of [
    '/users', '/services', '/leave-types', '/settings/public', '/notifications/my',
    '/leave-requests/my', '/absence-declarations/my', '/leave-balances/my',
    '/reports/director/statistics', '/exports/leave-requests?format=csv',
  ]) {
    await expectStatus(`Route protégée sans jeton : ${pathname}`, 401, pathname);
  }

  section('Administration : services, utilisateurs, types et jours fériés');
  const adminService = await expectStatus(
    'Admin crée un service', 201, '/services',
    {
      token: tokens.admin, method: 'POST',
      body: {
        name: `ZZ Service API ${fixtures.tag}`,
        serviceType: 'INTERNE',
        validationMode: 'DIRECTEUR_SEUL',
        takeoverDelayDays: 5,
        minimumPresence: 1,
        hasMinimumPresenceRule: true,
      },
    },
  );
  const adminServiceId = adminService.body.id;
  await expectStatus('Admin modifie le service', 200, `/services/${adminServiceId}`, {
    token: tokens.admin, method: 'PATCH', body: { minimumPresence: 2 },
  });
  await expectStatus('Admin désactive le service', 200, `/services/${adminServiceId}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  await expectStatus('Admin réactive le service', 200, `/services/${adminServiceId}/enable`, {
    token: tokens.admin, method: 'PATCH',
  });

  const adminUser = await expectStatus(
    'Admin crée un utilisateur', 201, '/users',
    {
      token: tokens.admin, method: 'POST',
      body: {
        nom: 'TEST-API', prenom: 'Utilisateur', email: `api-user-${fixtures.tag}@gmes.test`,
        role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-01',
        serviceId: adminServiceId,
      },
    },
  );
  const adminUserId = adminUser.body.id;
  const temporaryPassword = 'ApiUserGMES@2026!';
  const resetToken = signPasswordResetToken({
    userId: adminUserId,
    email: adminUser.body.email,
    passwordHash: null,
    secret: jwtSecret,
  });
  await expectStatus('Le nouvel utilisateur définit son mot de passe', 200, '/auth/define-password', {
    method: 'POST', body: { token: resetToken, password: temporaryPassword },
  });
  await expectStatus('Le nouvel utilisateur se connecte avec son mot de passe', 200, '/auth/login', {
    method: 'POST', body: { email: adminUser.body.email, password: temporaryPassword },
  });
  await expectStatus('Le lien de définition du mot de passe est à usage unique', 400, '/auth/define-password', {
    method: 'POST', body: { token: resetToken, password: 'AutreMotDePasse@2026!' },
  });
  await expectStatus('RH consulte l’utilisateur créé', 200, `/users/${adminUserId}`, { token: tokens.rh });
  await expectStatus('Admin modifie l’utilisateur', 200, `/users/${adminUserId}`, {
    token: tokens.admin, method: 'PATCH', body: { prenom: 'Utilisateur Modifié' },
  });
  await expectStatus('Admin désactive l’utilisateur', 200, `/users/${adminUserId}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  await expectStatus('Admin réactive l’utilisateur', 200, `/users/${adminUserId}/enable`, {
    token: tokens.admin, method: 'PATCH',
  });

  await expectStatus(
    'RH ne peut pas activer le dépôt différé sans justificatif obligatoire',
    400,
    '/leave-types',
    {
      token: tokens.rh,
      method: 'POST',
      body: {
        name: `ZZ Type invalide E2E ${fixtures.tag}`,
        category: 'DEMANDE_CONGE',
        deductsPaidLeaveBalance: false,
        documentRequired: false,
        documentCanBeAddedLater: true,
        employeeCanCreate: true,
        rhOnly: false,
        allowsDays: true,
        allowsHalfDays: true,
        allowsHours: false,
        requiresValidation: true,
      },
    },
  );

  const leaveTypeCreated = await expectStatus(
    'RH crée un type de congé', 201, '/leave-types',
    {
      token: tokens.rh, method: 'POST',
      body: {
        name: `ZZ Type E2E ${fixtures.tag}`, category: 'DEMANDE_CONGE',
        deductsPaidLeaveBalance: false, documentRequired: false,
        documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false,
        allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true,
      },
    },
  );
  const createdLeaveTypeId = leaveTypeCreated.body.id;
  await expectStatus('Admin modifie le type de congé', 200, `/leave-types/${createdLeaveTypeId}`, {
    token: tokens.admin, method: 'PATCH', body: { allowsHalfDays: false },
  });
  await expectStatus('RH désactive le type de congé', 200, `/leave-types/${createdLeaveTypeId}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });
  await expectStatus('RH réactive le type de congé', 200, `/leave-types/${createdLeaveTypeId}/enable`, {
    token: tokens.rh, method: 'PATCH',
  });

  const holidayDate = nonSunday(addDays(martiniqueToday(), 110));
  const holiday = await expectStatus(
    'RH crée une fermeture GMES', 201, '/holidays',
    {
      token: tokens.rh, method: 'POST',
      body: {
        date: holidayDate, name: `Fermeture E2E ${fixtures.tag}`,
        holidayType: 'FERMETURE_GMES', deductible: false, source: 'TEST_E2E',
      },
    },
  );
  const holidayId = holiday.body.id;
  await expectStatus('RH modifie la fermeture', 200, `/holidays/${holidayId}`, {
    token: tokens.rh, method: 'PATCH', body: { name: `Fermeture E2E modifiée ${fixtures.tag}` },
  });
  await expectStatus('RH désactive la fermeture', 200, `/holidays/${holidayId}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });
  await expectStatus('RH réactive la fermeture', 200, `/holidays/${holidayId}/enable`, {
    token: tokens.rh, method: 'PATCH',
  });
  await expectStatus('Une demande ne commence pas sur une fermeture non décomptable', 400, '/leave-requests', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: createdLeaveTypeId, startDate: holidayDate, endDate: holidayDate },
  });

  if (runExternalApiTests) {
    await expectStatus(
      'Synchronisation officielle des jours fériés de Martinique',
      201,
      '/holidays/sync/martinique',
      { token: tokens.rh, method: 'POST', body: { year: new Date().getFullYear() } },
      (body) => {
        invariant(body && typeof body === 'object', 'Résumé de synchronisation absent.');
        return true;
      },
    );
  } else {
    record(
      'Synchronisation officielle des jours fériés de Martinique',
      'SKIP',
      'Test réseau volontairement désactivé. Relancer avec npm run test:full:external.',
    );
  }
  await expectStatus('Collaborateur ne déclenche pas la synchronisation', 403, '/holidays/sync/martinique', {
    token: tokens.collaborateur, method: 'POST', body: { year: new Date().getFullYear() },
  });

  section('Paramètres réellement utilisés');
  const originalSetting = await expectStatus(
    'RH consulte MODIFICATION_DEADLINE_DAYS', 200, '/settings/MODIFICATION_DEADLINE_DAYS',
    { token: tokens.rh },
  );
  const originalValue = originalSetting.body.settingValue;
  await expectStatus('RH modifie MODIFICATION_DEADLINE_DAYS', 200, '/settings/MODIFICATION_DEADLINE_DAYS', {
    token: tokens.rh, method: 'PATCH',
    body: { settingValue: '8', description: 'Valeur temporaire du test E2E.' },
  });
  await expectStatus('Le paramètre modifié est relu', 200, '/settings/MODIFICATION_DEADLINE_DAYS', {
    token: tokens.rh,
  }, (body) => {
    invariant(body.settingValue === '8', `Valeur obtenue ${body.settingValue}.`);
    return true;
  });
  await expectStatus('RH restaure MODIFICATION_DEADLINE_DAYS', 200, '/settings/MODIFICATION_DEADLINE_DAYS', {
    token: tokens.rh, method: 'PATCH',
    body: { settingValue: originalValue, description: originalSetting.body.description ?? undefined },
  });
  const seasonal = await expectStatus('Lecture de la période saisonnière', 200, '/settings/seasonal-period', {
    token: tokens.collaborateur,
  });
  await expectStatus('RH modifie temporairement la période saisonnière', 200, '/settings/seasonal-period', {
    token: tokens.rh, method: 'PATCH', body: { summerPeriodStart: '05-02', summerPeriodEnd: '10-30' },
  });
  await expectStatus('RH restaure la période saisonnière', 200, '/settings/seasonal-period', {
    token: tokens.rh, method: 'PATCH', body: seasonal.body,
  });

  section('Soldes, acquisition mensuelle et prorata en attente');
  const operationalPeriod = currentReferencePeriod();
  const balanceA = await initializeBalance(fixtures.collaborators.a.id, operationalPeriod, 'N-1', 100);
  await initializeBalance(fixtures.collaborators.c.id, operationalPeriod, 'N-1', 100);
  await expectStatus('Collaborateur consulte ses propres soldes', 200, '/leave-balances/my', {
    token: tokens.collabA,
  });
  await expectStatus('RH consulte le solde d’un collaborateur', 200, `/leave-balances/employee/${fixtures.collaborators.a.id}`, {
    token: tokens.rh,
  });
  await expectStatus('Autre collaborateur ne consulte pas le solde nominatif', 403, `/leave-balances/employee/${fixtures.collaborators.a.id}`, {
    token: tokens.collabB,
  });
  await expectStatus('RH ajoute une acquisition manuelle', 201, `/leave-balances/${balanceA.id}/accrual`, {
    token: tokens.rh, method: 'POST',
    body: { accrualMonth: previousMonth(), days: 1, reason: 'Test de l’acquisition manuelle.' },
  });
  await expectStatus('RH applique une correction positive', 201, `/leave-balances/${balanceA.id}/correction`, {
    token: tokens.rh, method: 'POST', body: { days: 0.5, reason: 'Correction E2E contrôlée.' },
  });
  await expectStatus('Correction nulle refusée', 400, `/leave-balances/${balanceA.id}/correction`, {
    token: tokens.rh, method: 'POST', body: { days: 0, reason: 'Correction invalide.' },
  });

  const monthlyAccrual = await expectStatus('RH lance l’acquisition du mois terminé', 201, '/leave-balances/accrual/run', {
    token: tokens.rh, method: 'POST', body: { accrualMonth: previousMonth() },
  }, (body) => {
    invariant(Array.isArray(body.creditedEmployees), 'creditedEmployees absent.');
    invariant(Array.isArray(body.manualReviewRequired), 'manualReviewRequired absent.');
    invariant(
      body.manualReviewRequired.some((row) => Number(row.employeeId) === fixtures.prorataUser.id),
      'L’arrivée en cours de mois n’est pas orientée vers le contrôle RH.',
    );
    return true;
  });
  await expectStatus('L’acquisition mensuelle est idempotente', 201, '/leave-balances/accrual/run', {
    token: tokens.rh, method: 'POST', body: { accrualMonth: previousMonth() },
  }, (body) => {
    invariant(body.alreadyCreditedEmployees.length >= monthlyAccrual.body.creditedEmployees.length, 'Les crédits déjà passés ne sont pas reconnus.');
    return true;
  });
  record(
    'Prorata automatique arrivée/départ',
    'SKIP',
    'La formule et l’arrondi ne sont pas validés ; le backend classe correctement l’arrivée en cours de mois dans manualReviewRequired. Le départ ne peut pas être calculé sans date de fin de contrat dans le modèle actuel.',
  );

  const leaveTypes = await expectStatus('Tous les rôles consultent les types actifs', 200, '/leave-types', {
    token: tokens.collabA,
  });
  const paidType = leaveTypes.body.find((type) => type.name === 'Congés payés');
  const unpaidType = leaveTypes.body.find((type) => type.name === 'Congé sans solde');
  const sickType = leaveTypes.body.find((type) => type.name === 'Arrêt maladie');
  const rhOnlyAbsenceType = leaveTypes.body.find((type) => type.name === 'Absence autorisée');
  invariant(paidType && unpaidType && sickType && rhOnlyAbsenceType, 'Types initiaux incomplets.');

  section('Absences, justificatifs sécurisés et confidentialité');
  const scenarioDate = await nextOpenDate(addDays(martiniqueToday(), 75));
  const absenceB = await expectStatus('Collaborateur B crée une déclaration d’absence', 201, '/absence-declarations', {
    token: tokens.collabB, method: 'POST',
    body: {
      leaveTypeId: sickType.id, startDate: scenarioDate, endDate: scenarioDate,
      startPeriod: 'MATIN', endPeriod: 'APRES_MIDI', comment: 'Absence E2E avec justificatif.',
    },
  });
  const absenceBId = absenceB.body.id;
  await expectStatus('Collaborateur ne déclare pas pour un collègue', 403, '/absence-declarations', {
    token: tokens.collabA, method: 'POST',
    body: { employeeId: fixtures.collaborators.b.id, leaveTypeId: sickType.id, startDate: scenarioDate, endDate: scenarioDate },
  });
  await expectStatus('Type réservé à la RH refusé au collaborateur', 403, '/absence-declarations', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: rhOnlyAbsenceType.id, startDate: nonSunday(addDays(scenarioDate, 2)), endDate: nonSunday(addDays(scenarioDate, 2)) },
  });
  await expectStatus('Collaborateur B soumet sa déclaration', 200, `/absence-declarations/${absenceBId}/submit`, {
    token: tokens.collabB, method: 'POST', body: { certifiedAccurate: true },
  });
  await expectStatus('Autre collaborateur ne consulte pas cette absence', [403, 404], `/absence-declarations/${absenceBId}`, {
    token: tokens.collabA,
  });

  const uploadResult = await uploadPdf(`/documents/absence/${absenceBId}`, tokens.collabB);
  const uploadOk = uploadResult.response.status === 201 && uploadResult.body?.id;
  record('Collaborateur ajoute un justificatif PDF valide', uploadOk ? 'PASS' : 'FAIL', `HTTP ${uploadResult.response.status}`, uploadResult.durationMs);
  invariant(uploadOk, `Téléversement impossible : ${summarize(uploadResult.body)}`);
  const documentId = uploadResult.body.id;
  await expectStatus('Autre collaborateur ne consulte pas le justificatif', [403, 404], `/documents/absence/${absenceBId}`, {
    token: tokens.collabA,
  });
  await expectStatus('RH consulte les justificatifs à contrôler', 200, '/documents/management', { token: tokens.rh });
  await expectStatus('Directeur ne télécharge pas le justificatif', 403, `/documents/${documentId}/download`, {
    token: tokens.directeur, binary: true,
  });
  await expectStatus('RH télécharge le justificatif', 200, `/documents/${documentId}/download`, {
    token: tokens.rh, binary: true,
  }, (body) => {
    invariant(Buffer.isBuffer(body) && body.subarray(0, 5).toString('ascii') === '%PDF-', 'Contenu PDF invalide.');
    return true;
  });
  await expectStatus('RH rejette le justificatif avec un motif', 200, `/documents/${documentId}/reject`, {
    token: tokens.rh, method: 'POST', body: { reason: 'Document illisible dans le test automatisé.' },
  });
  const replaceForm = new FormData();
  replaceForm.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\n% Remplacement E2E\n%%EOF\n')], { type: 'application/pdf' }),
    'justificatif-remplace.pdf',
  );
  await expectStatus('Collaborateur remplace le justificatif rejeté', 200, `/documents/${documentId}/replace`, {
    token: tokens.collabB, method: 'PATCH', form: replaceForm,
  });
  await expectStatus('RH accepte le justificatif', 200, `/documents/${documentId}/accept`, {
    token: tokens.rh, method: 'POST',
  });
  await expectStatus('RH enregistre définitivement l’absence', 200, `/absence-declarations/${absenceBId}/register`, {
    token: tokens.rh, method: 'POST',
  }, (body) => {
    invariant(body.status === 'ENREGISTREE', `Statut obtenu ${body.status}.`);
    return true;
  });
  const rhCreatedAbsenceDate = await nextOpenDate(addDays(scenarioDate, 4));
  const rhAbsence = await expectStatus('RH crée une absence pour un collaborateur', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: rhCreatedAbsenceDate, endDate: rhCreatedAbsenceDate,
      durationHours: 2, comment: 'Absence autorisée créée par la RH.',
    },
  });
  await expectStatus('Collaborateur annule son brouillon d’absence', 200, `/absence-declarations/${rhAbsence.body.id}/cancel`, {
    token: tokens.collabA, method: 'POST',
  });

  section('Demandes de congé, chevauchement et présence minimale');
  const requestA = await createRequest(tokens.collabA, paidType.id, scenarioDate, 'Chevauchement collègue A');
  await submitRequest(tokens.collabA, requestA.id);

  const candidateC = await createRequest(tokens.collabC, paidType.id, scenarioDate, 'Demande candidate présence minimale');
  await expectStatus('Collaborateur met à jour son brouillon', 200, `/leave-requests/${candidateC.id}`, {
    token: tokens.collabC, method: 'PATCH', body: { comment: 'Demande candidate mise à jour.' },
  });
  await submitRequest(tokens.collabC, candidateC.id);

  const alerts = await expectStatus('Responsable consulte les alertes de disponibilité', 200, `/leave-requests/management/${candidateC.id}/alerts`, {
    token: tokens.manager,
  }, (body) => {
    invariant(body.minimumPresenceBreached === true, 'Le seuil minimum devrait être franchi.');
    invariant(body.requiresJustification === true, 'La justification devrait être obligatoire.');
    invariant(body.overlaps.some((item) => item.sourceId === requestA.id), 'Chevauchement avec la demande A absent.');
    invariant(body.overlaps.some((item) => item.sourceId === absenceBId), 'Chevauchement avec l’absence B absent.');
    return true;
  });
  invariant(alerts.body.minimumRemainingEmployees < alerts.body.minimumPresence, 'Calcul du minimum incohérent.');

  await expectStatus('RH ne reprend pas la demande avant le délai sans urgence', 403, `/leave-requests/${candidateC.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: {
      signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true,
      minimumPresenceJustification: 'Motif temporaire.',
    },
  });
  await expectStatus('Validation sans justification du seuil refusée', 400, `/leave-requests/${candidateC.id}/validate`, {
    token: tokens.manager, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'MG' },
  });
  await expectStatus('Responsable valide avec justification obligatoire', 200, `/leave-requests/${candidateC.id}/validate`, {
    token: tokens.manager, method: 'POST',
    body: {
      signatureType: 'INITIALS', signatureData: 'MG',
      minimumPresenceJustification: 'Renfort planifié et continuité du service assurée.',
    },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('Collaborateur télécharge le PDF de validation', 200, `/leave-requests/${candidateC.id}/pdf`, {
    token: tokens.collabC, binary: true,
  }, (body) => {
    invariant(body.subarray(0, 5).toString('ascii') === '%PDF-', 'Le fichier ne commence pas par %PDF-.');
    return true;
  });
  await expectStatus('Autre collaborateur ne télécharge pas le PDF', [403, 404], `/leave-requests/${candidateC.id}/pdf`, {
    token: tokens.collabA, binary: true,
  });
  await expectStatus('Responsable refuse la demande en chevauchement', 200, `/leave-requests/${requestA.id}/refuse`, {
    token: tokens.manager, method: 'POST', body: { comment: 'Refus E2E pour libérer la réservation.' },
  }, (body) => {
    invariant(body.status === 'REFUSEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const halfDayDate = await nextOpenDate(addDays(scenarioDate, 7));
  const halfDay = await createRequest(
    tokens.collabA,
    paidType.id,
    halfDayDate,
    'Demi-journée E2E',
    { startPeriod: 'MATIN', endPeriod: 'MATIN' },
  );
  invariant(Number(halfDay.deductedDays) === 0.5, `Demi-journée calculée à ${halfDay.deductedDays}.`);
  record('Calcul d’une demi-journée à 0,5 jour', 'PASS', 'deductedDays = 0.5');
  await expectStatus('Suppression d’un brouillon de congé', 204, `/leave-requests/${halfDay.id}`, {
    token: tokens.collabA, method: 'DELETE',
  });

  const sunday = addDays(halfDayDate, (7 - new Date(`${halfDayDate}T00:00:00.000Z`).getUTCDay()) % 7 || 7);
  await expectStatus('Un dimanche ne peut pas être une borne de congé', 400, '/leave-requests', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: sunday, endDate: sunday },
  });

  section('Annulation avant et après validation');
  const cancelPendingDate = await nextOpenDate(addDays(scenarioDate, 12));
  const pendingToCancel = await createRequest(tokens.collabA, paidType.id, cancelPendingDate, 'Annulation avant décision');
  await submitRequest(tokens.collabA, pendingToCancel.id);
  await expectStatus('Une modification avant décision invalide la signature et repasse en brouillon', 200, `/leave-requests/${pendingToCancel.id}`, {
    token: tokens.collabA, method: 'PATCH', body: { comment: 'Demande modifiée avant annulation.' },
  }, (body) => {
    invariant(body.status === 'BROUILLON', `Statut obtenu ${body.status}.`);
    invariant(body.employeeSignatureType === null && body.employeeSignedAt === null, 'La signature précédente devrait être invalidée.');
    return true;
  });
  await submitRequest(tokens.collabA, pendingToCancel.id);
  await expectStatus('Collaborateur annule une demande avant décision', 200, `/leave-requests/${pendingToCancel.id}/cancel`, {
    token: tokens.collabA, method: 'POST', body: { reason: 'Annulation demandée pendant le test.' },
  }, (body) => {
    invariant(body.status === 'ANNULEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await expectStatus('Collaborateur demande l’annulation après validation', 200, `/leave-requests/${candidateC.id}/cancellation-request`, {
    token: tokens.collabC, method: 'POST', body: { reason: 'Changement de planning personnel.' },
  });
  await expectStatus('Responsable ne finalise pas l’annulation', 403, `/leave-requests/${candidateC.id}/cancellation-complete`, {
    token: tokens.manager, method: 'POST',
  });
  await expectStatus('RH finalise l’annulation et recrédite le solde', 200, `/leave-requests/${candidateC.id}/cancellation-complete`, {
    token: tokens.rh, method: 'POST',
  }, (body) => {
    invariant(body.status === 'ANNULEE_APRES_VALIDATION', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('Collaborateur télécharge le PDF d’annulation', 200, `/leave-requests/${candidateC.id}/cancellation-pdf`, {
    token: tokens.collabC, binary: true,
  }, (body) => {
    invariant(body.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF d’annulation invalide.');
    return true;
  });

  const urgentDate = await nextOpenDate(addDays(scenarioDate, 9));
  const urgentRequest = await createRequest(tokens.collabA, unpaidType.id, urgentDate, 'Reprise urgente par la RH');
  await submitRequest(tokens.collabA, urgentRequest.id);
  await expectStatus('RH reprend une demande avant le délai avec urgence motivée', 200, `/leave-requests/${urgentRequest.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: {
      signatureType: 'INITIALS', signatureData: 'RH',
      rhConfirmedDirectorAgreement: true,
      emergencyTakeover: true,
      takeoverReason: 'Responsable indisponible et décision nécessaire immédiatement.',
    },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    invariant(body.isUrgent === true, 'La reprise urgente n’est pas marquée comme telle.');
    return true;
  });
  await expectStatus('RH initie une annulation après validation', 200, `/leave-requests/${urgentRequest.id}/cancellation-request`, {
    token: tokens.rh, method: 'POST', body: { reason: 'Annulation initiée par la RH pour tester le consentement.' },
  });
  await expectStatus('Collaborateur donne son consentement à l’annulation', 200, `/leave-requests/${urgentRequest.id}/cancellation-consent`, {
    token: tokens.collabA, method: 'POST', body: { consent: true },
  });
  await expectStatus('RH finalise l’annulation avec consentement', 200, `/leave-requests/${urgentRequest.id}/cancellation-complete`, {
    token: tokens.rh, method: 'POST',
  });

  section('Dérogations de délai');
  const derogationDate = await nextOpenDate(addDays(martiniqueToday(), 10));
  const derogatedRequest = await createRequest(tokens.collabA, unpaidType.id, derogationDate, 'Demande à délai réduit');
  await submitRequest(tokens.collabA, derogatedRequest.id, 400);
  const derogation = await expectStatus('Collaborateur crée une dérogation', 201, '/derogations', {
    token: tokens.collabA, method: 'POST',
    body: { leaveRequestId: derogatedRequest.id, reason: 'Nécessité familiale urgente et imprévisible.' },
  });
  const derogationId = derogation.body.id;
  await expectStatus('Collaborateur modifie le motif de dérogation', 200, `/derogations/${derogationId}`, {
    token: tokens.collabA, method: 'PATCH', body: { reason: 'Nécessité familiale urgente confirmée par le collaborateur.' },
  });
  await expectStatus('Collaborateur soumet la dérogation', 200, `/derogations/${derogationId}/submit`, {
    token: tokens.collabA, method: 'POST',
  });
  await expectStatus('Responsable ne décide pas la dérogation', 403, `/derogations/${derogationId}/decision`, {
    token: tokens.manager, method: 'PATCH', body: { decision: 'ACCORDER' },
  });
  await expectStatus('RH accorde la dérogation', 200, `/derogations/${derogationId}/decision`, {
    token: tokens.rh, method: 'PATCH',
    body: { decision: 'ACCORDER', decisionComment: 'Dérogation accordée dans le test E2E.' },
  });
  await submitRequest(tokens.collabA, derogatedRequest.id);
  await expectStatus('La dérogation accordée est consommée', 200, `/derogations/my/${derogationId}`, {
    token: tokens.collabA,
  }, (body) => {
    invariant(body.status === 'UTILISEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('Collaborateur annule la demande dérogatoire avant décision', 200, `/leave-requests/${derogatedRequest.id}/cancel`, {
    token: tokens.collabA, method: 'POST', body: { reason: 'Fin du scénario de dérogation.' },
  });

  section('Rappels automatiques et expiration sans validation');
  const schedulerBaseDate = await nextOpenDate(addDays(scenarioDate, 20));
  const reminderRequest = await createRequest(tokens.collabA, unpaidType.id, schedulerBaseDate, 'Rappel automatique J-1');
  await submitRequest(tokens.collabA, reminderRequest.id);
  const expiringRequest = await createRequest(tokens.collabC, unpaidType.id, nonSunday(addDays(schedulerBaseDate, 2)), 'Expiration automatique');
  await submitRequest(tokens.collabC, expiringRequest.id);
  const today = martiniqueToday();
  let tomorrow = nonSunday(addDays(today, 1));
  if (tomorrow === today) tomorrow = nonSunday(addDays(today, 2));
  await db.execute(
    `UPDATE leave_requests
        SET start_date = ?, end_date = ?, calendar_duration = 1, deducted_days = 1
      WHERE id = ?`,
    [tomorrow, tomorrow, reminderRequest.id],
  );
  await db.execute(
    `UPDATE leave_requests
        SET start_date = ?, end_date = ?, calendar_duration = 1, deducted_days = 1
      WHERE id = ?`,
    [today, today, expiringRequest.id],
  );
  const maintenance = await expectStatus('RH exécute la maintenance automatique', 200, '/leave-requests/maintenance/run', {
    token: tokens.rh, method: 'POST',
  }, (body) => {
    invariant(body.expiredRequests >= 1, 'Aucune demande expirée.');
    invariant(body.remindersCreated >= 1, 'Aucun rappel créé.');
    return true;
  });
  await expectStatus('La demande arrivée à échéance passe à EXPIREE_NON_VALIDEE', 200, `/leave-requests/${expiringRequest.id}`, {
    token: tokens.collabC,
  }, (body) => {
    invariant(body.status === 'EXPIREE_NON_VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  const secondMaintenance = await expectStatus('La maintenance est idempotente dans la journée', 200, '/leave-requests/maintenance/run', {
    token: tokens.rh, method: 'POST',
  });
  invariant(secondMaintenance.body.remindersCreated === 0, 'Un rappel quotidien a été dupliqué.');
  record('Pas de rappel quotidien dupliqué', 'PASS', 'remindersCreated = 0 au second passage.');

  section('Notifications internes');
  const myNotifications = await expectStatus('Collaborateur consulte ses notifications', 200, '/notifications/my', {
    token: tokens.collabC,
  }, (body) => {
    invariant(Array.isArray(body), 'La réponse doit être un tableau.');
    invariant(body.length > 0, 'Aucune notification créée par les parcours métier.');
    return true;
  });
  const notificationId = myNotifications.body[0].id;
  await expectStatus('Autre utilisateur ne marque pas la notification comme lue', [404, 403], `/notifications/${notificationId}/read`, {
    token: tokens.collabA, method: 'PATCH',
  });
  await expectStatus('Propriétaire marque une notification comme lue', 200, `/notifications/${notificationId}/read`, {
    token: tokens.collabC, method: 'PATCH',
  });
  await expectStatus('Compteur des notifications non lues', 200, '/notifications/my/unread-count', {
    token: tokens.collabC,
  }, (body) => {
    invariant(Number.isInteger(Number(body.unreadCount)), 'Le compteur est invalide.');
    return true;
  });
  await expectStatus('Utilisateur marque toutes ses notifications comme lues', 200, '/notifications/my/read-all', {
    token: tokens.collabC, method: 'PATCH',
  });

  section('Exports RH et statistiques agrégées Directeur');
  await expectStatus('RH exporte les demandes en CSV', 200, '/exports/leave-requests?format=csv', {
    token: tokens.rh, binary: true,
  }, (body, response) => {
    invariant((response.headers.get('content-type') ?? '').includes('text/csv'), 'Content-Type CSV absent.');
    invariant(body.toString('utf8').toLowerCase().includes('statut'), 'En-tête CSV absent.');
    return true;
  });
  await expectStatus('RH exporte les absences en XLSX', 200, '/exports/absence-declarations?format=xlsx', {
    token: tokens.rh, binary: true,
  }, (body) => {
    invariant(body.subarray(0, 2).toString('ascii') === 'PK', 'Signature ZIP/XLSX absente.');
    return true;
  });
  await expectStatus('Directeur ne télécharge pas un export nominatif', 403, '/exports/leave-requests?format=csv', {
    token: tokens.directeur, binary: true,
  });
  const statistics = await expectStatus('Directeur consulte les statistiques agrégées', 200, `/reports/director/statistics?year=${new Date().getFullYear()}`, {
    token: tokens.directeur,
  });
  const sensitiveStatisticsKeys = new Set([
    'nom', 'prenom', 'email', 'comment', 'signatureData', 'employeeSignatureData',
    'validatorSignatureData', 'storageKey', 'originalName', 'employeeId',
  ]);
  const statisticsSafe = !containsKey(statistics.body, sensitiveStatisticsKeys);
  record(
    'Les statistiques Directeur ne contiennent aucune donnée nominative',
    statisticsSafe ? 'PASS' : 'FAIL',
    statisticsSafe ? 'Agrégats uniquement.' : 'Clé sensible détectée.',
  );
  invariant(statisticsSafe, 'Une donnée nominative est exposée dans les statistiques Directeur.');

  section('Clôture N-1/N/N+1 et report exceptionnel');
  const closingPeriod = '2024-2025';
  await initializeBalance(fixtures.collaborators.b.id, closingPeriod, 'N-1', 5);
  await initializeBalance(fixtures.collaborators.b.id, closingPeriod, 'N', 10);
  await initializeBalance(fixtures.collaborators.b.id, closingPeriod, 'N+1', 2);
  await expectStatus('RH prévisualise la clôture', 200, `/leave-balances/period/${closingPeriod}/preview`, {
    token: tokens.rh,
  }, (body) => {
    invariant(body.alreadyClosed === false, 'Période déjà clôturée dans une base neuve.');
    invariant(body.blockedByReservations === false, 'Réservation inattendue sur la période de clôture.');
    return true;
  });
  await expectStatus('Collaborateur ne décide pas un report exceptionnel', 403, '/leave-balances/period/carryover', {
    token: tokens.collabB, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.b.id, closingReferencePeriod: closingPeriod,
      days: 2, reason: 'Report exceptionnel de test.',
    },
  });
  await expectStatus('RH accorde un report exceptionnel', 201, '/leave-balances/period/carryover', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.b.id, closingReferencePeriod: closingPeriod,
      days: 2, reason: 'Nécessité de service constatée pendant le test E2E.',
    },
  });
  await expectStatus('Un report supérieur au reliquat est refusé', 400, '/leave-balances/period/carryover', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.b.id, closingReferencePeriod: closingPeriod,
      days: 10, reason: 'Montant volontairement excessif.',
    },
  });
  await expectStatus('Directeur ne clôture pas les compteurs', 403, '/leave-balances/period/close', {
    token: tokens.directeur, method: 'POST', body: { referencePeriod: closingPeriod, confirm: true },
  });
  await expectStatus('RH clôture transactionnellement la période', 201, '/leave-balances/period/close', {
    token: tokens.rh, method: 'POST', body: { referencePeriod: closingPeriod, confirm: true },
  }, (body) => {
    invariant(body.processedEmployees >= 1, 'Aucun salarié traité.');
    invariant(Number(body.totals.transferredFromN) >= 10, 'Les droits N n’ont pas été transférés.');
    return true;
  });
  await expectStatus('Une seconde clôture de la même période est refusée', 409, '/leave-balances/period/close', {
    token: tokens.rh, method: 'POST', body: { referencePeriod: closingPeriod, confirm: true },
  });
  const [nextBalanceRows] = await db.execute(
    `SELECT available_days AS availableDays
       FROM leave_balances
      WHERE employee_id = ? AND reference_period = '2025-2026' AND counter_type = 'N-1'`,
    [fixtures.collaborators.b.id],
  );
  const nextAvailable = Number(nextBalanceRows[0]?.availableDays ?? -1);
  const closureBalanceOk = nextAvailable === 12;
  record(
    'Le nouveau N-1 contient le report exceptionnel et les droits N transférés',
    closureBalanceOk ? 'PASS' : 'FAIL',
    `Disponible obtenu : ${nextAvailable}; attendu : 12.`,
  );
  invariant(closureBalanceOk, 'Résultat de clôture incorrect.');

  section('Audit technique et métier');
  // L'intercepteur technique enregistre volontairement ses traces sans bloquer la réponse HTTP.
  // Un bref délai évite qu'une lecture immédiate devance la dernière écriture asynchrone.
  await new Promise((resolve) => setTimeout(resolve, 750));
  const audit = await expectStatus('Admin consulte les journaux d’audit', 200, '/audit-logs?limit=500', {
    token: tokens.admin,
  }, (body) => {
    invariant(Array.isArray(body) && body.length > 0, 'Aucun audit disponible.');
    invariant(body.some((row) => row.action === 'DEMANDE_VALIDEE'), 'Audit métier DEMANDE_VALIDEE absent.');
    invariant(body.some((row) => row.action === 'HTTP_POST'), 'Audit technique HTTP_POST absent.');
    invariant(body.some((row) => row.action === 'REFERENCE_PERIOD_CLOSED'), 'Audit de clôture absent.');
    return true;
  });
  const forbiddenAuditKeys = new Set([
    'password', 'passwordHash', 'token', 'signatureData',
    'employeeSignatureData', 'validatorSignatureData', 'file',
  ]);
  const auditSafe = !containsKey(audit.body, forbiddenAuditKeys) && !JSON.stringify(audit.body).includes('AdminGMES@2026!');
  record(
    'Les audits masquent les mots de passe, jetons, signatures et fichiers',
    auditSafe ? 'PASS' : 'FAIL',
    auditSafe ? 'Aucune donnée interdite détectée.' : 'Donnée sensible détectée.',
  );
  invariant(auditSafe, 'Les journaux d’audit exposent une donnée sensible.');

  section('Validation finale de la base');
  const [tableRows] = await db.query(
    `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [expectedTestDatabase],
  );
  const expectedTables = [
    'absence_declarations', 'audit_logs', 'balance_movements', 'derogations',
    'documents', 'holidays', 'leave_balances', 'leave_requests', 'leave_types',
    'notifications', 'services', 'settings', 'users',
  ].sort();
  const actualTables = tableRows.map((row) => row.tableName).sort();
  const schemaOk = JSON.stringify(actualTables) === JSON.stringify(expectedTables);
  record(
    'La base conserve exactement les 13 tables du diagramme',
    schemaOk ? 'PASS' : 'FAIL',
    schemaOk ? '13 tables conformes.' : `Tables obtenues : ${actualTables.join(', ')}`,
  );
  invariant(schemaOk, 'Le schéma a dérivé pendant les tests.');

  return maintenance.body;
}

async function writeReports(fatalError = null) {
  await fs.mkdir(resultsRoot, { recursive: true });
  const passCount = results.filter((item) => item.status === 'PASS').length;
  const failCount = results.filter((item) => item.status === 'FAIL').length;
  const skipCount = results.filter((item) => item.status === 'SKIP').length;
  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    database: testDatabase,
    summary: {
      total: results.length,
      passed: passCount,
      failed: failCount,
      skipped: skipCount,
      success: failCount === 0 && !fatalError,
    },
    fatalError: fatalError
      ? fatalError instanceof Error
        ? fatalError.stack ?? fatalError.message
        : String(fatalError)
      : null,
    results,
  };
  await fs.writeFile(
    path.join(resultsRoot, 'full-functional-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  const markdown = [
    '# Rapport des tests fonctionnels complets — GMES',
    '',
    `- Généré le : ${report.generatedAt}`,
    `- API : ${apiBaseUrl}`,
    `- Base isolée : ${testDatabase}`,
    `- Réussis : ${passCount}`,
    `- Échoués : ${failCount}`,
    `- Ignorés : ${skipCount}`,
    '',
    ...(fatalError ? ['## Erreur fatale', '', '```text', report.fatalError, '```', ''] : []),
    '## Résultats',
    '',
    '| Section | Statut | Contrôle | Détail |',
    '|---|---:|---|---|',
    ...results.map((item) =>
      `| ${item.section.replaceAll('|', '\\|')} | ${item.status} | ${item.label.replaceAll('|', '\\|')} | ${String(item.detail ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')} |`,
    ),
    '',
  ].join('\n');
  await fs.writeFile(path.join(resultsRoot, 'full-functional-report.md'), markdown, 'utf8');

  console.log(`\nBilan : ${passCount} réussis, ${failCount} échoués, ${skipCount} ignorés.`);
  console.log(`Rapport JSON : ${path.join(resultsRoot, 'full-functional-report.json')}`);
  console.log(`Rapport Markdown : ${path.join(resultsRoot, 'full-functional-report.md')}`);
}

let fatalError = null;
try {
  await main();
} catch (error) {
  fatalError = error;
  console.error(error instanceof Error ? error.stack ?? error.message : error);
} finally {
  if (db) await db.end();
  await writeReports(fatalError);
}

const failures = results.filter((item) => item.status === 'FAIL');
if (fatalError || failures.length > 0) process.exitCode = 1;
