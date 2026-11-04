import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  CarryoverLot,
  CarryoverLotStatus,
} from '../carryover-lot.entity';
import { UserRole } from '../../users/user.entity';
import {
  CarryoverLotsService,
  computeLotExpiry,
  isCarryoverLotsEnvironmentAllowed,
  validateConfirmationChronology,
} from './carryover-lots.service';

describe('isCarryoverLotsEnvironmentAllowed (isolation)', () => {
  it('exige le flag ET la base de recette', () => {
    expect(isCarryoverLotsEnvironmentAllowed('true', 'gestion_conges_gmes_test')).toBe(true);
    expect(isCarryoverLotsEnvironmentAllowed(undefined, 'gestion_conges_gmes_test')).toBe(false);
    expect(isCarryoverLotsEnvironmentAllowed('false', 'gestion_conges_gmes_test')).toBe(false);
    expect(isCarryoverLotsEnvironmentAllowed('true', 'gestion_conges_gmes')).toBe(false);
    expect(isCarryoverLotsEnvironmentAllowed('true', undefined)).toBe(false);
  });
});

describe('computeLotExpiry (moteur L2 réutilisé)', () => {
  const base = {
    regime: 'GENERAL' as const,
    referencePeriodEnd: null,
    absenceStatus: null,
    repriseDate: '2026-06-20',
    informationDate: '2026-06-25',
    acquiredDuringL3141_5_5or7: null,
    suspensionAtLeastOneYearAtPeriodEnd: null,
  };

  it('information certaine → échéance opposable', () => {
    const r = computeLotExpiry({ ...base, informationDateCertain: true });
    expect(r.expiresAt).toBe('2027-09-25');
    expect(r.indicativeExpiresAt).toBeNull();
    expect(r.status).toBe(CarryoverLotStatus.ACTIF);
  });

  it('information non certaine → indicatif + A_VERIFIER', () => {
    const r = computeLotExpiry({ ...base, informationDateCertain: false });
    expect(r.expiresAt).toBeNull();
    expect(r.indicativeExpiresAt).toBe('2027-09-25');
    expect(r.status).toBe(CarryoverLotStatus.A_VERIFIER);
  });

  it('arrêt long conditions validées + ABSENT → échéance de base opposable', () => {
    const r = computeLotExpiry({
      regime: 'ARRET_LONG',
      referencePeriodEnd: '2026-05-31',
      absenceStatus: 'ABSENT',
      repriseDate: null,
      informationDate: null,
      informationDateCertain: null,
      acquiredDuringL3141_5_5or7: true,
      suspensionAtLeastOneYearAtPeriodEnd: true,
    });
    expect(r.expiresAt).toBe('2027-08-31');
    expect(r.status).toBe(CarryoverLotStatus.ACTIF);
  });
});

describe('validateConfirmationChronology', () => {
  it('refuse une réception future', () => {
    const errors = validateConfirmationChronology(
      { informationDate: '2027-01-01', repriseDate: null },
      '2026-10-27',
    );
    expect(errors.join(' ')).toContain('future');
  });

  it('refuse une reprise future', () => {
    const errors = validateConfirmationChronology(
      { informationDate: null, repriseDate: '2027-01-01' },
      '2026-10-27',
    );
    expect(errors.join(' ')).toContain('reprise future');
  });

  it('refuse une information antérieure à la reprise', () => {
    const errors = validateConfirmationChronology(
      { informationDate: '2026-06-20', repriseDate: '2026-06-25' },
      '2026-10-27',
    );
    expect(errors.join(' ')).toContain('antérieure');
  });

  it('accepte une chronologie passée cohérente', () => {
    expect(
      validateConfirmationChronology(
        { informationDate: '2026-06-25', repriseDate: '2026-06-20' },
        '2026-10-27',
      ),
    ).toHaveLength(0);
  });
});

describe('CarryoverLotsService — protections', () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    const configService = {
      get: () => (overrides.flag === false ? undefined : 'true'),
    };
    const dataSource = {
      options: { database: overrides.database ?? 'gestion_conges_gmes_test' },
      transaction: async (cb: (m: unknown) => Promise<void>) => cb(overrides.manager ?? {}),
    };
    const lotRepository = {
      findOneBy: () => overrides.lot ?? null,
      findOne: () => overrides.lot ?? null,
      find: () => [],
      create: (v: unknown) => v,
      save: () => {
        throw { name: 'OptimisticLockVersionMismatchException' };
      },
    };
    const userRepository = {
      findOne: () => null,
      findOneBy: () => null,
    };
    const documentRepository = { findOneBy: () => null };
    const auditRepository = { find: () => [] };
    const settingsService = { getString: () => Promise.resolve('06-01') };
    const auditService = { record: () => Promise.resolve() };

    const service = new CarryoverLotsService(
      lotRepository as never,
      userRepository as never,
      documentRepository as never,
      auditRepository as never,
      settingsService as never,
      auditService as never,
      configService as never,
      dataSource as never,
    );
    return service;
  }

  const rhActor = {
    id: 2,
    nom: 'RH',
    prenom: 'Recette',
    email: 'rh.recette@gmes.fr',
    role: UserRole.RH,
    serviceId: null,
    mustChangePassword: false,
  };

  it('refuse l’accès sans flag (404) avant toute requête métier', async () => {
    const service = makeService({ flag: false });
    await expect(
      service.create({} as never, rhActor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse l’accès si la base n’est pas la base de recette (404)', async () => {
    const service = makeService({ database: 'gestion_conges_gmes' });
    await expect(
      service.create({} as never, rhActor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse un acteur non-RH (403)', async () => {
    const service = makeService({});
    await expect(
      service.create({} as never, { ...rhActor, role: UserRole.COLLABORATEUR }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('convertit un UPDATE conditionnel sans ligne modifiée en 409', async () => {
    const lot = {
      id: 1,
      version: 0,
      employeeId: 17,
      sourceReferencePeriod: '2025-2026',
      targetReferencePeriod: '2026-2027',
      days: 4,
      remainingDays: null,
      origin: 'AUTRE',
      regime: 'GENERAL',
      status: 'A_VERIFIER',
      absenceStatus: null,
      repriseDate: null,
      informationDate: '2026-06-25',
      informationDateCertain: null,
      acquiredDuringL3141_5_5or7: null,
      suspensionAtLeastOneYearAtPeriodEnd: null,
      proofId: null,
      confirmationStatus: null,
      referencePeriodEndDate: null,
      reason: null,
    } as CarryoverLot;

    const qbChain = {
      set: () => qbChain,
      where: () => qbChain,
      execute: async () => ({ affected: 0 }),
    };

    const service = makeService({
      lot,
      manager: {
        createQueryBuilder: () => ({ update: () => qbChain }),
      },
    });

    await expect(
      service.update(1, { days: 5, reason: 'correction' }, rhActor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
