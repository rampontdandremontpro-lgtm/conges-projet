import { of } from 'rxjs';

import { AuditInterceptor } from './audit.interceptor';

/**
 * Test ciblé sur la confidentialité des journaux d'audit techniques.
 * Reproduit la condition du test fonctionnel (full-functional-test.mjs) :
 *  - aucun nom de clé sensible ne doit subsister dans le JSON journalisé ;
 *  - aucune valeur sensible ne doit apparaître dans le JSON journalisé.
 */
describe('AuditInterceptor (confidentialité des journaux)', () => {
  const forbiddenKeys = new Set([
    'password',
    'passwordHash',
    'token',
    'signatureData',
    'employeeSignatureData',
    'validatorSignatureData',
    'file',
  ]);

  function containsKey(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some((item) => containsKey(item));
    }
    if (!value || typeof value !== 'object') {
      return false;
    }
    return Object.entries(value).some(
      ([key, child]) => forbiddenKeys.has(key) || containsKey(child),
    );
  }

  function buildContext(
    method: string,
    path: string,
    body: unknown,
  ): any {
    const request = {
      method,
      path,
      route: { path },
      params: {},
      headers: {},
      ip: '127.0.0.1',
      body,
    };
    const response = { statusCode: 201 };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
  }

  function runIntercept(
    interceptor: AuditInterceptor,
    context: any,
    response: unknown,
  ): Promise<void> {
    const next = { handle: () => of(response) };
    return new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        complete: () => setTimeout(resolve, 20),
      });
    });
  }

  it('supprime intégralement les clés sensibles du journal technique', async () => {
    let recorded: any = null;
    const interceptor = new AuditInterceptor({
      record: (input: unknown) => {
        recorded = input;
        return Promise.resolve({});
      },
    } as any);

    const body = {
      leaveTypeId: 1,
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      comment: 'Bonjour',
      password: 'AdminGMES@2026!',
      passwordHash: '$2b$10$hash',
      token: 'abc.def.ghi',
      signatureData: 'data:image/png;base64,XXXX',
      employeeSignatureData: 'signature collaborateur',
      validatorSignatureData: 'signature valideur',
      file: { originalname: 'scan.pdf', size: 42 },
    };

    await runIntercept(
      interceptor,
      buildContext('POST', '/api/leave-requests', body),
      { id: 1 },
    );

    expect(recorded).not.toBeNull();
    const serialized = JSON.stringify(recorded);
    const storedBody = (recorded as any).newValue.body;

    expect(containsKey(recorded)).toBe(false);
    expect(serialized).not.toContain('AdminGMES@2026!');
    expect(serialized).not.toContain('[MASQUE]');

    // Les données légitimes sont conservées telles quelles.
    expect(storedBody.comment).toBe('Bonjour');
    expect(storedBody.leaveTypeId).toBe(1);
  });

  it('supprime les clés sensibles imbriquées à n’importe quelle profondeur', async () => {
    let recorded: any = null;
    const interceptor = new AuditInterceptor({
      record: (input: unknown) => {
        recorded = input;
        return Promise.resolve({});
      },
    } as any);

    const body = {
      nested: {
        credentials: { token: 'abc', passwordHash: 'hash' },
        items: [
          { signatureData: 'x', ok: true },
          { ok: false },
        ],
      },
      file: { name: 'photo.jpg' },
    };

    await runIntercept(
      interceptor,
      buildContext('POST', '/api/absence-declarations', body),
      { id: 7 },
    );

    expect(containsKey(recorded)).toBe(false);
    expect(JSON.stringify(recorded)).not.toContain('abc');
    expect(JSON.stringify(recorded)).not.toContain('photo.jpg');
  });

  it('ne journalise pas les routes /api/auth (jetons et mots de passe exclus)', async () => {
    let recorded: any = null;
    const interceptor = new AuditInterceptor({
      record: (input: unknown) => {
        recorded = input;
        return Promise.resolve({});
      },
    } as any);

    await runIntercept(
      interceptor,
      buildContext('POST', '/api/auth/login', {
        email: 'user@gmes.fr',
        password: 'SuperSecret@2026!',
      }),
      { accessToken: 'jwt' },
    );

    expect(recorded).toBeNull();
  });
});
