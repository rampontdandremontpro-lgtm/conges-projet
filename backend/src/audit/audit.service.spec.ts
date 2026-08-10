import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';

describe('AuditService.recordStatusChange (colonnes explicites, sans legacy)', () => {
  function buildService() {
    const created: any[] = [];
    const repository = {
      create: jest.fn((input: unknown) => {
        created.push(input);
        return { ...(input as object) };
      }),
      save: jest.fn((log: unknown) => Promise.resolve(log)),
    } as any;
    const service = new AuditService(repository);
    return { service, created };
  }

  it('écrit resourceType, resourceId et actorId explicitement', async () => {
    const { service, created } = buildService();
    await service.recordStatusChange({
      actorId: 3,
      action: 'DEMANDE_SOUMISE',
      resourceType: 'LEAVE_REQUESTS',
      resourceId: 42,
      oldStatus: 'BROUILLON',
      newStatus: 'EN_ATTENTE_VALIDATION',
      comment: 'Soumission par le collaborateur',
      metadata: { deductedDays: 2 },
    });

    const input = created[0];
    expect(input.actorId).toBe(3);
    expect(input.action).toBe('DEMANDE_SOUMISE');
    expect(input.resourceType).toBe('LEAVE_REQUESTS');
    expect(input.resourceId).toBe(42);
  });

  it('mappe oldStatus → oldValue.status et newStatus/comment/metadata → newValue', async () => {
    const { service, created } = buildService();
    await service.recordStatusChange({
      actorId: 8,
      action: 'DEMANDE_VALIDEE',
      resourceType: 'LEAVE_REQUESTS',
      resourceId: 7,
      oldStatus: 'EN_ATTENTE_VALIDATION',
      newStatus: 'VALIDEE',
      comment: 'Validé par le responsable',
      metadata: { realBalanceBefore: 10, finalDeciderRole: 'RESPONSABLE' },
    });

    const input = created[0];
    expect(input.oldValue).toEqual({ status: 'EN_ATTENTE_VALIDATION' });
    expect(input.newValue).toEqual({
      status: 'VALIDEE',
      comment: 'Validé par le responsable',
      metadata: { realBalanceBefore: 10, finalDeciderRole: 'RESPONSABLE' },
    });
  });

  it('ne requiert aucune propriété legacy : uniquement les colonnes persistées', async () => {
    const { service, created } = buildService();
    await service.recordStatusChange({
      actorId: 4,
      action: 'CONGE_DIRECTEUR_ENREGISTRE',
      resourceType: 'LEAVE_REQUESTS',
      resourceId: 18,
      oldStatus: null,
      newStatus: 'VALIDEE',
      comment: null,
      metadata: null,
    });

    const input = created[0];
    expect(Object.keys(input).sort()).toEqual(
      [
        'actorId',
        'action',
        'resourceType',
        'resourceId',
        'oldValue',
        'newValue',
        'ipAddress',
      ].sort(),
    );
    expect(input.leaveRequestId).toBeUndefined();
    expect(input.leaveRequest).toBeUndefined();
    expect(input.oldStatus).toBeUndefined();
    expect(input.newStatus).toBeUndefined();
    expect(input.comment).toBeUndefined();
    expect(input.metadata).toBeUndefined();
  });

  it("l'entité AuditLog ne porte plus de hook normalizeLegacyPayload ni de champs legacy", () => {
    const log = new AuditLog();
    expect((log as any).normalizeLegacyPayload).toBeUndefined();
    expect((log as any).leaveRequestId).toBeUndefined();
    expect((log as any).leaveRequest).toBeUndefined();
    expect((log as any).oldStatus).toBeUndefined();
    expect((log as any).newStatus).toBeUndefined();
    expect((log as any).comment).toBeUndefined();
    expect((log as any).metadata).toBeUndefined();

    expect('actorId' in log).toBe(true);
    expect('action' in log).toBe(true);
    expect('resourceType' in log).toBe(true);
    expect('resourceId' in log).toBe(true);
    expect('oldValue' in log).toBe(true);
    expect('newValue' in log).toBe(true);
    expect('ipAddress' in log).toBe(true);
    expect('createdAt' in log).toBe(true);
  });
});
