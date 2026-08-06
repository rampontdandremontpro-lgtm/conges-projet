import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, Repository } from 'typeorm';

import type { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import type { AbsenceDeclarationsService } from '../absence-declarations/absence-declarations.service';
import type { LeaveRequest } from '../leave-requests/leave-request.entity';
import type { Document } from './document.entity';
import { DocumentsService } from './documents.service';

interface RepositoryCountOptions {
  where?: Record<string, unknown> | Record<string, unknown>[];
}

interface CountableDocumentsService {
  countActiveForParent(input: {
    leaveRequestId: number | null;
    absenceDeclarationId: number | null;
  }): Promise<number>;
}

function createService() {
  let lastCountOptions: RepositoryCountOptions | undefined;

  const count = jest.fn(
    async (options?: RepositoryCountOptions): Promise<number> => {
      lastCountOptions = options;
      return 2;
    },
  );

  const documentRepository = {
    count,
  } as unknown as Repository<Document>;

  const configService = {
    get: jest.fn((_key: string, defaultValue: string) => defaultValue),
  } as unknown as ConfigService;

  const service = new DocumentsService(
    documentRepository,
    {} as Repository<AbsenceDeclaration>,
    {} as Repository<LeaveRequest>,
    {} as AbsenceDeclarationsService,
    {} as DataSource,
    configService,
  );

  return {
    count,
    getLastCountOptions: () => lastCountOptions,
    service: service as unknown as CountableDocumentsService,
  };
}

function readWhere(
  options: RepositoryCountOptions | undefined,
): Record<string, unknown> {
  expect(options).toBeDefined();
  expect(options?.where).toBeDefined();
  expect(Array.isArray(options?.where)).toBe(false);

  return options?.where as unknown as Record<string, unknown>;
}

describe('DocumentsService - comptage des justificatifs actifs', () => {
  it('construit une condition explicite pour une déclaration d’absence', async () => {
    const { getLastCountOptions, service } = createService();

    await expect(
      service.countActiveForParent({
        leaveRequestId: null,
        absenceDeclarationId: 42,
      }),
    ).resolves.toBe(2);

    const where = readWhere(getLastCountOptions());

    expect(where.absenceDeclarationId).toBe(42);
    expect(where.leaveRequestId).toBeDefined();
    expect(where.leaveRequestId).not.toBeNull();
    expect(Object.values(where)).not.toContain(undefined);
  });

  it('construit une condition explicite pour une demande de congé', async () => {
    const { getLastCountOptions, service } = createService();

    await expect(
      service.countActiveForParent({
        leaveRequestId: 17,
        absenceDeclarationId: null,
      }),
    ).resolves.toBe(2);

    const where = readWhere(getLastCountOptions());

    expect(where.leaveRequestId).toBe(17);
    expect(where.absenceDeclarationId).toBeDefined();
    expect(where.absenceDeclarationId).not.toBeNull();
    expect(Object.values(where)).not.toContain(undefined);
  });

  it('refuse un justificatif sans parent', async () => {
    const { count, service } = createService();

    await expect(
      service.countActiveForParent({
        leaveRequestId: null,
        absenceDeclarationId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(count).not.toHaveBeenCalled();
  });

  it('refuse un justificatif rattaché aux deux parents', async () => {
    const { count, service } = createService();

    await expect(
      service.countActiveForParent({
        leaveRequestId: 17,
        absenceDeclarationId: 42,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(count).not.toHaveBeenCalled();
  });
});
