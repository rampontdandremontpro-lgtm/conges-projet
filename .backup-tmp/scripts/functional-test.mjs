const apiBaseUrl = (process.env.API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
const runMutatingTests = String(process.env.RUN_MUTATING_TESTS ?? '').toLowerCase() === 'true';

const accounts = {
  admin: ['admin@gmes.fr', 'AdminGMES@2026!', 'ADMIN'],
  rh: ['rh@gmes.fr', 'RhGMES@2026!', 'RH'],
  directeur: ['directeur@gmes.fr', 'DirecteurGMES@2026!', 'DIRECTEUR'],
  responsable: ['responsable@gmes.fr', 'ResponsableGMES@2026!', 'RESPONSABLE_SERVICE'],
  collaborateur: ['collaborateur@gmes.fr', 'CollaborateurGMES@2026!', 'COLLABORATEUR'],
};

const results = [];

function record(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function request(path, { token, method = 'GET', body, binary = false } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Accept: binary ? '*/*' : 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (binary) {
    return { response, body: Buffer.from(await response.arrayBuffer()) };
  }

  const contentType = response.headers.get('content-type') ?? '';
  const parsed = response.status === 204
    ? null
    : contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  return { response, body: parsed };
}

async function login(name, [email, password, role]) {
  const { response, body } = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const ok = response.status === 200 && body?.user?.role === role && body?.accessToken;
  record(`Connexion ${name}`, Boolean(ok), ok ? role : `HTTP ${response.status}`);
  if (!ok) throw new Error(`Connexion impossible pour ${email}`);
  return body.accessToken;
}

async function expectStatus(label, expected, path, options = {}) {
  const { response, body } = await request(path, options);
  const ok = response.status === expected;
  record(label, ok, ok ? `HTTP ${expected}` : `HTTP ${response.status} ${JSON.stringify(body)}`);
  return { response, body, ok };
}

function containsSensitiveKey(value) {
  const blocked = new Set([
    'nom', 'prenom', 'email', 'comment', 'refusalComment', 'signatureData',
    'employeeSignatureData', 'validatorSignatureData', 'originalName', 'storageKey',
  ]);
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => blocked.has(key) || containsSensitiveKey(child));
}

async function main() {
  console.log(`API testée : ${apiBaseUrl}`);
  console.log(`Tests modifiant la base : ${runMutatingTests ? 'ACTIVÉS' : 'désactivés'}`);
  const tokens = {};
  for (const [name, account] of Object.entries(accounts)) {
    tokens[name] = await login(name, account);
  }

  console.log('\nSynchronisation des jours fériés');
  await expectStatus(
    'Collaborateur ne synchronise pas les jours fériés',
    403,
    '/holidays/sync/martinique',
    { token: tokens.collaborateur, method: 'POST', body: { year: new Date().getFullYear() } },
  );
  await expectStatus(
    'RH consulte les jours fériés',
    200,
    `/holidays?year=${new Date().getFullYear()}`,
    { token: tokens.rh },
  );
  if (runMutatingTests) {
    await expectStatus(
      'RH synchronise les jours fériés officiels de Martinique',
      201,
      '/holidays/sync/martinique',
      { token: tokens.rh, method: 'POST', body: { year: new Date().getFullYear() } },
    );
  }

  console.log('\nExports RH');
  const csv = await request('/exports/leave-requests?format=csv', {
    token: tokens.rh,
    binary: true,
  });
  record(
    'RH exporte les demandes en CSV',
    csv.response.status === 200 && (csv.response.headers.get('content-type') ?? '').includes('text/csv'),
    `HTTP ${csv.response.status}`,
  );
  const xlsx = await request('/exports/absence-declarations?format=xlsx', {
    token: tokens.rh,
    binary: true,
  });
  record(
    'RH exporte les absences en XLSX',
    xlsx.response.status === 200 && xlsx.body.slice(0, 2).toString() === 'PK',
    `HTTP ${xlsx.response.status}`,
  );
  await expectStatus(
    'Directeur ne télécharge pas l’export nominatif RH',
    403,
    '/exports/leave-requests?format=csv',
    { token: tokens.directeur },
  );
  await expectStatus(
    'Collaborateur ne télécharge pas l’export nominatif RH',
    403,
    '/exports/absence-declarations?format=csv',
    { token: tokens.collaborateur },
  );

  console.log('\nStatistiques agrégées du Directeur');
  const stats = await expectStatus(
    'Directeur consulte les statistiques agrégées',
    200,
    `/reports/director/statistics?year=${new Date().getFullYear()}`,
    { token: tokens.directeur },
  );
  record(
    'Le rapport Directeur ne contient aucune donnée nominative ou sensible',
    stats.ok && !containsSensitiveKey(stats.body),
  );
  await expectStatus(
    'RH ne consulte pas le rapport réservé au Directeur',
    403,
    '/reports/director/statistics',
    { token: tokens.rh },
  );
  await expectStatus(
    'Admin ne consulte pas le rapport métier Directeur',
    403,
    '/reports/director/statistics',
    { token: tokens.admin },
  );

  console.log('\nClôture des compteurs et reports exceptionnels');
  const currentYear = new Date().getFullYear();
  const referencePeriod = `${currentYear - 1}-${currentYear}`;
  await expectStatus(
    'RH prévisualise une clôture sans modifier les soldes',
    200,
    `/leave-balances/period/${referencePeriod}/preview`,
    { token: tokens.rh },
  );
  await expectStatus(
    'Directeur ne clôture pas les compteurs',
    403,
    '/leave-balances/period/close',
    {
      token: tokens.directeur,
      method: 'POST',
      body: { referencePeriod, confirm: true },
    },
  );
  await expectStatus(
    'Collaborateur ne décide pas un report exceptionnel',
    403,
    '/leave-balances/period/carryover',
    {
      token: tokens.collaborateur,
      method: 'POST',
      body: {
        employeeId: 1,
        closingReferencePeriod: referencePeriod,
        days: 1,
        reason: 'Test de sécurité',
      },
    },
  );

  console.log('\nContrôles généraux de confidentialité');
  await expectStatus('Route protégée sans jeton', 401, '/reports/director/statistics');
  await expectStatus(
    'Admin reste exclu des soldes métier',
    403,
    '/leave-balances/my',
    { token: tokens.admin },
  );
  await expectStatus(
    'Directeur reste exclu des justificatifs RH',
    403,
    '/documents/management',
    { token: tokens.directeur },
  );

  const failures = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failures.length}/${results.length} contrôles réussis.`);
  if (failures.length) {
    console.error('\nContrôles en échec :');
    failures.forEach((failure) => console.error(`- ${failure.label}: ${failure.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
