const apiBaseUrl = (process.env.API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');

const accounts = {
  admin: {
    email: 'admin@gmes.fr',
    password: 'AdminGMES@2026!',
    role: 'ADMIN',
  },
  rh: {
    email: 'rh@gmes.fr',
    password: 'RhGMES@2026!',
    role: 'RH',
  },
  directeur: {
    email: 'directeur@gmes.fr',
    password: 'DirecteurGMES@2026!',
    role: 'DIRECTEUR',
  },
  responsable: {
    email: 'responsable@gmes.fr',
    password: 'ResponsableGMES@2026!',
    role: 'RESPONSABLE_SERVICE',
  },
  collaborateur: {
    email: 'collaborateur@gmes.fr',
    password: 'CollaborateurGMES@2026!',
    role: 'COLLABORATEUR',
  },
};

const results = [];

function record(label, ok, details = '') {
  results.push({ label, ok, details });
  const symbol = ok ? 'OK ' : 'KO ';
  console.log(`${symbol} ${label}${details ? ` — ${details}` : ''}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  let body = null;

  if (response.status !== 204) {
    body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  }

  return { response, body };
}

async function login(accountName, account) {
  const { response, body } = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  });

  const ok =
    response.status === 200 &&
    typeof body?.accessToken === 'string' &&
    body?.user?.role === account.role;

  record(
    `Connexion ${accountName}`,
    ok,
    ok ? account.role : `HTTP ${response.status} ${JSON.stringify(body)}`,
  );

  if (!ok) {
    throw new Error(`Connexion impossible pour ${account.email}`);
  }

  return body.accessToken;
}

async function check({ label, token, method = 'GET', path, expectedStatus }) {
  const { response, body } = await request(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const ok = response.status === expectedStatus;
  record(
    label,
    ok,
    ok ? `HTTP ${response.status}` : `HTTP ${response.status} ${JSON.stringify(body)}`,
  );
}

async function main() {
  console.log(`API testée : ${apiBaseUrl}`);
  console.log('');

  const tokens = {};
  for (const [name, account] of Object.entries(accounts)) {
    tokens[name] = await login(name, account);
  }

  console.log('');
  console.log('Authentification et identité');
  for (const [name, token] of Object.entries(tokens)) {
    await check({
      label: `/auth/me pour ${name}`,
      token,
      path: '/auth/me',
      expectedStatus: 200,
    });
  }

  await check({
    label: '/auth/me sans jeton',
    path: '/auth/me',
    expectedStatus: 401,
  });

  console.log('');
  console.log('Administration et confidentialité');
  await check({
    label: 'Admin consulte les utilisateurs',
    token: tokens.admin,
    path: '/users',
    expectedStatus: 200,
  });
  await check({
    label: 'RH consulte les utilisateurs',
    token: tokens.rh,
    path: '/users',
    expectedStatus: 200,
  });
  await check({
    label: 'Collaborateur ne consulte pas les utilisateurs',
    token: tokens.collaborateur,
    path: '/users',
    expectedStatus: 403,
  });
  await check({
    label: 'Admin consulte les services',
    token: tokens.admin,
    path: '/services',
    expectedStatus: 200,
  });
  await check({
    label: 'Directeur consulte les services',
    token: tokens.directeur,
    path: '/services',
    expectedStatus: 200,
  });
  await check({
    label: 'Collaborateur ne consulte pas la gestion des services',
    token: tokens.collaborateur,
    path: '/services',
    expectedStatus: 403,
  });
  await check({
    label: 'Admin consulte les types',
    token: tokens.admin,
    path: '/leave-types',
    expectedStatus: 200,
  });

  console.log('');
  console.log('Fonctionnalités métier déjà présentes');
  await check({
    label: 'Collaborateur consulte ses demandes',
    token: tokens.collaborateur,
    path: '/leave-requests/my',
    expectedStatus: 200,
  });
  await check({
    label: 'RH consulte les demandes à traiter',
    token: tokens.rh,
    path: '/leave-requests/pending',
    expectedStatus: 200,
  });
  await check({
    label: 'Directeur consulte les demandes à traiter',
    token: tokens.directeur,
    path: '/leave-requests/pending',
    expectedStatus: 200,
  });
  await check({
    label: 'Responsable consulte les demandes à traiter',
    token: tokens.responsable,
    path: '/leave-requests/pending',
    expectedStatus: 200,
  });
  await check({
    label: 'Collaborateur consulte ses déclarations d’absence',
    token: tokens.collaborateur,
    path: '/absence-declarations/my',
    expectedStatus: 200,
  });
  await check({
    label: 'RH consulte les déclarations d’absence',
    token: tokens.rh,
    path: '/absence-declarations/management',
    expectedStatus: 200,
  });
  await check({
    label: 'Collaborateur ne consulte pas toutes les déclarations',
    token: tokens.collaborateur,
    path: '/absence-declarations/management',
    expectedStatus: 403,
  });
  await check({
    label: 'Collaborateur consulte ses justificatifs',
    token: tokens.collaborateur,
    path: '/documents/my',
    expectedStatus: 200,
  });
  await check({
    label: 'RH consulte les justificatifs à contrôler',
    token: tokens.rh,
    path: '/documents/management',
    expectedStatus: 200,
  });
  await check({
    label: 'Directeur ne consulte pas le contenu RH des justificatifs',
    token: tokens.directeur,
    path: '/documents/management',
    expectedStatus: 403,
  });
  await check({
    label: 'Collaborateur consulte ses dérogations',
    token: tokens.collaborateur,
    path: '/derogations/my',
    expectedStatus: 200,
  });
  await check({
    label: 'RH consulte les dérogations',
    token: tokens.rh,
    path: '/derogations/management',
    expectedStatus: 200,
  });
  await check({
    label: 'Collaborateur consulte ses soldes',
    token: tokens.collaborateur,
    path: '/leave-balances/my',
    expectedStatus: 200,
  });
  await check({
    label: 'Admin ne consulte pas les soldes métier',
    token: tokens.admin,
    path: '/leave-balances/my',
    expectedStatus: 403,
  });

  const failed = results.filter((result) => !result.ok);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} contrôles réussis.`);

  if (failed.length > 0) {
    console.error('');
    console.error('Contrôles en échec :');
    for (const failure of failed) {
      console.error(`- ${failure.label}: ${failure.details}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
