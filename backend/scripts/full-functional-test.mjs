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

function martiniqueTimeNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Martinique',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function forceSlot(tokens, label, settingValue) {
  await expectStatus(label, 200, '/settings/AFTERNOON_START_HOUR', {
    token: tokens.rh,
    method: 'PATCH',
    body: {
      settingValue,
      description: `Slot forcé : ${settingValue} (tests demi-journées).`,
    },
  });
  if (settingValue === '23:59') {
    const now = martiniqueTimeNow();
    if (now >= '23:59:00') {
      const [h, m, s] = now.split(':').map(Number);
      const elapsedToday = h * 3600 + m * 60 + s;
      const waitSeconds = 86400 - elapsedToday + 5;
      record(
        `Fenêtre critique 23:59 détectée (${now}) : attente de ${waitSeconds} s vers minuit Martinique`,
        'PASS',
        'Déterminisme préservé : le slot MATIN sera garanti au réveil.',
      );
      await sleep(waitSeconds * 1000);
    }
  }
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
  const replacementDocument = await expectStatus(
    'Collaborateur remplace le justificatif rejeté',
    200,
    `/documents/${documentId}/replace`,
    {
      token: tokens.collabB,
      method: 'PATCH',
      form: replaceForm,
    },
  );

  const replacementDocumentId = Number(replacementDocument.body?.id);

  invariant(
    Number.isInteger(replacementDocumentId) && replacementDocumentId > 0,
    `Identifiant du justificatif de remplacement invalide : ${summarize(replacementDocument.body)}`,
  );
  invariant(
    replacementDocumentId !== documentId,
    'Le remplacement doit archiver l’ancien justificatif et créer un nouveau document.',
  );

  await expectStatus(
    'L’ancien justificatif archivé n’est plus traitable',
    404,
    `/documents/${documentId}/accept`,
    {
      token: tokens.rh,
      method: 'POST',
    },
  );

  await expectStatus(
    'RH accepte le justificatif de remplacement',
    200,
    `/documents/${replacementDocumentId}/accept`,
    {
      token: tokens.rh,
      method: 'POST',
    },
  );
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

  section('E2 — RH agit pour un collaborateur (demandes de congé)');

  const rhProfile = await expectStatus('Identité de la RH lue pour les scénarios E2', 200, '/auth/me', {
    token: tokens.rh,
  });
  const rhUserId = Number(rhProfile.body.id);
  const directeurProfile = await expectStatus('Identité du Directeur lue pour les scénarios E1/E2', 200, '/auth/me', {
    token: tokens.directeur,
  });
  const directeurUserId = Number(directeurProfile.body.id);

  const e2DateA = await nextOpenDate(addDays(scenarioDate, 40));
  const e2DateB = await nextOpenDate(addDays(scenarioDate, 41));
  const e2DateC = await nextOpenDate(addDays(scenarioDate, 42));

  const e2RhDraft = await expectStatus(
    'RH crée un brouillon de congé pour un collaborateur',
    201,
    '/leave-requests',
    {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.collaborators.a.id, leaveTypeId: paidType.id,
        startDate: e2DateA, endDate: e2DateA,
        comment: 'Brouillon créé par la RH pour le collaborateur A.',
      },
    },
    (body) => {
      invariant(Number(body.employeeId) === fixtures.collaborators.a.id, `employeeId obtenu ${body.employeeId}, attendu ${fixtures.collaborators.a.id}.`);
      return true;
    },
  );
  const e2RhDraftId = Number(e2RhDraft.body.id);

  const createdByOk =
    Number(e2RhDraft.body.createdById) === rhUserId &&
    Number(e2RhDraft.body.createdBy?.id) === rhUserId;
  record(
    'La création par la RH est tracée (createdById = RH)',
    createdByOk ? 'PASS' : 'FAIL',
    createdByOk
      ? `createdById = ${rhUserId}.`
      : `createdById = ${e2RhDraft.body.createdById} — la trace désigne le collaborateur au lieu de la RH (${rhUserId}).`,
  );
  invariant(createdByOk, 'La traçabilité de la création RH est incorrecte.');

  const [e2AuditRows] = await db.execute(
    `SELECT actor_id AS actorId FROM audit_logs WHERE action = 'BROUILLON_CREE' ORDER BY id DESC LIMIT 1`,
  );
  const e2AuditOk = Number(e2AuditRows[0]?.actorId) === rhUserId;
  record(
    'L’audit BROUILLON_CREE est attribué à la RH créatrice',
    e2AuditOk ? 'PASS' : 'FAIL',
    e2AuditOk ? `actorId = ${rhUserId}.` : `actorId obtenu : ${e2AuditRows[0]?.actorId}.`,
  );
  invariant(e2AuditOk, 'L’audit BROUILLON_CREE n’est pas attribué à la RH.');

  await expectStatus('Le collaborateur cible consulte la demande créée par la RH', 200, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.collabA,
  }, (body) => {
    invariant(Number(body.employeeId) === fixtures.collaborators.a.id, 'Demande non rattachée au collaborateur cible.');
    invariant(body.status === 'BROUILLON', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('Un collaborateur ne crée pas une demande pour un collègue', 403, '/leave-requests', {
    token: tokens.collabA, method: 'POST',
    body: { employeeId: fixtures.collaborators.b.id, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });
  await expectStatus('Un Responsable ne crée pas une demande pour un collaborateur', 403, '/leave-requests', {
    token: tokens.manager, method: 'POST',
    body: { employeeId: fixtures.collaborators.a.id, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });
  await expectStatus('Le Directeur n’utilise pas le mécanisme RH', 403, '/leave-requests', {
    token: tokens.directeur, method: 'POST',
    body: { employeeId: fixtures.collaborators.a.id, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });
  await expectStatus('Un administrateur ne crée pas de demande métier', 403, '/leave-requests', {
    token: tokens.admin, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });
  await expectStatus('Utilisateur cible inexistant', 404, '/leave-requests', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: 99999999, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });

  const e2DisabledUser = await expectStatus('Admin crée un utilisateur cible (scénario E2)', 201, '/users', {
    token: tokens.admin, method: 'POST',
    body: {
      nom: 'TEST-E2', prenom: 'Désactivé', email: `e2-disabled-${fixtures.tag}@gmes.test`,
      role: 'COLLABORATEUR', employmentType: 'INTERNE', hireDate: '2025-01-01',
      serviceId: fixtures.serviceId,
    },
  });
  await expectStatus('Admin désactive l’utilisateur cible E2', 200, `/users/${e2DisabledUser.body.id}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  await expectStatus('Utilisateur cible désactivé → erreur', 403, '/leave-requests', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e2DisabledUser.body.id, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });

  const [e2HashRows] = await db.query(
    `SELECT password_hash AS passwordHash FROM users WHERE email = 'collaborateur@gmes.fr'`,
  );
  const e2PasswordHash = e2HashRows[0]?.passwordHash;
  invariant(typeof e2PasswordHash === 'string', 'Hash du collaborateur introuvable pour le scénario E2.');
  const [e2NoServiceResult] = await db.execute(
    `INSERT INTO users
      (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
     VALUES ('TEST-E2', 'SansService', ?, ?, 'COLLABORATEUR', 'INTERNE', NULL, '2024-01-01', 'PRESENT', 1)`,
    [`e2-noservice-${fixtures.tag}@gmes.test`, e2PasswordHash],
  );
  const e2NoServiceUserId = Number(e2NoServiceResult.insertId);

  const e2InactiveService = await expectStatus('Admin crée un service inactif pour le scénario E2', 201, '/services', {
    token: tokens.admin, method: 'POST',
    body: {
      name: `ZZ Service E2 ${fixtures.tag}`, serviceType: 'INTERNE',
      validationMode: 'DIRECTEUR_SEUL', takeoverDelayDays: 5,
      minimumPresence: 1, hasMinimumPresenceRule: false,
    },
  });
  await expectStatus('Admin désactive le service du scénario E2', 200, `/services/${e2InactiveService.body.id}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  const [e2InactiveServiceUserResult] = await db.execute(
    `INSERT INTO users
      (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
     VALUES ('TEST-E2', 'ServiceInactif', ?, ?, 'COLLABORATEUR', 'INTERNE', ?, '2024-01-01', 'PRESENT', 1)`,
    [`e2-inactiveservice-${fixtures.tag}@gmes.test`, e2PasswordHash, e2InactiveService.body.id],
  );
  const e2InactiveServiceUserId = Number(e2InactiveServiceUserResult.insertId);

  await expectStatus('Utilisateur cible sans service → erreur', 400, '/leave-requests', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e2NoServiceUserId, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });

  const e2InactiveServiceResult = await request('/leave-requests', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e2InactiveServiceUserId, leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
  });
  const inactiveServiceRejected = e2InactiveServiceResult.response.status === 400;
  record(
    'Utilisateur cible dans un service inactif → erreur',
    inactiveServiceRejected ? 'PASS' : 'FAIL',
    inactiveServiceRejected
      ? 'HTTP 400.'
      : `HTTP ${e2InactiveServiceResult.response.status} — le service inactif n'est pas contrôlé à la création.`,
  );
  if (!inactiveServiceRejected && e2InactiveServiceResult.body?.id) {
    await db.execute('DELETE FROM leave_requests WHERE id = ?', [e2InactiveServiceResult.body.id]);
  }

  await expectStatus('Type réservé à la RH refusé dans une demande de congé', [400, 403], '/leave-requests', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id, startDate: e2DateC, endDate: e2DateC },
  });

  await expectStatus('Le collaborateur cible modifie le brouillon créé par la RH', 200, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.collabA, method: 'PATCH', body: { comment: 'Modification par le collaborateur cible.' },
  });
  await expectStatus('La RH modifie le brouillon qu’elle a créé', 200, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.rh, method: 'PATCH', body: { comment: 'Modification par la RH créatrice.' },
  });
  await expectStatus('La RH créatrice ne soumet pas la demande du collaborateur', 403, `/leave-requests/${e2RhDraftId}/submit`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH' },
  });

  const e2OtherRh = await expectStatus('Admin crée une seconde RH (scénario E2)', 201, '/users', {
    token: tokens.admin, method: 'POST',
    body: {
      nom: 'TEST-E2', prenom: 'AutreRH', email: `e2-other-rh-${fixtures.tag}@gmes.test`,
      role: 'RH', employmentType: 'INTERNE', hireDate: '2025-01-01',
      serviceId: fixtures.serviceId,
    },
  });
  const e2OtherRhResetToken = signPasswordResetToken({
    userId: e2OtherRh.body.id,
    email: e2OtherRh.body.email,
    passwordHash: null,
    secret: jwtSecret,
  });
  await expectStatus('La seconde RH définit son mot de passe', 200, '/auth/define-password', {
    method: 'POST', body: { token: e2OtherRhResetToken, password: 'AutreRhGMES@2026!' },
  });
  tokens.rh2 = await login('seconde RH E2', [e2OtherRh.body.email, 'AutreRhGMES@2026!', 'RH']);

  await expectStatus('Une autre RH ne modifie pas le brouillon créé par la RH', 403, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.rh2, method: 'PATCH', body: { comment: 'Tentative par une autre RH.' },
  });
  await expectStatus('Une autre RH ne soumet pas la demande du collaborateur', 403, `/leave-requests/${e2RhDraftId}/submit`, {
    token: tokens.rh2, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH' },
  });

  await expectStatus('Le collaborateur propriétaire soumet avec sa propre signature', 200, `/leave-requests/${e2RhDraftId}/submit`, {
    token: tokens.collabA, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'CA' },
  }, (body) => {
    invariant(body.status === 'EN_ATTENTE_VALIDATION', `Statut obtenu ${body.status}.`);
    invariant(body.employeeSignatureType === 'INITIALS' && body.employeeSignedAt !== null, 'La signature du collaborateur doit être horodatée.');
    return true;
  });
  const [e2SubmitDbRows] = await db.execute(
    `SELECT employee_signature_data AS employeeSignatureData FROM leave_requests WHERE id = ?`,
    [e2RhDraftId],
  );
  const e2SubmitDbOk = e2SubmitDbRows[0]?.employeeSignatureData === 'CA';
  record(
    'Seule la signature du collaborateur est enregistrée à la soumission',
    e2SubmitDbOk ? 'PASS' : 'FAIL',
    e2SubmitDbOk ? "employeeSignatureData = 'CA'." : `Valeur obtenue : ${e2SubmitDbRows[0]?.employeeSignatureData}.`,
  );
  invariant(e2SubmitDbOk, 'La signature enregistrée n’est pas celle du collaborateur.');

  await expectStatus('La RH créatrice ne modifie pas la demande soumise', 403, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.rh, method: 'PATCH', body: { comment: 'Tentative après soumission.' },
  });
  await expectStatus('Une autre RH ne modifie pas la demande soumise', 403, `/leave-requests/${e2RhDraftId}`, {
    token: tokens.rh2, method: 'PATCH', body: { comment: 'Tentative après soumission.' },
  });
  await expectStatus('La RH ne peut pas annuler avant décision à la place du collaborateur', 403, `/leave-requests/${e2RhDraftId}/cancel`, {
    token: tokens.rh, method: 'POST', body: { reason: 'Tentative RH.' },
  });

  await expectStatus('Le collaborateur propriétaire annule sa demande', 200, `/leave-requests/${e2RhDraftId}/cancel`, {
    token: tokens.collabA, method: 'POST', body: { reason: 'Fin du scénario E2.' },
  }, (body) => {
    invariant(body.status === 'ANNULEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e2CreatorDraft = await expectStatus(
    'La RH crée un second brouillon pour le collaborateur',
    201,
    '/leave-requests',
    {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.collaborators.a.id, leaveTypeId: paidType.id,
        startDate: e2DateC, endDate: e2DateC,
        comment: 'Brouillon RH à supprimer (scénario E2).',
      },
    },
  );
  await expectStatus('Une autre RH ne supprime pas le brouillon créé par la RH', 403, `/leave-requests/${e2CreatorDraft.body.id}`, {
    token: tokens.rh2, method: 'DELETE',
  });
  await expectStatus('La RH créatrice supprime son brouillon', 204, `/leave-requests/${e2CreatorDraft.body.id}`, {
    token: tokens.rh, method: 'DELETE',
  });

  const e2OwnDraft = await expectStatus(
    'Un collaborateur crée son propre brouillon (contrôle E2)',
    201,
    '/leave-requests',
    {
      token: tokens.collabB, method: 'POST',
      body: { leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB, comment: 'Brouillon personnel de contrôle.' },
    },
  );
  const e2OverbroadResult = await request(`/leave-requests/${e2OwnDraft.body.id}`, {
    token: tokens.rh, method: 'PATCH', body: { comment: 'Tentative de modification par une RH non impliquée.' },
  });
  const overbroadRejected = [403, 404].includes(e2OverbroadResult.response.status);
  record(
    'Une RH ne modifie pas une demande personnelle d’un collaborateur',
    overbroadRejected ? 'PASS' : 'FAIL',
    overbroadRejected
      ? `HTTP ${e2OverbroadResult.response.status}.`
      : `HTTP ${e2OverbroadResult.response.status} — droit d'écriture trop large accordé à toute RH.`,
  );
  await expectStatus('Le collaborateur supprime son brouillon personnel', 204, `/leave-requests/${e2OwnDraft.body.id}`, {
    token: tokens.collabB, method: 'DELETE',
  });

  await expectStatus('Admin désactive le service du collaborateur A (scénario E2-4)', 200, `/services/${fixtures.serviceId}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  await expectStatus('Le collaborateur ne crée pas de demande dans un service inactif', 400, '/leave-requests', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC },
  });
  await expectStatus('La RH ne crée pas d’absence pour un collaborateur d’un service inactif', 400, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: e2DateB, endDate: e2DateB, durationHours: 7,
    },
  });
  await expectStatus('Admin réactive le service du collaborateur A', 200, `/services/${fixtures.serviceId}/enable`, {
    token: tokens.admin, method: 'PATCH',
  });
  const e2RestoreDraft = await expectStatus(
    'Le collaborateur peut à nouveau créer après réactivation du service',
    201,
    '/leave-requests',
    {
      token: tokens.collabA, method: 'POST',
      body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC, comment: 'Vérification restauration du service.' },
    },
  );
  await expectStatus('Le collaborateur supprime le brouillon de vérification', 204, `/leave-requests/${e2RestoreDraft.body.id}`, {
    token: tokens.collabA, method: 'DELETE',
  });

  await expectStatus('La RH ne crée pas d’absence pour un collaborateur d’un service inactif (cible dédiée)', 400, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: e2InactiveServiceUserId, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: e2DateB, endDate: e2DateB, durationHours: 7,
    },
  });

  const [e2DirectorServiceRows] = await db.execute(
    `SELECT service_id AS serviceId FROM users WHERE id = ?`,
    [directeurUserId],
  );
  const e2DirectorServiceId = e2DirectorServiceRows[0]?.serviceId
    ? Number(e2DirectorServiceRows[0].serviceId)
    : null;
  if (e2DirectorServiceId === null) {
    record('Route Directeur avec service inactif', 'SKIP', 'Le Directeur n’est affecté à aucun service dans cette base.');
  } else {
    await expectStatus('Admin désactive le service du Directeur (scénario E2-4)', 200, `/services/${e2DirectorServiceId}/disable`, {
      token: tokens.admin, method: 'PATCH',
    });
    await expectStatus('Le Directeur ne peut pas enregistrer de congé dans un service inactif', 400, '/leave-requests/director', {
      token: tokens.directeur, method: 'POST',
      body: { leaveTypeId: paidType.id, startDate: e2DateB, endDate: e2DateB },
    });
    await expectStatus('Admin réactive le service du Directeur', 200, `/services/${e2DirectorServiceId}/enable`, {
      token: tokens.admin, method: 'PATCH',
    });
  }

  section('E1 — Directeur : enregistrement direct des congés');

  await expectStatus('Un collaborateur ne peut pas utiliser la route Directeur', 403, '/leave-requests/director', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC },
  });
  await expectStatus('Un Responsable ne peut pas utiliser la route Directeur', 403, '/leave-requests/director', {
    token: tokens.manager, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC },
  });
  await expectStatus('Une RH ne peut pas utiliser la route Directeur', 403, '/leave-requests/director', {
    token: tokens.rh, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC },
  });
  await expectStatus('Un administrateur ne peut pas utiliser la route Directeur', 403, '/leave-requests/director', {
    token: tokens.admin, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e2DateC, endDate: e2DateC },
  });

  const e1Date = await nextOpenDate(addDays(scenarioDate, 50));
  let e1HolidayDate = nonSunday(await nextOpenDate(addDays(scenarioDate, 55)));
  let e1FermetureDate = nonSunday(await nextOpenDate(addDays(scenarioDate, 56)));
  while (e1FermetureDate === e1HolidayDate) {
    e1FermetureDate = nonSunday(addDays(e1FermetureDate, 1));
  }
  let e1Sunday = addDays(e1Date, ((7 - new Date(`${e1Date}T00:00:00.000Z`).getUTCDay()) % 7) || 7);
  while (e1Sunday === e1Date || e1Sunday === e1HolidayDate || e1Sunday === e1FermetureDate) {
    e1Sunday = addDays(e1Sunday, 7);
  }
  let e1InsufficientDate = await nextOpenDate(addDays(scenarioDate, 57));
  while (new Date(`${addDays(e1InsufficientDate, 1)}T00:00:00.000Z`).getUTCDay() === 0) {
    e1InsufficientDate = await nextOpenDate(addDays(e1InsufficientDate, 1));
  }
  let e1Saturday = addDays(e1Date, 1);
  while (new Date(`${e1Saturday}T00:00:00.000Z`).getUTCDay() !== 6) {
    e1Saturday = addDays(e1Saturday, 1);
  }
  while (e1Saturday === e1HolidayDate || e1Saturday === e1FermetureDate || e1Saturday === e1InsufficientDate) {
    e1Saturday = addDays(e1Saturday, 7);
  }
  let e1HalfDate = await nextOpenDate(addDays(scenarioDate, 51));
  while (e1HalfDate === e1Date || e1HalfDate === e1Saturday) {
    e1HalfDate = await nextOpenDate(addDays(e1HalfDate, 1));
  }

  const dirBalance = await initializeBalance(directeurUserId, operationalPeriod, 'N-1', 100);
  const dirBalanceId = Number(dirBalance.id);

  await expectStatus('RH réduit le solde du Directeur pour le scénario de solde insuffisant', 201, `/leave-balances/${dirBalanceId}/correction`, {
    token: tokens.rh, method: 'POST', body: { days: -99, reason: 'Scénario E2E solde insuffisant.' },
  });
  await expectStatus('Solde insuffisant du Directeur → 400', 400, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1InsufficientDate, endDate: addDays(e1InsufficientDate, 1) },
  });
  const [e1InsufficientRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM leave_requests WHERE employee_id = ? AND start_date = ?`,
    [directeurUserId, e1InsufficientDate],
  );
  const e1NoRow = Number(e1InsufficientRows[0]?.total ?? 1) === 0;
  record(
    'La transaction du Directeur est cohérente : aucune demande sans solde',
    e1NoRow ? 'PASS' : 'FAIL',
    e1NoRow ? 'Aucun enregistrement en base.' : 'Une demande fantôme existe malgré le 400.',
  );
  invariant(e1NoRow, 'La demande du Directeur a été persistée malgré le solde insuffisant.');
  const [e1BalanceAfterFail] = await db.execute(
    `SELECT available_days AS availableDays FROM leave_balances WHERE employee_id = ? AND reference_period = ? AND counter_type = 'N-1'`,
    [directeurUserId, operationalPeriod],
  );
  invariant(Number(e1BalanceAfterFail[0]?.availableDays) === 1, `Solde après échec : ${e1BalanceAfterFail[0]?.availableDays}.`);
  await expectStatus('RH restaure le solde du Directeur', 201, `/leave-balances/${dirBalanceId}/correction`, {
    token: tokens.rh, method: 'POST', body: { days: 99, reason: 'Restauration du scénario E2E.' },
  });

  const e1Request = await expectStatus(
    'Directeur enregistre un congé payé sans circuit de validation',
    201,
    '/leave-requests/director',
    {
      token: tokens.directeur, method: 'POST',
      body: { leaveTypeId: paidType.id, startDate: e1Date, endDate: e1Date, comment: 'Congé Directeur E2E.' },
    },
    (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      invariant(Number(body.deductedDays) === 1, `deductedDays obtenu ${body.deductedDays}.`);
      invariant(body.employeeSignatureType === null && body.employeeSignedAt === null && body.validatorSignatureType === null && body.validatorSignedAt === null, 'Des signatures sont présentes alors qu’aucune n’est requise.');
      invariant(body.finalDeciderRole === 'DIRECTEUR', `finalDeciderRole obtenu ${body.finalDeciderRole}.`);
      invariant(Number(body.finalDeciderId) === directeurUserId, 'Le décideur final n’est pas le Directeur.');
      invariant(body.modificationDeadline === null, 'Une demande Directeur ne doit pas avoir de date limite de modification.');
      invariant(body.submittedAt !== null && body.decisionAt !== null, 'Horodatage incomplet.');
      invariant(Number(body.createdBy?.id) === directeurUserId, 'createdBy différent du Directeur.');
      return true;
    },
  );
  const e1RequestId = Number(e1Request.body.id);

  const [e1SignatureRows] = await db.execute(
    `SELECT employee_signature_data AS esd, validator_signature_data AS vsd FROM leave_requests WHERE id = ?`,
    [e1RequestId],
  );
  const e1NoSignatureOk = e1SignatureRows[0]?.esd === null && e1SignatureRows[0]?.vsd === null;
  record(
    'Aucune signature en base pour la demande Directeur',
    e1NoSignatureOk ? 'PASS' : 'FAIL',
    e1NoSignatureOk ? 'Signature collaborateur et valideur absentes.' : 'Une signature est présente en base.',
  );
  invariant(e1NoSignatureOk, 'La demande Directeur contient une signature.');

  const [e1AuditRows] = await db.execute(
    `SELECT action FROM audit_logs WHERE actor_id = ? AND action IN ('CONGE_DIRECTEUR_ENREGISTRE','DEMANDE_SOUMISE','DEMANDE_VALIDEE')`,
    [directeurUserId],
  );
  const e1AuditActions = e1AuditRows.map((row) => row.action);
  const e1AuditOk =
    e1AuditActions.includes('CONGE_DIRECTEUR_ENREGISTRE') &&
    !e1AuditActions.includes('DEMANDE_SOUMISE') &&
    !e1AuditActions.includes('DEMANDE_VALIDEE');
  record(
    'L’audit trace l’enregistrement Directeur sans passage par le circuit',
    e1AuditOk ? 'PASS' : 'FAIL',
    e1AuditOk ? `Actions : ${e1AuditActions.join(', ')}.` : `Actions obtenues : ${e1AuditActions.join(', ')}.`,
  );
  invariant(e1AuditOk, 'L’audit de la demande Directeur est incohérent.');

  const [e1NotificationRows] = await db.execute(
    `SELECT type FROM notifications WHERE leave_request_id = ?`,
    [e1RequestId],
  );
  const e1NotificationTypes = e1NotificationRows.map((row) => row.type);
  const e1NotificationOk =
    e1NotificationTypes.includes('CONGE_DIRECTEUR_ENREGISTRE') &&
    !e1NotificationTypes.includes('LEAVE_REQUEST_SUBMITTED');
  record(
    'La notification interne confirme l’enregistrement Directeur',
    e1NotificationOk ? 'PASS' : 'FAIL',
    e1NotificationOk ? `Types : ${e1NotificationTypes.join(', ')}.` : `Types obtenus : ${e1NotificationTypes.join(', ')}.`,
  );
  invariant(e1NotificationOk, 'Notifications incohérentes pour la demande Directeur.');

  const [e1BalanceRows] = await db.execute(
    `SELECT available_days AS availableDays FROM leave_balances WHERE employee_id = ? AND reference_period = ? AND counter_type = 'N-1'`,
    [directeurUserId, operationalPeriod],
  );
  const e1BalanceOk = Number(e1BalanceRows[0]?.availableDays) === 99;
  record(
    'Le solde N-1 du Directeur est déduit d’un jour',
    e1BalanceOk ? 'PASS' : 'FAIL',
    e1BalanceOk ? 'Solde = 99.' : `Solde obtenu : ${e1BalanceRows[0]?.availableDays}.`,
  );
  invariant(e1BalanceOk, 'La déduction du solde Directeur est incorrecte.');

  const e1Today = martiniqueToday();
  const e1TodayUsable = new Date(`${e1Today}T00:00:00.000Z`).getUTCDay() !== 0;
  if (e1TodayUsable) {
    await expectStatus('Directeur enregistre un congé le jour même', 201, '/leave-requests/director', {
      token: tokens.directeur, method: 'POST',
      body: { leaveTypeId: paidType.id, startDate: e1Today, endDate: e1Today, comment: 'Congé jour même Directeur.' },
    });
    const [e1PresenceRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [directeurUserId],
    );
    const e1PresenceOk = e1PresenceRows[0]?.presenceStatus === 'EN_VACANCES';
    record(
      'Le statut de présence du Directeur passe à EN_VACANCES',
      e1PresenceOk ? 'PASS' : 'FAIL',
      e1PresenceOk ? 'EN_VACANCES.' : `Statut obtenu : ${e1PresenceRows[0]?.presenceStatus}.`,
    );
    invariant(e1PresenceOk, 'Statut de présence Directeur incorrect après congé du jour.');
  } else {
    record('Présence du Directeur au jour courant', 'SKIP', 'Journée dominicale : aucun congé ne peut commencer un dimanche.');
  }

  await expectStatus('Chevauchement personnel du Directeur refusé', 400, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1Date, endDate: e1Date },
  });
  await expectStatus('Un dimanche est refusé pour le Directeur', 400, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1Sunday, endDate: e1Sunday },
  });

  const e1Holiday = await expectStatus('RH crée un jour férié Martinique pour le scénario E1', 201, '/holidays', {
    token: tokens.rh, method: 'POST',
    body: { date: e1HolidayDate, name: `Férié E1 ${fixtures.tag}`, holidayType: 'MARTINIQUE', deductible: false, source: 'TEST_E2E' },
  });
  await expectStatus('Un jour férié Martinique est refusé au Directeur', 400, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1HolidayDate, endDate: e1HolidayDate },
  });
  await expectStatus('RH désactive le jour férié du scénario E1', 200, `/holidays/${e1Holiday.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });

  const e1Fermeture = await expectStatus('RH crée une fermeture GMES pour le scénario E1', 201, '/holidays', {
    token: tokens.rh, method: 'POST',
    body: { date: e1FermetureDate, name: `Fermeture E1 ${fixtures.tag}`, holidayType: 'FERMETURE_GMES', deductible: false, source: 'TEST_E2E' },
  });
  await expectStatus('Une fermeture GMES est refusée au Directeur', 400, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1FermetureDate, endDate: e1FermetureDate },
  });
  await expectStatus('RH désactive la fermeture du scénario E1', 200, `/holidays/${e1Fermeture.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });

  await expectStatus('Le Directeur peut enregistrer un samedi', 201, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1Saturday, endDate: e1Saturday },
  });
  await expectStatus('Le Directeur enregistre une demi-journée', 201, '/leave-requests/director', {
    token: tokens.directeur, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: e1HalfDate, endDate: e1HalfDate, startPeriod: 'MATIN', endPeriod: 'MATIN' },
  }, (body) => {
    invariant(Number(body.deductedDays) === 0.5, `deductedDays obtenu ${body.deductedDays}.`);
    return true;
  });

  section('E3 — Présence calculée et relais du Responsable');

  const e3Today = martiniqueToday();
  const e3TodayOpen = new Date(`${e3Today}T00:00:00.000Z`).getUTCDay() !== 0;
  const e3RelaisDate1 = await nextOpenDate(addDays(scenarioDate, 30));
  const e3RelaisDate2 = await nextOpenDate(addDays(scenarioDate, 31));
  const e3RelaisDate3 = await nextOpenDate(addDays(scenarioDate, 32));
  const e3CollabLeaveDate = await nextOpenDate(addDays(scenarioDate, 33));

  if (!e3TodayOpen) {
    record('E3 — Présence calculée et relais du Responsable', 'SKIP', 'Journée dominicale : congés et absences ne peuvent pas commencer un dimanche.');
  } else {
    await initializeBalance(fixtures.collaborators.b.id, operationalPeriod, 'N-1', 100);
    const e3CollabLeave = await createRequest(tokens.collabB, paidType.id, e3CollabLeaveDate, 'Congé futur (scénario E3)');
    await submitRequest(tokens.collabB, e3CollabLeave.id);
    await expectStatus('Le Responsable valide le congé futur du collaborateur', 200, `/leave-requests/${e3CollabLeave.id}/validate`, {
      token: tokens.manager, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Continuité assurée.' },
    }, (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      return true;
    });
    const [e3PresentRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [fixtures.collaborators.b.id],
    );
    const e3PresentOk = e3PresentRows[0]?.presenceStatus === 'PRESENT';
    record(
      'Un congé validé futur ne modifie pas le statut du jour (PRESENT)',
      e3PresentOk ? 'PASS' : 'FAIL',
      e3PresentOk ? 'PRESENT.' : `Statut obtenu : ${e3PresentRows[0]?.presenceStatus}.`,
    );
    invariant(e3PresentOk, 'Le statut du jour ne doit pas dépendre d’un congé futur.');

    const e3Absence = await expectStatus('RH crée une absence autorisée pour le jour même', 201, '/absence-declarations', {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.collaborators.b.id, leaveTypeId: rhOnlyAbsenceType.id,
        startDate: e3Today, endDate: e3Today,
        durationHours: 7, comment: 'Absence autorisée E3.',
      },
    });
    await expectStatus('La RH soumet l’absence enregistrée', 200, `/absence-declarations/${e3Absence.body.id}/submit`, {
      token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
    }, (body) => {
      invariant(body.status === 'ENREGISTREE', `Statut obtenu ${body.status}.`);
      return true;
    });
    const [e3AbsentRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [fixtures.collaborators.b.id],
    );
    const e3AbsentOk = e3AbsentRows[0]?.presenceStatus === 'ABSENT';
    record(
      'Une absence enregistrée le jour même rend le collaborateur ABSENT',
      e3AbsentOk ? 'PASS' : 'FAIL',
      e3AbsentOk ? 'ABSENT.' : `Statut obtenu : ${e3AbsentRows[0]?.presenceStatus}.`,
    );
    invariant(e3AbsentOk, 'Le statut ABSENT n’est pas appliqué.');

    await expectStatus('La RH annule l’absence enregistrée', 200, `/absence-declarations/${e3Absence.body.id}/cancel`, {
      token: tokens.rh, method: 'POST',
    });
    const [e3ReturnRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [fixtures.collaborators.b.id],
    );
    const e3ReturnOk = e3ReturnRows[0]?.presenceStatus === 'PRESENT';
    record(
      'L’annulation d’une absence ramène le statut à PRESENT',
      e3ReturnOk ? 'PASS' : 'FAIL',
      e3ReturnOk ? 'PRESENT.' : `Statut obtenu : ${e3ReturnRows[0]?.presenceStatus}.`,
    );
    invariant(e3ReturnOk, 'Le retour à PRESENT échoue après annulation.');

    await forceSlot(tokens, 'RH force le slot MATIN (AFTERNOON_START_HOUR=23:59)', '23:59');
    const e3HalfAbsence = await expectStatus('RH crée une absence autorisée demi-journée', 201, '/absence-declarations', {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.collaborators.c.id, leaveTypeId: rhOnlyAbsenceType.id,
        startDate: martiniqueToday(), endDate: martiniqueToday(), startPeriod: 'MATIN', endPeriod: 'MATIN',
        comment: 'Demi-journée E3.',
      },
    });
    await expectStatus('La RH soumet l’absence demi-journée', 200, `/absence-declarations/${e3HalfAbsence.body.id}/submit`, {
      token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
    });
    const [e3HalfRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [fixtures.collaborators.c.id],
    );
    const e3HalfOk = e3HalfRows[0]?.presenceStatus === 'ABSENT';
    record(
      'Une absence demi-journée (MATIN) rend ABSENT sur le slot courant MATIN',
      e3HalfOk ? 'PASS' : 'FAIL',
      e3HalfOk ? 'ABSENT (slot MATIN).' : `Statut obtenu : ${e3HalfRows[0]?.presenceStatus}.`,
    );
    invariant(e3HalfOk, 'Le statut devrait être ABSENT sur le slot MATIN.');

    await forceSlot(tokens, 'RH force le slot APRES_MIDI (AFTERNOON_START_HOUR=00:00)', '00:00');
    await expectStatus('Maintenance : recalcule les statuts sur le slot courant', 200, '/leave-requests/maintenance/run', {
      token: tokens.rh, method: 'POST',
    }, (body) => {
      invariant(body.presenceStatusesRefreshed >= 1, `presenceStatusesRefreshed obtenu ${body.presenceStatusesRefreshed}.`);
      return true;
    });
    const [e3HalfPmRows] = await db.execute(
      `SELECT presence_status AS presenceStatus FROM users WHERE id = ?`,
      [fixtures.collaborators.c.id],
    );
    const e3HalfPmOk = e3HalfPmRows[0]?.presenceStatus === 'PRESENT';
    record(
      'Une absence demi-journée (MATIN) laisse PRESENT sur le slot APRES_MIDI',
      e3HalfPmOk ? 'PASS' : 'FAIL',
      e3HalfPmOk ? 'PRESENT (slot APRES_MIDI).' : `Statut obtenu : ${e3HalfPmRows[0]?.presenceStatus}.`,
    );
    invariant(e3HalfPmOk, 'Le statut devrait être PRESENT sur le slot APRES_MIDI.');
    await expectStatus('RH restaure AFTERNOON_START_HOUR à 12:00', 200, '/settings/AFTERNOON_START_HOUR', {
      token: tokens.rh, method: 'PATCH',
      body: { settingValue: '12:00', description: 'Valeur nominale restaurée.' },
    });
    await expectStatus('La RH annule l’absence demi-journée', 200, `/absence-declarations/${e3HalfAbsence.body.id}/cancel`, {
      token: tokens.rh, method: 'POST',
    });

    await initializeBalance(fixtures.manager.id, operationalPeriod, 'N-1', 100);
    const e3ManagerAbsence = await expectStatus('RH crée une absence autorisée pour le Responsable', 201, '/absence-declarations', {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.manager.id, leaveTypeId: rhOnlyAbsenceType.id,
        startDate: e3Today, endDate: e3Today,
        durationHours: 7, comment: 'Absence du Responsable pour le relais E3.',
      },
    });
    await expectStatus('La RH soumet l’absence du Responsable', 200, `/absence-declarations/${e3ManagerAbsence.body.id}/submit`, {
      token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
    });

    const e3RelaisRequest = await createRequest(tokens.collabA, paidType.id, e3RelaisDate1, 'Relais Responsable indisponible');
    await submitRequest(tokens.collabA, e3RelaisRequest.id);
    await expectStatus('La RH reprend la validation via le relais (Responsable ABSENT)', 200, `/leave-requests/${e3RelaisRequest.id}/validate`, {
      token: tokens.rh, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Relais du Responsable indisponible.' },
    }, (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      return true;
    });
    const [e3RelaisAuditRows] = await db.execute(
      `SELECT action FROM audit_logs WHERE action = 'REPRISE_PAR_RELAIS' AND actor_id = ?`,
      [rhUserId],
    );
    const e3RelaisAuditOk = e3RelaisAuditRows.length > 0;
    record(
      'Le relais est tracé dans l’audit (REPRISE_PAR_RELAIS)',
      e3RelaisAuditOk ? 'PASS' : 'FAIL',
      e3RelaisAuditOk ? 'Trace présente.' : 'Aucune trace REPRISE_PAR_RELAIS.',
    );
    invariant(e3RelaisAuditOk, 'L’audit du relais est absent.');

    await expectStatus('La RH annule l’absence du Responsable', 200, `/absence-declarations/${e3ManagerAbsence.body.id}/cancel`, {
      token: tokens.rh, method: 'POST',
    });
    await forceSlot(tokens, 'RH force le slot MATIN (AFTERNOON_START_HOUR=23:59)', '23:59');
    const e3ManagerHalfAbsence = await expectStatus('RH crée une absence demi-journée pour le Responsable', 201, '/absence-declarations', {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: fixtures.manager.id, leaveTypeId: rhOnlyAbsenceType.id,
        startDate: martiniqueToday(), endDate: martiniqueToday(), startPeriod: 'MATIN', endPeriod: 'MATIN',
        comment: 'Demi-journée du Responsable E3.',
      },
    });
    await expectStatus('La RH soumet l’absence demi-journée du Responsable', 200, `/absence-declarations/${e3ManagerHalfAbsence.body.id}/submit`, {
      token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
    });
    const e3HalfRelaisAfternoonDate = await nextOpenDate(addDays(scenarioDate, 40));
    await expectStatus('RH force le slot MATIN (AFTERNOON_START_HOUR=23:59)', 200, '/settings/AFTERNOON_START_HOUR', {
      token: tokens.rh, method: 'PATCH',
      body: { settingValue: '23:59', description: 'Force le slot MATIN (relais demi-journée E3).' },
    });
    const e3HalfRelaisRequest = await createRequest(tokens.collabA, unpaidType.id, e3RelaisDate2, 'Relais Responsable demi-journée');
    await submitRequest(tokens.collabA, e3HalfRelaisRequest.id);
    await expectStatus('Absence MATIN du Responsable : relais autorisé le matin', 200, `/leave-requests/${e3HalfRelaisRequest.id}/validate`, {
      token: tokens.rh, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Relais du Responsable demi-journée (matin).' },
    }, (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      return true;
    });

    await forceSlot(tokens, 'RH force le slot APRES_MIDI (AFTERNOON_START_HOUR=00:00)', '00:00');
    const e3HalfRelaisPmRequest = await createRequest(tokens.collabA, unpaidType.id, e3HalfRelaisAfternoonDate, 'Relais Responsable demi-journée (après-midi)');
    await submitRequest(tokens.collabA, e3HalfRelaisPmRequest.id);
    await expectStatus('Absence MATIN du Responsable : priorité Responsable l’après-midi', 403, `/leave-requests/${e3HalfRelaisPmRequest.id}/validate`, {
      token: tokens.rh, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true },
    });
    await expectStatus('Le Responsable valide sa demande de l’après-midi', 200, `/leave-requests/${e3HalfRelaisPmRequest.id}/validate`, {
      token: tokens.manager, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Continuité assurée.' },
    }, (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      return true;
    });
    record(
      'Le relais du Responsable est décidé slot par slot (demi-journée)',
      'PASS',
      'MATIN : relais RH autorisé ; APRES_MIDI : priorité Responsable restaurée automatiquement.',
    );
    await expectStatus('RH restaure AFTERNOON_START_HOUR à 12:00', 200, '/settings/AFTERNOON_START_HOUR', {
      token: tokens.rh, method: 'PATCH',
      body: { settingValue: '12:00', description: 'Valeur nominale restaurée.' },
    });

    await expectStatus('La RH annule l’absence demi-journée du Responsable', 200, `/absence-declarations/${e3ManagerHalfAbsence.body.id}/cancel`, {
      token: tokens.rh, method: 'POST',
    });
    const e3ReturnRelaisRequest = await createRequest(tokens.collabA, unpaidType.id, e3RelaisDate3, 'Retour du Responsable');
    await submitRequest(tokens.collabA, e3ReturnRelaisRequest.id);
    await expectStatus('Le retour à PRESENT du Responsable rétablit sa priorité', 403, `/leave-requests/${e3ReturnRelaisRequest.id}/validate`, {
      token: tokens.rh, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true },
    });

    await db.execute(`UPDATE users SET presence_status = 'EN_VACANCES' WHERE id = ?`, [fixtures.manager.id]);
    const e3StaleRequest = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(e3RelaisDate3, 1)), 'Champ stocké obsolète');
    await submitRequest(tokens.collabA, e3StaleRequest.id);
    await expectStatus('Un champ stocké obsolète ne déclenche pas le relais (présence recalculée)', 403, `/leave-requests/${e3StaleRequest.id}/validate`, {
      token: tokens.rh, method: 'POST',
      body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true },
    });
    await db.execute(`UPDATE users SET presence_status = 'PRESENT' WHERE id = ?`, [fixtures.manager.id]);
  }

  section('Demi-journées — OPTION D (slots MATIN / APRES_MIDI)');

  const restoreAfternoonStartHour = async () => {
    await expectStatus('RH restaure AFTERNOON_START_HOUR à 12:00', 200, '/settings/AFTERNOON_START_HOUR', {
      token: tokens.rh, method: 'PATCH',
      body: { settingValue: '12:00', description: 'Valeur nominale restaurée.' },
    });
  };

  for (const invalidValue of ['25:00', '12:60', '12h00', 'midi', 'abc']) {
    await expectStatus(`AFTERNOON_START_HOUR invalide (${invalidValue}) refusé`, 400, '/settings/AFTERNOON_START_HOUR', {
      token: tokens.rh, method: 'PATCH',
      body: { settingValue: invalidValue, description: 'Valeur invalide du test.' },
    });
  }
  await expectStatus('AFTERNOON_START_HOUR valide (08:30) accepté', 200, '/settings/AFTERNOON_START_HOUR', {
    token: tokens.rh, method: 'PATCH',
    body: { settingValue: '08:30', description: 'Valeur temporaire du test.' },
  });
  await expectStatus('AFTERNOON_START_HOUR relu depuis la base', 200, '/settings/AFTERNOON_START_HOUR', {
    token: tokens.rh,
  }, (body) => {
    invariant(body.settingValue === '08:30', `Valeur relue ${body.settingValue}.`);
    return true;
  });
  await restoreAfternoonStartHour();

  const halfInvertedDate = await nextOpenDate(addDays(scenarioDate, 42));
  await expectStatus('Congé APRES_MIDI→MATIN même date refusé (création)', 400, '/leave-requests', {
    token: tokens.collabA, method: 'POST',
    body: { leaveTypeId: paidType.id, startDate: halfInvertedDate, endDate: halfInvertedDate, startPeriod: 'APRES_MIDI', endPeriod: 'MATIN', comment: 'Combinaison invalide.' },
  });
  await expectStatus('Absence APRES_MIDI→MATIN même date refusée (création)', 400, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id, startDate: halfInvertedDate, endDate: halfInvertedDate, startPeriod: 'APRES_MIDI', endPeriod: 'MATIN', comment: 'Combinaison invalide.' },
  });
  const halfInvertedDraft = await createRequest(tokens.collabA, paidType.id, halfInvertedDate, 'Brouillon bascule invalide', { startPeriod: 'MATIN', endPeriod: 'MATIN' });
  await expectStatus('Bascule APRES_MIDI→MATIN même date refusée (mise à jour)', 400, `/leave-requests/${halfInvertedDraft.id}`, {
    token: tokens.collabA, method: 'PATCH', body: { startPeriod: 'APRES_MIDI', endPeriod: 'MATIN' },
  });
  await expectStatus('Suppression du brouillon de bascule', 204, `/leave-requests/${halfInvertedDraft.id}`, {
    token: tokens.collabA, method: 'DELETE',
  });

  const mixedDate = await nextOpenDate(addDays(scenarioDate, 70));
  const mixedDateH = await nextOpenDate(addDays(scenarioDate, 73));
  const mixedDateHd = await nextOpenDate(addDays(scenarioDate, 76));
  const mixedDateHrD = await nextOpenDate(addDays(scenarioDate, 79));
  const mixedDateHdD = await nextOpenDate(addDays(scenarioDate, 82));
  const MIXED_MODE_MESSAGE =
    'Une absence doit être saisie soit en jours/demi-journées, soit en heures, mais pas dans les deux modes simultanément.';
  const readAbsence = async (id) => {
    const [rows] = await db.execute(
      `SELECT start_period AS startPeriod, end_period AS endPeriod,
              duration_days AS durationDays, duration_hours AS durationHours
       FROM absence_declarations WHERE id = ?`,
      [id],
    );
    return rows[0];
  };

  await expectStatus('Absence durationHours + startPeriod refusée (mélange de modes)', 400, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDate, endDate: mixedDate, startPeriod: 'MATIN', durationHours: 3,
      comment: 'Mélange interdit.',
    },
  }, (body) => {
    invariant(body.message === MIXED_MODE_MESSAGE, `Message obtenu : ${JSON.stringify(body.message)}.`);
    return true;
  });
  await expectStatus('Absence durationHours + endPeriod refusée (mélange de modes)', 400, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDate, endDate: mixedDate, endPeriod: 'MATIN', durationHours: 3,
      comment: 'Mélange interdit.',
    },
  });

  const mixedHoursAbsence = await expectStatus('Absence en heures seule acceptée (durationHours=4)', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDateH, endDate: mixedDateH, durationHours: 4, comment: 'Mode heures pur.',
    },
  });
  const mixedHoursStored = await readAbsence(mixedHoursAbsence.body.id);
  const mixedHoursOk =
    mixedHoursStored.startPeriod === null &&
    mixedHoursStored.endPeriod === null &&
    mixedHoursStored.durationDays === null &&
    Number(mixedHoursStored.durationHours) === 4;
  record(
    'Absence en heures : startPeriod/endPeriod/durationDays nuls, durationHours=4',
    mixedHoursOk ? 'PASS' : 'FAIL',
    mixedHoursOk ? 'Mode heures appliqué.' : `Stockage obtenu : ${JSON.stringify(mixedHoursStored)}.`,
  );
  invariant(mixedHoursOk, 'Le mode heures doit nuler périodes et jours.');
  await expectStatus('La RH annule l’absence en heures', 200, `/absence-declarations/${mixedHoursAbsence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });

  const mixedHalfAbsence = await expectStatus('Absence demi-journée seule acceptée (MATIN/MATIN)', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDateHd, endDate: mixedDateHd, startPeriod: 'MATIN', endPeriod: 'MATIN',
      comment: 'Mode demi-journée pur.',
    },
  });
  const mixedHalfStored = await readAbsence(mixedHalfAbsence.body.id);
  const mixedHalfOk =
    mixedHalfStored.startPeriod === 'MATIN' &&
    mixedHalfStored.endPeriod === 'MATIN' &&
    Number(mixedHalfStored.durationDays) === 0.5 &&
    mixedHalfStored.durationHours === null;
  record(
    'Absence demi-journée : périodes conservées, durationHours nul',
    mixedHalfOk ? 'PASS' : 'FAIL',
    mixedHalfOk ? 'Mode demi-journée appliqué.' : `Stockage obtenu : ${JSON.stringify(mixedHalfStored)}.`,
  );
  invariant(mixedHalfOk, 'Le mode demi-journée doit conserver les périodes.');
  await expectStatus('La RH annule l’absence demi-journée', 200, `/absence-declarations/${mixedHalfAbsence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });

  const mixedHoursDraft = await expectStatus('Brouillon en heures créé', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDateHrD, endDate: mixedDateHrD, durationHours: 4, comment: 'Brouillon heures (PATCH).',
    },
  });
  await expectStatus('PATCH brouillon heures + startPeriod refusé', 400, `/absence-declarations/${mixedHoursDraft.body.id}`, {
    token: tokens.rh, method: 'PATCH', body: { startPeriod: 'MATIN', durationHours: 3 },
  });
  const mixedHalfDraft = await expectStatus('Brouillon demi-journée créé', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.a.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: mixedDateHdD, endDate: mixedDateHdD, startPeriod: 'MATIN', endPeriod: 'MATIN',
      comment: 'Brouillon demi-journée (PATCH).',
    },
  });
  await expectStatus('PATCH brouillon demi-journée + durationHours refusé', 400, `/absence-declarations/${mixedHalfDraft.body.id}`, {
    token: tokens.rh, method: 'PATCH', body: { startPeriod: 'MATIN', durationHours: 3 },
  });

  await expectStatus('PATCH heures → demi-journée : périodes seules ne basculent pas le mode', 200, `/absence-declarations/${mixedHoursDraft.body.id}`, {
    token: tokens.rh, method: 'PATCH', body: { startPeriod: 'MATIN', endPeriod: 'MATIN' },
  });
  const mixedHoursAfterPatch = await readAbsence(mixedHoursDraft.body.id);
  const stillHoursOk =
    Number(mixedHoursAfterPatch.durationHours) === 4 &&
    mixedHoursAfterPatch.startPeriod === null &&
    mixedHoursAfterPatch.endPeriod === null;
  record(
    'HEURES → DEMI-JOURNÉE : resté en heures (contrat partiel, pas de remise à zéro inventée)',
    stillHoursOk ? 'PASS' : 'FAIL',
    stillHoursOk ? 'durationHours=4 conservé, périodes nulles.' : `Stockage obtenu : ${JSON.stringify(mixedHoursAfterPatch)}.`,
  );
  invariant(stillHoursOk, 'Le mode heures ne doit pas basculer sans retrait de durationHours.');

  await expectStatus('PATCH demi-journée → heures : durationHours appliqué', 200, `/absence-declarations/${mixedHalfDraft.body.id}`, {
    token: tokens.rh, method: 'PATCH', body: { durationHours: 3 },
  });
  const mixedHalfAfterPatch = await readAbsence(mixedHalfDraft.body.id);
  const switchedToHoursOk =
    Number(mixedHalfAfterPatch.durationHours) === 3 &&
    mixedHalfAfterPatch.startPeriod === null &&
    mixedHalfAfterPatch.endPeriod === null;
  record(
    'DEMI-JOURNÉE → HEURES : bascule effective en mode heures',
    switchedToHoursOk ? 'PASS' : 'FAIL',
    switchedToHoursOk ? 'durationHours=3, périodes nulles.' : `Stockage obtenu : ${JSON.stringify(mixedHalfAfterPatch)}.`,
  );
  invariant(switchedToHoursOk, 'Le PATCH durationHours doit basculer en mode heures.');

  await expectStatus('Soumission du brouillon en heures', 200, `/absence-declarations/${mixedHoursDraft.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });
  await expectStatus('Annulation de l’absence en heures (nettoyage)', 200, `/absence-declarations/${mixedHoursDraft.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });
  await expectStatus('Soumission du brouillon basculé en heures', 200, `/absence-declarations/${mixedHalfDraft.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });
  await expectStatus('Annulation de l’absence basculée (nettoyage)', 200, `/absence-declarations/${mixedHalfDraft.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });

  const halfD1 = await nextOpenDate(addDays(scenarioDate, 44));
  const halfD2 = await nextOpenDate(addDays(scenarioDate, 47));
  const halfD3 = await nextOpenDate(addDays(scenarioDate, 50));

  await forceSlot(tokens, 'RH force le slot MATIN (23:59)', '23:59');
  const halfS2Absence = await expectStatus('RH crée une absence APRES_MIDI pour le Responsable', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.manager.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: martiniqueToday(), endDate: martiniqueToday(), startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI',
      comment: 'Absence APRES_MIDI du Responsable (Option D).',
    },
  });
  await expectStatus('La RH soumet l’absence APRES_MIDI du Responsable', 200, `/absence-declarations/${halfS2Absence.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });

  const halfS2Morning = await createRequest(tokens.collabA, unpaidType.id, halfD1, 'Responsable présent le matin');
  await submitRequest(tokens.collabA, halfS2Morning.id);
  await expectStatus('Responsable absent APRES_MIDI seulement : priorité Responsable le matin', 403, `/leave-requests/${halfS2Morning.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true },
  });
  await expectStatus('Le Responsable valide le matin', 200, `/leave-requests/${halfS2Morning.id}/validate`, {
    token: tokens.manager, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Continuité assurée.' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await forceSlot(tokens, 'RH force le slot APRES_MIDI (00:00)', '00:00');
  const halfS2Afternoon = await createRequest(tokens.collabA, unpaidType.id, halfD2, 'Responsable absent l’après-midi');
  await submitRequest(tokens.collabA, halfS2Afternoon.id);
  await expectStatus('Responsable absent APRES_MIDI seulement : relais autorisé l’après-midi', 200, `/leave-requests/${halfS2Afternoon.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Relais du Responsable (absent l’après-midi).' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await expectStatus('La RH annule l’absence APRES_MIDI du Responsable', 200, `/absence-declarations/${halfS2Absence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });
  await forceSlot(tokens, 'RH force le slot MATIN (23:59)', '23:59');
  const halfS3Absence = await expectStatus('RH crée une absence journée entière pour le Responsable', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.manager.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: martiniqueToday(), endDate: martiniqueToday(),
      durationHours: 7, comment: 'Absence journée entière du Responsable (Option D).',
    },
  });
  await expectStatus('La RH soumet l’absence journée entière du Responsable', 200, `/absence-declarations/${halfS3Absence.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });

  const halfS3Morning = await createRequest(tokens.collabA, unpaidType.id, halfD3, 'Relais journée entière — matin');
  await submitRequest(tokens.collabA, halfS3Morning.id);
  await expectStatus('Absence journée entière : relais autorisé le matin', 200, `/leave-requests/${halfS3Morning.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Relais journée entière (matin).' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await forceSlot(tokens, 'RH force le slot APRES_MIDI (00:00)', '00:00');
  const halfS3Afternoon = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(scenarioDate, 53)), 'Relais journée entière — après-midi');
  await submitRequest(tokens.collabA, halfS3Afternoon.id);
  await expectStatus('Absence journée entière : relais autorisé l’après-midi', 200, `/leave-requests/${halfS3Afternoon.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Relais journée entière (après-midi).' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await expectStatus('La RH annule l’absence journée entière du Responsable', 200, `/absence-declarations/${halfS3Absence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });
  const halfS7Request = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(scenarioDate, 56)), 'Retour à la priorité Responsable');
  await submitRequest(tokens.collabA, halfS7Request.id);
  await expectStatus('Retour à PRESENT du Responsable : priorité restaurée l’après-midi', 403, `/leave-requests/${halfS7Request.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true },
  });
  await expectStatus('Le Responsable valide après son retour', 200, `/leave-requests/${halfS7Request.id}/validate`, {
    token: tokens.manager, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Continuité assurée.' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await forceSlot(tokens, 'RH force le slot MATIN (23:59)', '23:59');
  const halfS5Absence = await expectStatus('RH crée une absence MATIN pour le Responsable', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.manager.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: martiniqueToday(), endDate: martiniqueToday(), startPeriod: 'MATIN', endPeriod: 'MATIN',
      comment: 'Absence MATIN du Responsable (Option D).',
    },
  });
  await expectStatus('La RH soumet l’absence MATIN du Responsable', 200, `/absence-declarations/${halfS5Absence.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });

  const halfS5Request = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(scenarioDate, 59)), 'Notification au slot MATIN');
  await submitRequest(tokens.collabA, halfS5Request.id);

  const managerMorningNotifications = await expectStatus('Le Responsable consulte ses notifications (slot MATIN)', 200, '/notifications/my?type=LEAVE_REQUEST_SUBMITTED', {
    token: tokens.manager,
  });
  const managerNotifiedMorning = managerMorningNotifications.body.some(
    (notification) => notification.leaveRequestId === halfS5Request.id,
  );
  record(
    'Slot MATIN : le Responsable absent n’est PAS destinataire de la notification',
    !managerNotifiedMorning ? 'PASS' : 'FAIL',
    managerNotifiedMorning ? 'Notification présente malgré l’absence.' : 'Aucune notification pour le Responsable.',
  );
  invariant(!managerNotifiedMorning, 'Le Responsable absent le matin ne doit pas être destinataire.');

  const rhMorningNotifications = await expectStatus('La RH consulte ses notifications (slot MATIN)', 200, '/notifications/my?type=LEAVE_REQUEST_SUBMITTED', {
    token: tokens.rh,
  });
  const rhNotifiedMorning = rhMorningNotifications.body.some(
    (notification) => notification.leaveRequestId === halfS5Request.id,
  );
  record(
    'Slot MATIN : la RH est destinataire de la notification (relais)',
    rhNotifiedMorning ? 'PASS' : 'FAIL',
    rhNotifiedMorning ? 'Notification RH présente.' : 'Aucune notification RH.',
  );
  invariant(rhNotifiedMorning, 'La RH devrait être destinataire le matin.');

  await forceSlot(tokens, 'RH force le slot APRES_MIDI (00:00)', '00:00');
  await expectStatus('Maintenance : réévalue les destinataires sur le slot courant', 200, '/leave-requests/maintenance/run', {
    token: tokens.rh, method: 'POST',
  }, (body) => {
    invariant(body.notificationsReevaluated >= 1, `notificationsReevaluated obtenu ${body.notificationsReevaluated}.`);
    return true;
  });
  const managerAfternoonNotifications = await expectStatus('Le Responsable consulte ses notifications (slot APRES_MIDI)', 200, '/notifications/my?type=LEAVE_REQUEST_SUBMITTED', {
    token: tokens.manager,
  });
  const managerNotifiedAfternoon = managerAfternoonNotifications.body.some(
    (notification) => notification.leaveRequestId === halfS5Request.id,
  );
  record(
    'Changement de slot : le Responsable reçoit la notification manquante (réévaluation)',
    managerNotifiedAfternoon ? 'PASS' : 'FAIL',
    managerNotifiedAfternoon ? 'Notification créée par la maintenance.' : 'Aucune réévaluation visible.',
  );
  invariant(managerNotifiedAfternoon, 'La réévaluation de maintenance devrait notifier le Responsable.');
  const rhAfternoonNotifications = await expectStatus('La RH consulte ses notifications (slot APRES_MIDI)', 200, '/notifications/my?type=LEAVE_REQUEST_SUBMITTED', {
    token: tokens.rh,
  });
  const rhCountAfternoon = rhAfternoonNotifications.body.filter(
    (notification) => notification.leaveRequestId === halfS5Request.id,
  ).length;
  record(
    'La réévaluation est idempotente : la RH ne reçoit pas de doublon',
    rhCountAfternoon === 1 ? 'PASS' : 'FAIL',
    `Notifications RH pour la demande : ${rhCountAfternoon}.`,
  );
  invariant(rhCountAfternoon === 1, 'Doublon de notification détecté.');

  await expectStatus('La RH annule l’absence MATIN du Responsable', 200, `/absence-declarations/${halfS5Absence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });
  await expectStatus('Le collaborateur annule sa demande de notification', 200, `/leave-requests/${halfS5Request.id}/cancel`, {
    token: tokens.collabA, method: 'POST', body: { reason: 'Fin du scénario notifications.' },
  });
  await restoreAfternoonStartHour();

  const halfS4Request = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(scenarioDate, 62)), 'Délai de relais expiré');
  await submitRequest(tokens.collabA, halfS4Request.id);
  await db.execute(
    `UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id = ?`,
    [halfS4Request.id],
  );
  await forceSlot(tokens, 'RH force le slot MATIN (23:59)', '23:59');
  await expectStatus('Délai de relais expiré : relais autorisé le matin', 200, `/leave-requests/${halfS4Request.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Délai de relais expiré (matin).' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await forceSlot(tokens, 'RH force le slot APRES_MIDI (00:00)', '00:00');
  const halfS4Request2 = await createRequest(tokens.collabA, unpaidType.id, await nextOpenDate(addDays(scenarioDate, 65)), 'Délai de relais expiré (après-midi)');
  await submitRequest(tokens.collabA, halfS4Request2.id);
  await db.execute(
    `UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id = ?`,
    [halfS4Request2.id],
  );
  await expectStatus('Délai de relais expiré : relais autorisé l’après-midi', 200, `/leave-requests/${halfS4Request2.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'RH', rhConfirmedDirectorAgreement: true, minimumPresenceJustification: 'Délai de relais expiré (après-midi).' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await restoreAfternoonStartHour();

  const halfPresenceDate = await nextOpenDate(addDays(scenarioDate, 68));
  const halfS9Absence = await expectStatus('RH crée une absence MATIN pour un collègue', 201, '/absence-declarations', {
    token: tokens.rh, method: 'POST',
    body: {
      employeeId: fixtures.collaborators.b.id, leaveTypeId: rhOnlyAbsenceType.id,
      startDate: halfPresenceDate, endDate: halfPresenceDate, startPeriod: 'MATIN', endPeriod: 'MATIN',
      comment: 'Absence MATIN d’un collègue (présence minimale par slot).',
    },
  });
  await expectStatus('La RH soumet l’absence MATIN du collègue', 200, `/absence-declarations/${halfS9Absence.body.id}/submit`, {
    token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
  });
  const halfS9Request = await createRequest(tokens.collabA, paidType.id, halfPresenceDate, 'Présence minimale par slot');
  await submitRequest(tokens.collabA, halfS9Request.id);
  const halfS9Alerts = await expectStatus('Responsable consulte les alertes par slot', 200, `/leave-requests/management/${halfS9Request.id}/alerts`, {
    token: tokens.manager,
  }, (body) => {
    invariant(Array.isArray(body.slots) && body.slots.length >= 2, 'Analyse par slots absente.');
    const matinSlot = body.slots.find((slot) => slot.period === 'MATIN');
    const apresMidiSlot = body.slots.find((slot) => slot.period === 'APRES_MIDI');
    invariant(matinSlot?.absentEmployeeIds?.includes(fixtures.collaborators.b.id) === true, 'Le collègue absent MATIN manque dans le slot MATIN.');
    invariant(apresMidiSlot?.absentEmployeeIds?.includes(fixtures.collaborators.b.id) === false, 'Le collègue absent MATIN apparaît dans le slot APRES_MIDI.');
    return true;
  });
  const matinSlot = halfS9Alerts.body.slots.find((slot) => slot.period === 'MATIN');
  const apresMidiSlot = halfS9Alerts.body.slots.find((slot) => slot.period === 'APRES_MIDI');
  const s9Ok = matinSlot?.absentEmployeeIds?.includes(fixtures.collaborators.b.id)
    && !apresMidiSlot?.absentEmployeeIds?.includes(fixtures.collaborators.b.id);
  record(
    'Présence minimale : une absence MATIN ne pénalise que le slot MATIN',
    s9Ok ? 'PASS' : 'FAIL',
    halfS9Alerts.body.slots.map((slot) => `${slot.period}: ${slot.absentEmployeeIds.join(',') || 'aucun'}`).join(' / '),
  );
  await expectStatus('Le Responsable valide la demande de présence minimale', 200, `/leave-requests/${halfS9Request.id}/validate`, {
    token: tokens.manager, method: 'POST',
    body: { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Renfort planifié sur le créneau du matin.' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('La RH annule l’absence MATIN du collègue', 200, `/absence-declarations/${halfS9Absence.body.id}/cancel`, {
    token: tokens.rh, method: 'POST',
  });
  await restoreAfternoonStartHour();

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

  section('AUD-1 — Traçabilité métier des audits (resource_type/resource_id)');
  const businessAuditActions = [
    'BROUILLON_CREE', 'BROUILLON_MODIFIE', 'DEMANDE_MODIFIEE_AVANT_DECISION',
    'DEMANDE_SOUMISE', 'DEMANDE_VALIDEE', 'DEMANDE_REFUSEE', 'DEMANDE_ANNULEE',
    'CONGE_DIRECTEUR_ENREGISTRE', 'REPRISE_PAR_RELAIS', 'INTERVENTION_URGENCE',
    'ANNULATION_APRES_VALIDATION_DEMANDEE', 'ANNULATION_ACCEPTEE_PAR_COLLABORATEUR',
    'ANNULATION_REFUSEE_PAR_COLLABORATEUR', 'ANNULATION_APRES_VALIDATION_TERMINEE',
    'DEMANDE_EXPIREE_NON_VALIDEE',
  ];
  const businessPlaceholders = businessAuditActions.map(() => '?').join(',');

  const [misMappedRows] = await db.execute(
    `SELECT COUNT(*) AS misMapped
     FROM audit_logs
     WHERE action IN (${businessPlaceholders})
       AND (resource_type <> 'LEAVE_REQUESTS' OR resource_id IS NULL)`,
    businessAuditActions,
  );
  const noMisMapped = Number(misMappedRows[0]?.misMapped) === 0;
  record(
    'Tous les audits métier portent LEAVE_REQUESTS avec un resource_id non nul',
    noMisMapped ? 'PASS' : 'FAIL',
    noMisMapped
      ? 'Aucun audit sur APPLICATION/null.'
      : `${misMappedRows[0]?.misMapped} audit(s) mal mappé(s) (APPLICATION/LEAVE_REQUEST/null).`,
  );
  invariant(noMisMapped, 'La correction AUD-1 n’est pas appliquée.');

  const persistedActions = [
    'DEMANDE_SOUMISE', 'DEMANDE_VALIDEE', 'DEMANDE_REFUSEE', 'DEMANDE_ANNULEE',
    'CONGE_DIRECTEUR_ENREGISTRE', 'REPRISE_PAR_RELAIS', 'INTERVENTION_URGENCE',
    'ANNULATION_APRES_VALIDATION_DEMANDEE', 'ANNULATION_ACCEPTEE_PAR_COLLABORATEUR',
    'ANNULATION_REFUSEE_PAR_COLLABORATEUR', 'ANNULATION_APRES_VALIDATION_TERMINEE',
    'DEMANDE_EXPIREE_NON_VALIDEE',
  ];
  const persistedPlaceholders = persistedActions.map(() => '?').join(',');
  const [orphanRows] = await db.execute(
    `SELECT COUNT(*) AS orphanCount
     FROM audit_logs a
     LEFT JOIN leave_requests l ON a.resource_id = l.id
     WHERE a.action IN (${persistedPlaceholders})
       AND (a.resource_type <> 'LEAVE_REQUESTS' OR a.resource_id IS NULL OR l.id IS NULL)`,
    persistedActions,
  );
  const noOrphan = Number(orphanRows[0]?.orphanCount) === 0;
  record(
    'Chaque audit post-brouillon pointe vers une demande existante en base',
    noOrphan ? 'PASS' : 'FAIL',
    noOrphan ? 'Aucun audit orphelin.' : `${orphanRows[0]?.orphanCount} audit(s) orphelin(s).`,
  );
  invariant(noOrphan, 'Des audits métier pointent vers une ressource inexistante.');

  const [draftAuditRows] = await db.execute(
    `SELECT resource_id AS resourceId, actor_id AS actorId
     FROM audit_logs
     WHERE action = 'BROUILLON_CREE'
     ORDER BY id DESC LIMIT 1`,
  );
  const draftAuditOk =
    draftAuditRows.length === 1 &&
    Number(draftAuditRows[0].resourceId) > 0 &&
    Number(draftAuditRows[0].actorId) > 0;
  record(
    'A — BROUILLON_CREE porte un resource_id et un actor_id réels',
    draftAuditOk ? 'PASS' : 'FAIL',
    draftAuditOk
      ? `resource_id = ${draftAuditRows[0].resourceId}, actor_id = ${draftAuditRows[0].actorId}.`
      : `Valeurs obtenues : ${JSON.stringify(draftAuditRows[0])}.`,
  );
  invariant(draftAuditOk, 'Audit BROUILLON_CREE sans ressource réelle.');

  const [chainRows] = await db.execute(
    `SELECT resource_id AS resourceId, COUNT(DISTINCT action) AS nbActions
     FROM audit_logs
     WHERE action IN ('BROUILLON_CREE', 'DEMANDE_SOUMISE', 'DEMANDE_VALIDEE', 'REPRISE_PAR_RELAIS')
     GROUP BY resource_id
     HAVING nbActions = 4
     ORDER BY resource_id DESC LIMIT 1`,
  );
  const chainOk = chainRows.length === 1 && Number(chainRows[0].resourceId) > 0;
  record(
    'B/C/D/F — la même demande trace CREE, SOUMISE, VALIDEE et RELAIS sur un resource_id partagé',
    chainOk ? 'PASS' : 'FAIL',
    chainOk
      ? `resource_id partagé : ${chainRows[0].resourceId}.`
      : 'Aucune chaîne d’audit complète trouvée.',
  );
  invariant(chainOk, 'La chaîne d’audit partagée est introuvable.');

  if (chainOk) {
    const [validatedByRows] = await db.execute(
      `SELECT actor_id AS actorId FROM audit_logs
       WHERE action = 'DEMANDE_VALIDEE' AND resource_id = ?`,
      [Number(chainRows[0].resourceId)],
    );
    const validateActorOk =
      validatedByRows.length === 1 &&
      Number(validatedByRows[0].actorId) === rhUserId;
    record(
      'C — DEMANDE_VALIDEE est attribuée au valideur réel (RH du relais E3)',
      validateActorOk ? 'PASS' : 'FAIL',
      validateActorOk
        ? `actor_id = ${validatedByRows[0].actorId}.`
        : `actor_id obtenu : ${validatedByRows[0]?.actorId}.`,
    );
    invariant(validateActorOk, 'Le valideur tracé n’est pas l’auteur réel.');
  }

  const [directeurAuditRows] = await db.execute(
    `SELECT resource_type AS resourceType, resource_id AS resourceId, actor_id AS actorId
     FROM audit_logs
     WHERE action = 'CONGE_DIRECTEUR_ENREGISTRE'
     ORDER BY id DESC LIMIT 1`,
  );
  const directeurAuditOk =
    directeurAuditRows.length === 1 &&
    directeurAuditRows[0].resourceType === 'LEAVE_REQUESTS' &&
    Number(directeurAuditRows[0].resourceId) > 0 &&
    Number(directeurAuditRows[0].actorId) === directeurUserId;
  record(
    'E — CONGE_DIRECTEUR_ENREGISTRE trace la demande du Directeur (LEAVE_REQUESTS, actor Directeur)',
    directeurAuditOk ? 'PASS' : 'FAIL',
    directeurAuditOk
      ? `resource_id = ${directeurAuditRows[0].resourceId}, actor_id = ${directeurAuditRows[0].actorId}.`
      : `Valeurs obtenues : ${JSON.stringify(directeurAuditRows[0])}.`,
  );
  invariant(directeurAuditOk, 'Audit Directeur non conforme.');

  let absenceAuditRows = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    [absenceAuditRows] = await db.execute(
      `SELECT action, resource_id AS resourceId
       FROM audit_logs
       WHERE resource_type = 'ABSENCE_DECLARATIONS' AND resource_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    );
    if (absenceAuditRows.length === 1) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const [absenceTargetRows] =
    absenceAuditRows.length === 1
      ? await db.execute(
          `SELECT id FROM absence_declarations WHERE id = ?`,
          [Number(absenceAuditRows[0].resourceId)],
        )
      : [[]];
  const absenceAuditOk =
    absenceAuditRows.length === 1 && absenceTargetRows.length === 1;
  record(
    'G — un audit d’absence porte ABSENCE_DECLARATIONS avec un resource_id réel',
    absenceAuditOk ? 'PASS' : 'FAIL',
    absenceAuditOk
      ? `action ${absenceAuditRows[0].action}, resource_id = ${absenceAuditRows[0].resourceId}.`
      : 'Aucun audit ABSENCE_DECLARATIONS avec resource_id réel.',
  );
  invariant(absenceAuditOk, 'L’audit d’absence ne référence pas sa ressource.');

  const [derogationAuditRows] = await db.execute(
    `SELECT resource_type AS resourceType, resource_id AS resourceId
     FROM audit_logs
     WHERE action LIKE 'DEROGATION_%'
     ORDER BY id DESC LIMIT 1`,
  );
  const derogationAuditOk =
    derogationAuditRows.length === 1 &&
    derogationAuditRows[0].resourceType === 'DEROGATIONS' &&
    Number(derogationAuditRows[0].resourceId) > 0;
  record(
    'Les audits de dérogation portent DEROGATIONS avec un resource_id réel',
    derogationAuditOk ? 'PASS' : 'FAIL',
    derogationAuditOk
      ? `resource_id = ${derogationAuditRows[0].resourceId}.`
      : 'Aucun audit DEROGATIONS conforme.',
  );
  invariant(derogationAuditOk, 'Audit de dérogation sans ressource réelle.');

  section('E4 — Rappels de fin de période (soldes N-1)');
  {
    const D = martiniqueToday();
    const mmddOf = (isoDate) => isoDate.slice(5);
    const periodFor = (dateStr, startMmDd) => {
      const y = Number(dateStr.slice(0, 4));
      const startOfYear = `${y}-${startMmDd}`;
      return dateStr >= startOfYear ? `${y}-${y + 1}` : `${y - 1}-${y}`;
    };
    const e4FrenchMonths = [
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ];
    const frenchDate = (isoDate) => {
      const [y, m, d] = isoDate.split('-').map(Number);
      return `${d} ${e4FrenchMonths[m - 1]} ${y}`;
    };
    const originalReferencePeriodStart = '06-01';

    const e4Tag = Date.now().toString(36);
    const [e4ServiceResult] = await db.execute(
      `INSERT INTO services
        (name, service_type, validation_mode, takeover_delay_days, minimum_presence, has_minimum_presence_rule, is_active)
       VALUES (?, 'INTERNE', 'RESPONSABLE_PUIS_RELAIS', 7, 3, 1, 1)`,
      [`ZZ E4 Rappels ${e4Tag}`],
    );
    const e4ServiceId = Number(e4ServiceResult.insertId);
    const [e4HashRows] = await db.query(
      `SELECT password_hash AS passwordHash FROM users WHERE email = 'responsable@gmes.fr'`,
    );
    const e4PasswordHash = e4HashRows[0].passwordHash;

    const insertE4User = async ({ nom, prenom, email, role, employmentType = 'INTERNE' }) => {
      const [result] = await db.execute(
        `INSERT INTO users
          (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2024-01-01', 'PRESENT', 1)`,
        [nom, prenom, email, e4PasswordHash, role, employmentType, e4ServiceId],
      );
      return Number(result.insertId);
    };

    const e4Users = {
      collabA: await insertE4User({ nom: 'E4-COLLAB-A', prenom: 'Alice', email: `e4-collab-a-${e4Tag}@gmes.test`, role: 'COLLABORATEUR' }),
      extA: await insertE4User({ nom: 'E4-EXT-A', prenom: 'Éric', email: `e4-ext-a-${e4Tag}@gmes.test`, role: 'COLLABORATEUR', employmentType: 'EXTERNE' }),
      respA: await insertE4User({ nom: 'E4-RESP-A', prenom: 'Rachel', email: `e4-resp-a-${e4Tag}@gmes.test`, role: 'RESPONSABLE_SERVICE' }),
      dirA: await insertE4User({ nom: 'E4-DIR-A', prenom: 'David', email: `e4-dir-a-${e4Tag}@gmes.test`, role: 'DIRECTEUR' }),
      rhA: await insertE4User({ nom: 'E4-RH-A', prenom: 'Rita', email: `e4-rh-a-${e4Tag}@gmes.test`, role: 'RH' }),
      rhB: await insertE4User({ nom: 'E4-RH-B', prenom: 'Romain', email: `e4-rh-b-${e4Tag}@gmes.test`, role: 'RH' }),
      collabZero: await insertE4User({ nom: 'E4-ZERO', prenom: 'Zoé', email: `e4-zero-${e4Tag}@gmes.test`, role: 'COLLABORATEUR' }),
      adminE4: await insertE4User({ nom: 'E4-ADMIN', prenom: 'André', email: `e4-admin-${e4Tag}@gmes.test`, role: 'ADMIN' }),
    };

    const initializeE4Balance = async (employeeId, period, days) => {
      await expectStatus(
        `Initialisation N-1 ${period} — ${days} j (employé ${employeeId})`,
        201,
        '/leave-balances/initialize',
        {
          token: tokens.rh,
          method: 'POST',
          body: {
            employeeId,
            referencePeriod: period,
            counterType: 'N-1',
            acquiredDays: days,
            reason: 'Initialisation automatisée du scénario E4.',
          },
        },
      );
    };

    const countNotifications = async (type, userId = null) => {
      if (userId === null) {
        const [rows] = await db.query(
          `SELECT COUNT(*) AS total FROM notifications WHERE type = ?`,
          [type],
        );
        return Number(rows[0].total);
      }
      const [rows] = await db.query(
        `SELECT COUNT(*) AS total FROM notifications WHERE type = ? AND user_id = ?`,
        [type, userId],
      );
      return Number(rows[0].total);
    };

    const [rhRows] = await db.query(
      `SELECT id FROM users WHERE role = 'RH' AND is_active = 1`,
    );
    const expectedRecapCount = rhRows.length;
    invariant(
      expectedRecapCount >= 1,
      'Aucune RH active pour le récapitulatif E4.',
    );

    const startA = addDays(D, 8);
    const endA = addDays(D, 7);
    const periodA = periodFor(D, mmddOf(startA));
    const reminderType7D = `BALANCE_REMINDER_7D_${periodA}`;
    const recapType7D = `BALANCE_RECAP_7D_${periodA}`;

    try {
      await expectStatus(
        'RH force REFERENCE_PERIOD_START (échéance 7 jours aujourd’hui)',
        200,
        '/settings/REFERENCE_PERIOD_START',
        {
          token: tokens.rh,
          method: 'PATCH',
          body: {
            settingValue: mmddOf(startA),
            description: 'E4 : échéance 7 jours = aujourd’hui.',
          },
        },
      );

      await initializeE4Balance(e4Users.collabA, periodA, 8);
      await initializeE4Balance(e4Users.extA, periodA, 6);
      await initializeE4Balance(e4Users.respA, periodA, 4);
      await initializeE4Balance(e4Users.dirA, periodA, 3);
      await initializeE4Balance(e4Users.rhA, periodA, 2);
      await initializeE4Balance(e4Users.collabZero, periodA, 2);
      await db.execute(
        `UPDATE leave_balances
            SET reserved_days = 2
          WHERE employee_id = ? AND reference_period = ? AND counter_type = 'N-1'`,
        [e4Users.collabZero, periodA],
      );

      const run1 = await expectStatus(
        'Maintenance E4 — échéance 7 jours (phase 1)',
        200,
        '/leave-requests/maintenance/run',
        { token: tokens.rh, method: 'POST' },
        (body) => {
          invariant(
            body.balanceReminders?.referencePeriod === periodA,
            `Période E4 ${body.balanceReminders?.referencePeriod}, attendue ${periodA}.`,
          );
          invariant(
            body.balanceReminders?.deadline?.key === '7D',
            `Échéance ${body.balanceReminders?.deadline?.key}, attendue 7D.`,
          );
          return true;
        },
      );
      record(
        'La maintenance expose le résultat E4 (période + échéance)',
        'PASS',
        `referencePeriod=${run1.body.balanceReminders.referencePeriod}, deadline=${run1.body.balanceReminders.deadline.key}.`,
      );

      const positiveBalanceUserIds = [
        e4Users.collabA, e4Users.extA, e4Users.respA, e4Users.dirA, e4Users.rhA,
      ];
      for (const userId of positiveBalanceUserIds) {
        const total = await countNotifications(reminderType7D, userId);
        invariant(total === 1, `Employé ${userId} : ${total} rappel(s) 7D attendu(s) 1.`);
      }
      record('Rappel individuel créé pour chaque compteur N-1 positif', 'PASS', 'Collaborateur, externe, Responsable, Directeur et RH.');

      const [collabA7DRows] = await db.query(
        `SELECT channel, email_sent_at AS emailSentAt, title, message
           FROM notifications WHERE type = ? AND user_id = ?`,
        [reminderType7D, e4Users.collabA],
      );
      invariant(collabA7DRows[0]?.channel === 'LES_DEUX', 'Canal attendu LES_DEUX.');
      invariant(collabA7DRows[0]?.emailSentAt === null, 'emailSentAt doit rester NULL en E4.');
      invariant(collabA7DRows[0].message.includes('8 jours de congés à utiliser'), 'Message E4 collabA inattendu.');
      invariant(
        collabA7DRows[0].message.includes(`à utiliser avant le ${frenchDate(endA)}`),
        `Le message doit indiquer la fin de période ${frenchDate(endA)}.`,
      );
      invariant(
        !collabA7DRows[0].message.includes(`avant le ${frenchDate(D)}`),
        'Le message ne doit pas afficher la date de déclenchement du palier (aujourd’hui).',
      );
      invariant(
        collabA7DRows[0].title === `Congés à utiliser avant le ${frenchDate(endA)}`,
        `Titre attendu « Congés à utiliser avant le ${frenchDate(endA)} ».`,
      );
      record('Rappel : titre et message affichent la fin de période (D+7), jamais la date du palier', 'PASS', collabA7DRows[0].message);

      const oldPalierTotal = await countNotifications(`BALANCE_REMINDER_15D_${periodA}`);
      invariant(oldPalierTotal === 0, 'Un palier plus ancien a été envoyé.');
      record('Plusieurs paliers dus : seul le plus récent est envoyé', 'PASS', 'Aucun BALANCE_REMINDER_15D créé.');

      const zeroTotal = await countNotifications(reminderType7D, e4Users.collabZero);
      invariant(zeroTotal === 0, 'collabZero (potentiel 0) ne doit pas être rappelé.');
      record('Potentiel = 0 : pas de rappel individuel', 'PASS', 'collabZero exclu.');

      const adminE4Total = await countNotifications(reminderType7D, e4Users.adminE4);
      invariant(adminE4Total === 0, 'Un Admin dédié a reçu un rappel E4.');
      const [adminGlobalRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE n.type LIKE 'BALANCE_REMINDER_%' AND u.role = 'ADMIN'`,
      );
      invariant(Number(adminGlobalRows[0].total) === 0, 'Un Admin a reçu un rappel E4.');
      record('Aucune notification E4 pour un Admin', 'PASS', 'Admin exclu du rappel et du récap.');

      const recapTotal = await countNotifications(recapType7D);
      invariant(recapTotal === expectedRecapCount, `Récaps ${recapTotal}, attendus ${expectedRecapCount}.`);
      const rhARecapTotal = await countNotifications(recapType7D, e4Users.rhA);
      const rhBRecapTotal = await countNotifications(recapType7D, e4Users.rhB);
      invariant(rhARecapTotal === 1, 'rhA doit recevoir le récapitulatif.');
      invariant(rhBRecapTotal === 1, 'rhB doit recevoir le récapitulatif.');
      record('Récapitulatif RH : une notification par RH active', 'PASS', `${recapTotal} RH (dont les deux RH dédiées).`);
      const [recapForbiddenRows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE n.type LIKE 'BALANCE_RECAP_%' AND u.role IN ('DIRECTEUR', 'ADMIN')`,
      );
      invariant(Number(recapForbiddenRows[0].total) === 0, 'Directeur ou Admin a reçu un récapitulatif.');
      record('Directeur et Admin ne reçoivent pas le récapitulatif RH', 'PASS', 'Confidentialité RH respectée.');
      const [rhARecapRows] = await db.query(
        `SELECT message FROM notifications WHERE user_id = ? AND type = ?`,
        [e4Users.rhA, recapType7D],
      );
      const recapMessage = rhARecapRows[0]?.message ?? '';
      for (const expected of ['E4-COLLAB-A', 'E4-EXT-A', 'E4-RESP-A', 'E4-DIR-A', 'E4-RH-A']) {
        invariant(recapMessage.includes(expected), `Le récapitulatif doit contenir ${expected}.`);
      }
      invariant(!recapMessage.includes('E4-ZERO'), 'collabZero (potentiel 0) ne doit pas figurer dans le récapitulatif.');
      invariant(!recapMessage.includes('E4-ADMIN'), 'Un Admin ne doit pas figurer dans le récapitulatif.');
      invariant(recapMessage.includes(periodA), 'Le récapitulatif doit porter la période.');
      invariant(recapMessage.includes('N-1'), 'Le récapitulatif doit mentionner le compteur N-1.');
      invariant(
        recapMessage.includes(`Rappel 7 jours — période ${periodA} (compteur N-1), congés à utiliser avant le ${frenchDate(endA)}`),
        `Le récapitulatif doit indiquer « Rappel 7 jours » et la limite ${frenchDate(endA)}.`,
      );
      invariant(
        !recapMessage.includes(`avant le ${frenchDate(D)}`),
        'Le récapitulatif ne doit pas afficher la date de déclenchement du palier.',
      );
      record('Récapitulatif RH : palier déclenché distinct de la date limite (fin de période)', 'PASS', `Rappel 7 jours → avant le ${frenchDate(endA)}.`);

      await expectStatus(
        'Maintenance E4 — second passage idempotent (phase 1 bis)',
        200,
        '/leave-requests/maintenance/run',
        { token: tokens.rh, method: 'POST' },
        (body) => {
          invariant(
            body.balanceReminders?.remindersCreated === 0,
            `Second passage a créé ${body.balanceReminders?.remindersCreated} rappel(s).`,
          );
          invariant(
            body.balanceReminders?.recapNotificationsCreated === 0,
            `Second passage a créé ${body.balanceReminders?.recapNotificationsCreated} récap(s).`,
          );
          return true;
        },
      );
      for (const userId of positiveBalanceUserIds) {
        const total = await countNotifications(reminderType7D, userId);
        invariant(total === 1, `Doublon de rappel 7D pour l'employé ${userId}.`);
      }
      const recapTotalAfterDup = await countNotifications(recapType7D);
      invariant(recapTotalAfterDup === expectedRecapCount, 'Doublon de récapitulatif.');
      record('Double maintenance : aucun doublon', 'PASS', 'Rappels et récap RH inchangés.');

      const startB = addDays(D, 15);
      const endB = addDays(D, 14);
      const periodB = periodFor(D, mmddOf(startB));
      await expectStatus(
        'RH force REFERENCE_PERIOD_START (échéance 15 jours hier = rattrapage)',
        200,
        '/settings/REFERENCE_PERIOD_START',
        {
          token: tokens.rh,
          method: 'PATCH',
          body: {
            settingValue: mmddOf(startB),
            description: 'E4 : échéance 15 jours hier (rattrapage).',
          },
        },
      );
      if (periodB !== periodA) {
        await initializeE4Balance(e4Users.collabA, periodB, 3);
        await initializeE4Balance(e4Users.extA, periodB, 6);
        await initializeE4Balance(e4Users.respA, periodB, 4);
        await initializeE4Balance(e4Users.dirA, periodB, 3);
        await initializeE4Balance(e4Users.rhA, periodB, 2);
      } else {
        await db.execute(
          `UPDATE leave_balances
              SET available_days = 3
            WHERE employee_id = ? AND reference_period = ? AND counter_type = 'N-1'`,
          [e4Users.collabA, periodB],
        );
      }

      await expectStatus(
        'Maintenance E4 — rattrapage de l’échéance 15 jours (phase 2)',
        200,
        '/leave-requests/maintenance/run',
        { token: tokens.rh, method: 'POST' },
        (body) => {
          invariant(
            body.balanceReminders?.referencePeriod === periodB,
            `Période E4 ${body.balanceReminders?.referencePeriod}, attendue ${periodB}.`,
          );
          invariant(
            body.balanceReminders?.deadline?.key === '15D',
            `Échéance ${body.balanceReminders?.deadline?.key}, attendue 15D (rattrapage).`,
          );
          return true;
        },
      );

      const reminderType15D = `BALANCE_REMINDER_15D_${periodB}`;
      const recapType15D = `BALANCE_RECAP_15D_${periodB}`;
      for (const userId of positiveBalanceUserIds) {
        const total = await countNotifications(reminderType15D, userId);
        invariant(total === 1, `Employé ${userId} : ${total} rappel(s) 15D attendu(s) 1.`);
      }
      record('Rattrapage : échéance due envoyée au passage suivant', 'PASS', 'Rappels 15D créés malgré une échéance hier.');
      const [collabA15DRows] = await db.query(
        `SELECT message FROM notifications WHERE type = ? AND user_id = ?`,
        [reminderType15D, e4Users.collabA],
      );
      const collabA15D = collabA15DRows[0]?.message ?? '';
      invariant(collabA15D.includes('3 jours'), 'Le rappel 15D doit relire le solde courant (3 j).');
      invariant(!collabA15D.includes('8 jours'), 'Le rappel 15D ne doit pas réutiliser l’ancien solde (8 j).');
      invariant(
        collabA15D.includes(`à utiliser avant le ${frenchDate(endB)}`),
        `Le rappel 15D doit indiquer la fin de période ${frenchDate(endB)}.`,
      );
      invariant(
        !collabA15D.includes(`avant le ${frenchDate(addDays(D, -1))}`),
        'Le rappel 15D ne doit pas afficher la date historique du palier (D−1).',
      );
      record('Solde modifié entre deux rappels : valeur actuelle relue, date limite = fin de période réelle', 'PASS', collabA15D);
      const [anciensPaliersRows] = await db.query(
        `SELECT COUNT(*) AS total FROM notifications WHERE type IN (?, ?, ?)`,
        [
          `BALANCE_REMINDER_3M_${periodB}`,
          `BALANCE_REMINDER_2M_${periodB}`,
          `BALANCE_REMINDER_1M_${periodB}`,
        ],
      );
      invariant(Number(anciensPaliersRows[0].total) === 0, 'Les paliers 3M/2M/1M ne doivent pas être envoyés en rattrapage.');
      record('Rattrapage : aucun ancien palier simultané', 'PASS', 'Seul 15D est envoyé.');
      const recap15DTotal = await countNotifications(recapType15D);
      invariant(recap15DTotal === expectedRecapCount, 'Récap 15D manquant.');
      const [rhA15DRecapRows] = await db.query(
        `SELECT message FROM notifications WHERE user_id = ? AND type = ?`,
        [e4Users.rhA, recapType15D],
      );
      const recap15DMessage = rhA15DRecapRows[0]?.message ?? '';
      invariant(!recap15DMessage.includes('E4-ZERO'), 'Le récap 15D ne doit pas contenir un potentiel nul.');
      invariant(
        recap15DMessage.includes(`congés à utiliser avant le ${frenchDate(endB)}`),
        `Le récap 15D doit indiquer la fin de période ${frenchDate(endB)}.`,
      );
      record('Récapitulatif RH après rattrapage : aucune ligne à potentiel nul, date limite = fin de période réelle', 'PASS', `Rappel 15 jours → avant le ${frenchDate(endB)}.`);
    } finally {
      await expectStatus(
        'RH restaure REFERENCE_PERIOD_START à 06-01',
        200,
        '/settings/REFERENCE_PERIOD_START',
        {
          token: tokens.rh,
          method: 'PATCH',
          body: {
            settingValue: originalReferencePeriodStart,
            description: 'E4 : restauration du paramètre de période.',
          },
        },
      );
      const [restoredSetting] = await db.query(
        `SELECT setting_value AS settingValue FROM settings WHERE setting_key = 'REFERENCE_PERIOD_START'`,
      );
      invariant(
        restoredSetting[0]?.settingValue === originalReferencePeriodStart,
        'REFERENCE_PERIOD_START n’a pas été restauré à 06-01.',
      );
    }
    record('REFERENCE_PERIOD_START restauré à 06-01 (fin E4)', 'PASS', 'La suite de clôture/acquisition n’est pas contaminée.');
  }

  section('REF-1 — acquisition mensuelle alignée sur REFERENCE_PERIOD_START');
  {
    const ref1Year = Number(martiniqueToday().slice(0, 4)) - 2;
    const ref1Month = `${ref1Year}-04`;
    const creditDate = `${ref1Year}-04-30`;
    const expectedPeriod = `${ref1Year}-${ref1Year + 1}`;
    const legacyPeriod = `${ref1Year - 1}-${ref1Year}`;

    const ref1Tag = Date.now().toString(36);
    const [ref1ServiceResult] = await db.execute(
      `INSERT INTO services
        (name, service_type, validation_mode, takeover_delay_days, minimum_presence, has_minimum_presence_rule, is_active)
       VALUES (?, 'INTERNE', 'RESPONSABLE_PUIS_RELAIS', 7, 3, 1, 1)`,
      [`ZZ REF-1 Acquisition ${ref1Tag}`],
    );
    const ref1ServiceId = Number(ref1ServiceResult.insertId);
    const [ref1HashRows] = await db.query(
      `SELECT password_hash AS passwordHash FROM users WHERE email = 'collaborateur@gmes.fr'`,
    );
    const ref1PasswordHash = ref1HashRows[0].passwordHash;
    const [ref1UserResult] = await db.execute(
      `INSERT INTO users
        (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
       VALUES (?, ?, ?, ?, 'COLLABORATEUR', 'INTERNE', ?, '2024-01-01', 'PRESENT', 1)`,
      ['REF1-ACQUISITION', 'Rachel', `ref1-${ref1Tag}@gmes.test`, ref1PasswordHash, ref1ServiceId],
    );
    const ref1UserId = Number(ref1UserResult.insertId);

    try {
      await expectStatus(
        'REF-1 — RH force REFERENCE_PERIOD_START à 04-15',
        200,
        '/settings/REFERENCE_PERIOD_START',
        {
          token: tokens.rh,
          method: 'PATCH',
          body: { settingValue: '04-15', description: 'REF-1 : acquisition d’avril en milieu de période.' },
        },
      );

      const ref1Run = await expectStatus(
        `REF-1 — acquisition contrôlée d’avril ${ref1Year}`,
        201,
        '/leave-balances/accrual/run',
        { token: tokens.rh, method: 'POST', body: { accrualMonth: ref1Month } },
        (body) => {
          invariant(
            body.accrualMonth === ref1Month,
            `accrualMonth ${body.accrualMonth}, attendu ${ref1Month}.`,
          );
          invariant(
            body.effectiveDate === creditDate,
            `effectiveDate ${body.effectiveDate}, attendue ${creditDate} (30/04, jamais la date d’exécution).`,
          );
          invariant(
            body.referencePeriod === expectedPeriod,
            `referencePeriod ${body.referencePeriod}, attendu ${expectedPeriod}.`,
          );
          invariant(
            body.creditedEmployees.some((row) => Number(row.employeeId) === ref1UserId),
            'Le collaborateur dédié REF-1 n’a pas été crédité.',
          );
          return true;
        },
      );
      record(
        'REF-1 — le run expose la période attendue (30/04)',
        'PASS',
        `avril ${ref1Year} → ${ref1Run.body.referencePeriod}, date effective ${ref1Run.body.effectiveDate}.`,
      );

      const [ref1Balances] = await db.query(
        `SELECT id, reference_period AS referencePeriod, counter_type AS counterType, acquired_days AS acquiredDays
           FROM leave_balances
          WHERE employee_id = ?`,
        [ref1UserId],
      );
      const ref1Balance = ref1Balances.find((row) => row.counterType === 'N');
      invariant(ref1Balance, 'Aucun compteur N créé pour le collaborateur REF-1.');
      invariant(
        ref1Balance.referencePeriod === expectedPeriod,
        `Compteur N rattaché à ${ref1Balance.referencePeriod}, attendu ${expectedPeriod}.`,
      );
      invariant(
        Number(ref1Balance.acquiredDays) === 2.5,
        `acquiredDays ${ref1Balance.acquiredDays}, attendu 2.5.`,
      );
      const [ref1Movements] = await db.query(
        `SELECT movement_type AS movementType, days, leave_balance_id AS leaveBalanceId
           FROM balance_movements
          WHERE employee_id = ?`,
        [ref1UserId],
      );
      invariant(ref1Movements.length === 1, `Mouvements ${ref1Movements.length}, attendu 1.`);
      invariant(
        ref1Movements[0].movementType === 'ACQUISITION',
        'Le mouvement créé doit être une acquisition mensuelle.',
      );
      invariant(
        Number(ref1Movements[0].leaveBalanceId) === Number(ref1Balance.id),
        'Le mouvement doit pointer vers le compteur de la période attendue.',
      );
      invariant(
        Number(ref1Movements[0].days) === 2.5,
        `Jours crédités ${ref1Movements[0].days}, attendu 2.5.`,
      );
      record(
        'REF-1 — compteur N et mouvement rattachés à la période attendue',
        'PASS',
        `${expectedPeriod}, +2,5 jours.`,
      );

      const [legacyBalances] = await db.query(
        `SELECT COUNT(*) AS total FROM leave_balances
          WHERE employee_id = ? AND reference_period = ?`,
        [ref1UserId, legacyPeriod],
      );
      invariant(
        Number(legacyBalances[0].total) === 0,
        `Un compteur existe sur l’ancienne période ${legacyPeriod} (règle mois >= 6).`,
      );
      record(
        'REF-1 — aucun rattachement à l’ancienne période',
        'PASS',
        `Aucun compteur N sur ${legacyPeriod}.`,
      );
    } finally {
      await expectStatus(
        'REF-1 — RH restaure REFERENCE_PERIOD_START à 06-01',
        200,
        '/settings/REFERENCE_PERIOD_START',
        {
          token: tokens.rh,
          method: 'PATCH',
          body: { settingValue: '06-01', description: 'REF-1 : restauration du paramètre de période.' },
        },
      );
      const [ref1Restored] = await db.query(
        `SELECT setting_value AS settingValue FROM settings WHERE setting_key = 'REFERENCE_PERIOD_START'`,
      );
      invariant(
        ref1Restored[0]?.settingValue === '06-01',
        'REFERENCE_PERIOD_START n’a pas été restauré à 06-01.',
      );
    }
    record('REFERENCE_PERIOD_START restauré à 06-01 (fin REF-1)', 'PASS', 'La suite de clôture/acquisition n’est pas contaminée.');
  }

  section('E6 — Valideurs de secours et remplacements temporaires');

  const e6Today = martiniqueToday();
  const e6ServiceId = fixtures.serviceId;
  const e6ManagerId = fixtures.manager.id;
  const e6CollabA = fixtures.collaborators.a.id;
  const e6CollabB = fixtures.collaborators.b.id;
  const e6CollabC = fixtures.collaborators.c.id;
  const e6Prorata = fixtures.prorataUser.id;

  const [e6HashRows] = await db.query(
    `SELECT password_hash AS passwordHash FROM users WHERE email = 'responsable@gmes.fr'`,
  );
  const e6PasswordHash = e6HashRows[0].passwordHash;
  const e6Password = 'ResponsableGMES@2026!';
  const e6InsertUser = async (nom, prenom, email, role, employmentType = 'INTERNE') => {
    const [result] = await db.execute(
      `INSERT INTO users
        (nom, prenom, email, password_hash, role, employment_type, service_id, hire_date, presence_status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2024-01-01', 'PRESENT', 1)`,
      [nom, prenom, email, e6PasswordHash, role, employmentType, e6ServiceId],
    );
    return Number(result.insertId);
  };

  const e6Secours1 = {
    id: await e6InsertUser('TEST-SECOURS1', 'Sacha', `e6-secours1-${fixtures.tag}@gmes.test`, 'RESPONSABLE_SERVICE'),
    email: `e6-secours1-${fixtures.tag}@gmes.test`,
    password: e6Password,
  };
  const e6Secours2 = {
    id: await e6InsertUser('TEST-SECOURS2', 'Sonia', `e6-secours2-${fixtures.tag}@gmes.test`, 'RESPONSABLE_SERVICE'),
    email: `e6-secours2-${fixtures.tag}@gmes.test`,
    password: e6Password,
  };
  const e6Externe = {
    id: await e6InsertUser('TEST-EXTERNE', 'Émile', `e6-externe-${fixtures.tag}@gmes.test`, 'COLLABORATEUR', 'EXTERNE'),
    email: `e6-externe-${fixtures.tag}@gmes.test`,
    password: e6Password,
  };
  tokens.secours1 = await login('secours E2E 1', [e6Secours1.email, e6Secours1.password, 'RESPONSABLE_SERVICE']);
  tokens.secours2 = await login('secours E2E 2', [e6Secours2.email, e6Secours2.password, 'RESPONSABLE_SERVICE']);

  await expectStatus('ADMIN consulte les valideurs du service', 200, `/services/${e6ServiceId}/validators`, {
    token: tokens.admin,
  }, (body) => {
    invariant(Number(body.primaryManagerId) === e6ManagerId, 'Responsable principal incorrect.');
    invariant(Array.isArray(body.backupValidators), 'backupValidators doit être un tableau.');
    return true;
  });
  await expectStatus('ADMIN ajoute le premier valideur de secours', 201, `/services/${e6ServiceId}/validators`, {
    token: tokens.admin, method: 'POST', body: { validatorId: e6Secours1.id },
  });
  await expectStatus('RH ajoute le second valideur de secours', 201, `/services/${e6ServiceId}/validators`, {
    token: tokens.rh, method: 'POST', body: { validatorId: e6Secours2.id },
  });
  await expectStatus('Un Collaborateur ne gère pas les valideurs de secours', 403, `/services/${e6ServiceId}/validators`, {
    token: tokens.collabA, method: 'POST', body: { validatorId: e6Secours1.id },
  });
  await expectStatus('Le Responsable principal ne peut pas être son propre secours', 400, `/services/${e6ServiceId}/validators`, {
    token: tokens.rh, method: 'POST', body: { validatorId: e6ManagerId },
  });
  await expectStatus('Un Collaborateur ne peut pas être secours', 400, `/services/${e6ServiceId}/validators`, {
    token: tokens.rh, method: 'POST', body: { validatorId: e6CollabA },
  });
  await expectStatus('Secours refusé hors circuit Responsable puis relais', 400, `/services/${adminServiceId}/validators`, {
    token: tokens.rh, method: 'POST', body: { validatorId: e6Secours1.id },
  });
  await expectStatus('Un secours actif ne peut pas être doublonné', 409, `/services/${e6ServiceId}/validators`, {
    token: tokens.rh, method: 'POST', body: { validatorId: e6Secours1.id },
  });
  await expectStatus('ADMIN désactive le secours 1', 200, `/services/${e6ServiceId}/validators/${e6Secours1.id}/disable`, {
    token: tokens.admin, method: 'PATCH',
  });
  await expectStatus('ADMIN réactive le secours 1', 200, `/services/${e6ServiceId}/validators/${e6Secours1.id}/enable`, {
    token: tokens.admin, method: 'PATCH',
  }, (body) => {
    invariant(body.isActive === true, 'Le secours doit être réactivé.');
    return true;
  });
  await expectStatus('La liste des valideurs expose les deux secours', 200, `/services/${e6ServiceId}/validators`, {
    token: tokens.rh,
  }, (body) => {
    invariant(body.backupValidators.length === 2, `Secours listés : ${body.backupValidators.length}.`);
    return true;
  });

  const e6Signature = { signatureType: 'INITIALS', signatureData: 'MG', minimumPresenceJustification: 'Continuité assurée.' };

  const e6PresentDate = await nextOpenDate(addDays(scenarioDate, 100));
  const e6PresentRequest = await createRequest(tokens.collabA, unpaidType.id, e6PresentDate, 'E6 secours bloqué quand le Responsable est présent');
  await submitRequest(tokens.collabA, e6PresentRequest.id);
  await expectStatus('Secours refusé quand le Responsable est présent', 403, `/leave-requests/${e6PresentRequest.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  });
  await expectStatus('Le Responsable principal valide la demande', 200, `/leave-requests/${e6PresentRequest.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6UrgenceDate = await nextOpenDate(addDays(scenarioDate, 103));
  const e6UrgenceRequest = await createRequest(tokens.collabC, unpaidType.id, e6UrgenceDate, 'E6 urgence seule');
  await submitRequest(tokens.collabC, e6UrgenceRequest.id);
  await expectStatus('L’urgence seule n’ouvre pas le secours', 403, `/leave-requests/${e6UrgenceRequest.id}/validate`, {
    token: tokens.secours2, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS', emergencyTakeover: true, takeoverReason: 'Urgence opérationnelle.' },
  });
  await expectStatus('Le Responsable traite la demande', 200, `/leave-requests/${e6UrgenceRequest.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6TodayOpen = new Date(`${e6Today}T00:00:00.000Z`).getUTCDay() !== 0;
  if (!e6TodayOpen) {
    record('E6 — Relais par présence du Responsable', 'SKIP', 'Journée dominicale : l’absence autorisée ne peut pas commencer un dimanche.');
  } else {
    const e6ManagerAbsence = await expectStatus('RH crée une absence autorisée pour le Responsable', 201, '/absence-declarations', {
      token: tokens.rh, method: 'POST',
      body: {
        employeeId: e6ManagerId, leaveTypeId: rhOnlyAbsenceType.id,
        startDate: e6Today, endDate: e6Today,
        durationHours: 7, comment: 'Absence du Responsable pour le relais secours E6.',
      },
    });
    await expectStatus('La RH soumet l’absence du Responsable', 200, `/absence-declarations/${e6ManagerAbsence.body.id}/submit`, {
      token: tokens.rh, method: 'POST', body: { certifiedAccurate: true },
    });

    const e6AbsentDate = await nextOpenDate(addDays(scenarioDate, 106));
    const e6AbsentRequest = await createRequest(tokens.collabA, unpaidType.id, e6AbsentDate, 'E6 secours autorisé Responsable absent');
    await submitRequest(tokens.collabA, e6AbsentRequest.id);
    await expectStatus('Le secours valide quand le Responsable est absent', 200, `/leave-requests/${e6AbsentRequest.id}/validate`, {
      token: tokens.secours1, method: 'POST',
      body: { ...e6Signature, signatureData: 'SS' },
    }, (body) => {
      invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
      return true;
    });

    const e6LockDate = await nextOpenDate(addDays(scenarioDate, 109));
    const e6LockRequest = await createRequest(tokens.collabB, unpaidType.id, e6LockDate, 'E6 premier décideur verrouille');
    await submitRequest(tokens.collabB, e6LockRequest.id);
    await expectStatus('Le second secours est bloqué sur une demande déjà décidée', 409, `/leave-requests/${e6AbsentRequest.id}/validate`, {
      token: tokens.secours2, method: 'POST',
      body: { ...e6Signature, signatureData: 'SS' },
    });
    await expectStatus('Le premier secours décide, le second ne peut plus', 200, `/leave-requests/${e6LockRequest.id}/validate`, {
      token: tokens.secours1, method: 'POST',
      body: { ...e6Signature, signatureData: 'SS' },
    });
    await expectStatus('La deuxième décision sur la même demande est refusée', 409, `/leave-requests/${e6LockRequest.id}/validate`, {
      token: tokens.secours2, method: 'POST',
      body: { ...e6Signature, signatureData: 'SS' },
    });

    await expectStatus('La RH annule l’absence du Responsable', 200, `/absence-declarations/${e6ManagerAbsence.body.id}/cancel`, {
      token: tokens.rh, method: 'POST',
    });
  }

  await expectStatus('Un Responsable ne crée pas les remplacements', 403, '/validator-replacements', {
    token: tokens.manager, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Employee externe refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6Externe.id, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Employee RH refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: rhUserId, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Employee Responsable refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6Secours1.id, replacementValidatorId: e6Secours2.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Employee Directeur refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: directeurUserId, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Remplaçant Collaborateur refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: e6CollabA.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Remplaçant Admin refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: adminUserId, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Employee identique au remplaçant refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: e6CollabB, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('Période inversée refusée', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabA, replacementValidatorId: e6Secours1.id, startDate: addDays(e6Today, 2), endDate: e6Today },
  });
  const e6OverlapFirst = await expectStatus('RH crée un remplacement pour le collaborateur prorata', 201, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6Prorata, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today, reason: 'Chevauchement E6.' },
  });
  await expectStatus('Un remplacement chevauchant est refusé', 400, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6Prorata, replacementValidatorId: e6Secours2.id, startDate: e6Today, endDate: e6Today },
  });
  await expectStatus('RH désactive le remplacement chevauchant', 200, `/validator-replacements/${e6OverlapFirst.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });

  const e6CollabAReplacement = await expectStatus('RH crée un remplacement actif pour le collaborateur A', 201, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabA, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today, reason: 'Remplacement E6 collaborateur A.' },
  });

  const e6BeforeReplacementDate = await nextOpenDate(addDays(scenarioDate, 112));
  const e6BeforeReplacement = await createRequest(tokens.collabB, unpaidType.id, e6BeforeReplacementDate, 'E6 bascule dynamique vers le remplaçant');
  await submitRequest(tokens.collabB, e6BeforeReplacement.id);
  const e6CollabBReplacement = await expectStatus('RH crée le remplacement du collaborateur B', 201, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: e6Secours1.id, startDate: e6Today, endDate: e6Today, reason: 'Remplacement E6 collaborateur B.' },
  });
  await expectStatus('Le Responsable remplacé est refusé sur la demande du collaborateur B', 403, `/leave-requests/${e6BeforeReplacement.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  });
  await expectStatus('Le remplaçant reprend la demande soumise avant sa désignation', 200, `/leave-requests/${e6BeforeReplacement.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  record(
    'Bornes de dates inclusives (début = fin = jour courant)',
    'PASS',
    'Le remplacement actif le jour courant couvre sa date de début et de fin.',
  );

  const e6OtherCollabDate = await nextOpenDate(addDays(scenarioDate, 115));
  const e6OtherCollab = await createRequest(tokens.collabC, unpaidType.id, e6OtherCollabDate, 'E6 Responsable conserve ses autres collaborateurs');
  await submitRequest(tokens.collabC, e6OtherCollab.id);
  await expectStatus('Le Responsable remplacé reste autorisé sur un autre collaborateur', 200, `/leave-requests/${e6OtherCollab.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await expectStatus('RH consulte les remplacements avec filtres', 200, `/validator-replacements?employeeId=${e6CollabB}&isActive=true&activeAt=${e6Today}`, {
    token: tokens.rh,
  }, (body) => {
    invariant(Array.isArray(body), 'La réponse doit être un tableau.');
    return true;
  });
  await expectStatus('RH consulte un remplacement par identifiant', 200, `/validator-replacements/${e6CollabBReplacement.body.id}`, {
    token: tokens.rh,
  }, (body) => {
    invariant(Number(body.id) === e6CollabBReplacement.body.id, 'Identifiant incorrect.');
    return true;
  });

  const e6PendingDate = await nextOpenDate(addDays(scenarioDate, 118));
  const e6PendingRequest = await createRequest(tokens.collabB, unpaidType.id, e6PendingDate, 'E6 liste d’attente du remplaçant');
  await submitRequest(tokens.collabB, e6PendingRequest.id);
  await expectStatus('Le remplaçant voit la demande dans sa liste d’attente', 200, '/leave-requests/pending', {
    token: tokens.secours1,
  }, (body) => {
    invariant(Array.isArray(body), 'La liste doit être un tableau.');
    invariant(body.some((item) => Number(item.id) === e6PendingRequest.id), 'La demande du collaborateur B manque pour le remplaçant.');
    return true;
  });
  await expectStatus('Le Responsable remplacé ne voit plus la demande du collaborateur B', 200, '/leave-requests/pending', {
    token: tokens.manager,
  }, (body) => {
    invariant(Array.isArray(body), 'La liste doit être un tableau.');
    invariant(!body.some((item) => Number(item.id) === e6PendingRequest.id), 'La demande du collaborateur B ne doit pas apparaître pour le Responsable remplacé.');
    return true;
  });
  await expectStatus('Le remplaçant valide la demande en attente', 200, `/leave-requests/${e6PendingRequest.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6NotificationDate = await nextOpenDate(addDays(scenarioDate, 121));
  const e6NotificationRequest = await createRequest(tokens.collabB, unpaidType.id, e6NotificationDate, 'E6 notification du remplaçant');
  await submitRequest(tokens.collabB, e6NotificationRequest.id);
  const [e6NotifRows] = await db.execute(
    `SELECT user_id AS userId FROM notifications WHERE leave_request_id = ? AND type = 'LEAVE_REQUEST_SUBMITTED'`,
    [e6NotificationRequest.id],
  );
  const e6NotifUserIds = e6NotifRows.map((row) => Number(row.userId));
  const e6NotifOk = e6NotifUserIds.includes(e6Secours1.id) && !e6NotifUserIds.includes(e6ManagerId);
  record(
    'La notification de soumission désigne le remplaçant, pas le Responsable remplacé',
    e6NotifOk ? 'PASS' : 'FAIL',
    e6NotifOk ? `Destinataires : ${e6NotifUserIds.join(', ')}.` : `Destinataires obtenus : ${e6NotifUserIds.join(', ')}.`,
  );
  invariant(e6NotifOk, 'Le destinataire de la notification est incorrect.');
  await expectStatus('Le remplaçant valide la demande notifiée', 200, `/leave-requests/${e6NotificationRequest.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6DelayDate1 = await nextOpenDate(addDays(scenarioDate, 124));
  const e6DelayReplacement = await createRequest(tokens.collabB, unpaidType.id, e6DelayDate1, 'E6 délai expiré : remplaçant conserve son droit');
  await submitRequest(tokens.collabB, e6DelayReplacement.id);
  await db.execute(
    `UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?`,
    [e6DelayReplacement.id],
  );
  await expectStatus('Délai expiré : le remplaçant conserve son droit de décision', 200, `/leave-requests/${e6DelayReplacement.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6DelayDate2 = await nextOpenDate(addDays(scenarioDate, 127));
  const e6DelaySecours = await createRequest(tokens.collabB, unpaidType.id, e6DelayDate2, 'E6 délai expiré : secours autorisé');
  await submitRequest(tokens.collabB, e6DelaySecours.id);
  await db.execute(
    `UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?`,
    [e6DelaySecours.id],
  );
  await expectStatus('Délai expiré : le secours valide', 200, `/leave-requests/${e6DelaySecours.id}/validate`, {
    token: tokens.secours2, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6DelayDate3 = await nextOpenDate(addDays(scenarioDate, 130));
  const e6DelayRelais = await createRequest(tokens.collabB, unpaidType.id, e6DelayDate3, 'E6 délai expiré : Directeur autorisé');
  await submitRequest(tokens.collabB, e6DelayRelais.id);
  await db.execute(
    `UPDATE leave_requests SET submitted_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?`,
    [e6DelayRelais.id],
  );
  await expectStatus('Délai expiré : le Directeur valide en relais', 200, `/leave-requests/${e6DelayRelais.id}/validate`, {
    token: tokens.directeur, method: 'POST',
    body: { ...e6Signature, signatureData: 'DR' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6DelayDate4 = await nextOpenDate(addDays(scenarioDate, 133));
  const e6DelayManager = await createRequest(tokens.collabB, unpaidType.id, e6DelayDate4, 'E6 Responsable remplacé toujours exclu');
  await submitRequest(tokens.collabB, e6DelayManager.id);
  await expectStatus('Le Responsable remplacé reste exclu pendant le remplacement', 403, `/leave-requests/${e6DelayManager.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  });
  await expectStatus('Le remplaçant traite la demande laissée par le Responsable', 200, `/leave-requests/${e6DelayManager.id}/validate`, {
    token: tokens.secours1, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  await expectStatus('RH désactive le remplacement du collaborateur B', 200, `/validator-replacements/${e6CollabBReplacement.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });
  const e6EndDate = await nextOpenDate(addDays(scenarioDate, 136));
  const e6EndRequest = await createRequest(tokens.collabB, unpaidType.id, e6EndDate, 'E6 retour du circuit normal');
  await submitRequest(tokens.collabB, e6EndRequest.id);
  await expectStatus('Fin du remplacement : le Responsable valide de nouveau', 200, `/leave-requests/${e6EndRequest.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const e6RhReplacement = await expectStatus('RH désigne la RH comme remplaçante', 201, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: rhUserId, startDate: e6Today, endDate: e6Today, reason: 'Remplacement par la RH E6.' },
  });
  const e6RhReplDate = await nextOpenDate(addDays(scenarioDate, 139));
  const e6RhReplRequest = await createRequest(tokens.collabB, unpaidType.id, e6RhReplDate, 'E6 RH remplaçante');
  await submitRequest(tokens.collabB, e6RhReplRequest.id);
  await expectStatus('La RH désignée remplaçante valide en premier niveau', 200, `/leave-requests/${e6RhReplRequest.id}/validate`, {
    token: tokens.rh, method: 'POST',
    body: { ...e6Signature, signatureData: 'RH', rhConfirmedDirectorAgreement: true },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('RH désactive son remplacement', 200, `/validator-replacements/${e6RhReplacement.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });

  const e6DirReplacement = await expectStatus('RH désigne le Directeur comme remplaçant', 201, '/validator-replacements', {
    token: tokens.rh, method: 'POST',
    body: { employeeId: e6CollabB, replacementValidatorId: directeurUserId, startDate: e6Today, endDate: e6Today, reason: 'Remplacement par le Directeur E6.' },
  });
  const e6DirReplDate = await nextOpenDate(addDays(scenarioDate, 142));
  const e6DirReplRequest = await createRequest(tokens.collabB, unpaidType.id, e6DirReplDate, 'E6 Directeur remplaçant');
  await submitRequest(tokens.collabB, e6DirReplRequest.id);
  await expectStatus('Le Directeur désigné remplaçant valide en premier niveau', 200, `/leave-requests/${e6DirReplRequest.id}/validate`, {
    token: tokens.directeur, method: 'POST',
    body: { ...e6Signature, signatureData: 'DR' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await expectStatus('RH désactive le remplacement du Directeur', 200, `/validator-replacements/${e6DirReplacement.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });

  await db.execute(`UPDATE users SET is_active = 0 WHERE id = ?`, [e6Secours1.id]);
  const e6DisabledReplDate = await nextOpenDate(addDays(scenarioDate, 145));
  const e6DisabledReplRequest = await createRequest(tokens.collabA, unpaidType.id, e6DisabledReplDate, 'E6 remplaçant désactivé');
  await submitRequest(tokens.collabA, e6DisabledReplRequest.id);
  await expectStatus('Le Responsable remplacé reste exclu malgré le remplaçant inactif', 403, `/leave-requests/${e6DisabledReplRequest.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  });
  await expectStatus('Le secours reprend la demande quand le remplaçant est inactif', 200, `/leave-requests/${e6DisabledReplRequest.id}/validate`, {
    token: tokens.secours2, method: 'POST',
    body: { ...e6Signature, signatureData: 'SS' },
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });
  await db.execute(`UPDATE users SET is_active = 1 WHERE id = ?`, [e6Secours1.id]);
  await expectStatus('RH désactive le remplacement du collaborateur A', 200, `/validator-replacements/${e6CollabAReplacement.body.id}/disable`, {
    token: tokens.rh, method: 'PATCH',
  });
  const e6RestoredDate = await nextOpenDate(addDays(scenarioDate, 148));
  const e6RestoredRequest = await createRequest(tokens.collabA, unpaidType.id, e6RestoredDate, 'E6 circuit normal restauré pour le collaborateur A');
  await submitRequest(tokens.collabA, e6RestoredRequest.id);
  await expectStatus('Le Responsable valide de nouveau après désactivation du remplacement', 200, `/leave-requests/${e6RestoredRequest.id}/validate`, {
    token: tokens.manager, method: 'POST', body: e6Signature,
  }, (body) => {
    invariant(body.status === 'VALIDEE', `Statut obtenu ${body.status}.`);
    return true;
  });

  const [e6AuditRows] = await db.execute(
    `SELECT action, COUNT(*) AS total FROM audit_logs
      WHERE action IN ('SERVICE_BACKUP_VALIDATOR_ASSIGNED', 'SERVICE_BACKUP_VALIDATOR_DISABLED', 'SERVICE_BACKUP_VALIDATOR_ENABLED', 'VALIDATOR_REPLACEMENT_CREATED', 'VALIDATOR_REPLACEMENT_DISABLED')
      GROUP BY action`,
  );
  const e6AuditByAction = Object.fromEntries(e6AuditRows.map((row) => [row.action, Number(row.total)]));
  const e6AuditOk =
    e6AuditByAction['SERVICE_BACKUP_VALIDATOR_ASSIGNED'] >= 2 &&
    e6AuditByAction['SERVICE_BACKUP_VALIDATOR_DISABLED'] >= 1 &&
    e6AuditByAction['SERVICE_BACKUP_VALIDATOR_ENABLED'] >= 1 &&
    e6AuditByAction['VALIDATOR_REPLACEMENT_CREATED'] >= 5 &&
    e6AuditByAction['VALIDATOR_REPLACEMENT_DISABLED'] >= 5;
  record(
    'Les cinq actions d’audit E6 sont tracées',
    e6AuditOk ? 'PASS' : 'FAIL',
    e6AuditOk ? '5 actions présentes.' : JSON.stringify(e6AuditByAction),
  );
  invariant(e6AuditOk, 'L’audit E6 est incomplet.');

  section('Validation finale de la base');
  const [tableRows] = await db.query(
    `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [expectedTestDatabase],
  );
  const expectedTables = [
    'absence_declarations', 'audit_logs', 'balance_movements', 'derogations',
    'documents', 'holidays', 'leave_balances', 'leave_requests', 'leave_types',
    'notifications', 'service_backup_validators', 'services', 'settings', 'users',
    'validator_replacements',
  ].sort();
  const actualTables = tableRows.map((row) => row.tableName).sort();
  const schemaOk = JSON.stringify(actualTables) === JSON.stringify(expectedTables);
  record(
    'La base conserve exactement les 15 tables du diagramme',
    schemaOk ? 'PASS' : 'FAIL',
    schemaOk ? '15 tables conformes.' : `Tables obtenues : ${actualTables.join(', ')}`,
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
