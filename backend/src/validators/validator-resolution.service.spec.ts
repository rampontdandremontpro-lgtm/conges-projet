import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { LeaveRequest } from '../leave-requests/leave-request.entity';
import { PresenceService } from '../presence/presence.service';
import {
  ServiceType,
  ValidationMode,
} from '../services/service.entity';
import {
  EmploymentType,
  PresenceStatus,
  User,
  UserRole,
} from '../users/user.entity';
import { ServiceBackupValidator } from './service-backup-validator.entity';
import { ValidatorReplacement } from './validator-replacement.entity';
import { ValidatorResolutionService } from './validator-resolution.service';

function martiniqueClock(date: string, time: string): Date {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCHours(hour + 4, minute, 0, 0);
  return utc;
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    nom: 'Nom',
    prenom: 'Prenom',
    email: 'user@example.com',
    role: UserRole.COLLABORATEUR,
    employmentType: EmploymentType.INTERNE,
    serviceId: 1,
    isActive: true,
    presenceStatus: PresenceStatus.PRESENT,
    ...overrides,
  } as User;
}

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: 'Service A',
    serviceType: ServiceType.INTERNE,
    primaryManagerId: 2,
    validationMode: ValidationMode.RESPONSABLE_PUIS_RELAIS,
    takeoverDelayDays: 7,
    isActive: true,
    ...overrides,
  };
}

function employee(overrides: Partial<User> = {}): User {
  return user({
    id: 1,
    role: UserRole.COLLABORATEUR,
    employmentType: EmploymentType.INTERNE,
    serviceId: 10,
    ...overrides,
  });
}

function leaveRequest(
  overrides: Record<string, unknown> = {},
): LeaveRequest {
  return {
    id: 100,
    employeeId: 1,
    employee: employee(),
    serviceId: 10,
    service: makeService(),
    submittedAt: new Date('2026-08-10T12:00:00.000Z'),
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  } as LeaveRequest;
}

function replacement(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    employeeId: 1,
    replacementValidatorId: 3,
    startDate: '2026-08-10',
    endDate: '2026-08-25',
    isActive: true,
    ...overrides,
  };
}

describe('ValidatorResolutionService', () => {
  let service: ValidatorResolutionService;
  let backupRepository: { find: jest.Mock };
  let replacementRepository: { findOne: jest.Mock };
  let userRepository: { findOneBy: jest.Mock; find: jest.Mock };
  let presenceService: { computeStatus: jest.Mock };

  const nowWithinDelay = martiniqueClock('2026-08-12', '09:00');
  const nowAfterDelay = martiniqueClock('2026-08-20', '09:00');
  const nowAfterReplacement = martiniqueClock('2026-08-26', '09:00');

  beforeEach(async () => {
    backupRepository = { find: jest.fn().mockResolvedValue([]) };
    replacementRepository = { findOne: jest.fn().mockResolvedValue(null) };
    userRepository = {
      findOneBy: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    presenceService = {
      computeStatus: jest
        .fn()
        .mockResolvedValue(PresenceStatus.PRESENT),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidatorResolutionService,
        {
          provide: getRepositoryToken(ServiceBackupValidator),
          useValue: backupRepository,
        },
        {
          provide: getRepositoryToken(ValidatorReplacement),
          useValue: replacementRepository,
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: PresenceService, useValue: presenceService },
      ],
    }).compile();

    service = module.get(ValidatorResolutionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('buildResolution — premier niveau', () => {
    it('sans remplacement : premier niveau = Responsable principal', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.firstLevelId).toBe(2);
      expect(resolution.replacement).toBeNull();
      expect(resolution.firstLevelEligible).toBe(true);
      expect(resolution.firstLevelPresent).toBe(true);
      expect(resolution.delayExpired).toBe(false);
    });

    it('Responsable inactif → premier niveau inéligible', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, isActive: false }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.firstLevelEligible).toBe(false);
      expect(resolution.firstLevelPresent).toBe(false);
    });

    it('Responsable dont le rôle n’est plus RESPONSABLE_SERVICE → inéligible (règle E3 conservée)', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.DIRECTEUR, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.firstLevelEligible).toBe(false);
    });

    it('Responsable absent → premier niveau indisponible', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.firstLevelPresent).toBe(false);
      expect(presenceService.computeStatus).toHaveBeenCalledWith(
        2,
        undefined,
        undefined,
        nowWithinDelay,
      );
    });

    it('délai expiré → delayExpired true', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowAfterDelay },
      );

      expect(resolution.delayExpired).toBe(true);
    });

    it('responsable rattaché à un autre service → premier niveau indisponible', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 99 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.firstLevelBelongsToService).toBe(false);
    });
  });

  describe('buildResolution — remplacement temporaire', () => {
    it('remplacement actif pendant la période → premier niveau = remplaçant', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, serviceId: 20 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).not.toBeNull();
      expect(resolution.firstLevelId).toBe(3);
      expect(resolution.firstLevelEligible).toBe(true);
    });

    it('remplacement actif le premier et le dernier jour inclus', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await service.buildResolution(
        leaveRequest(),
        { now: martiniqueClock('2026-08-10', '23:00') },
      );
      expect(replacementRepository.findOne).toHaveBeenCalledTimes(1);

      replacementRepository.findOne.mockClear();
      replacementRepository.findOne.mockResolvedValue(replacement());
      await service.buildResolution(
        leaveRequest(),
        { now: martiniqueClock('2026-08-25', '06:00') },
      );
      expect(replacementRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('remplacement inactif après le 26 → plus aucun remplacement', async () => {
      replacementRepository.findOne.mockResolvedValue(null);
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowAfterReplacement },
      );

      expect(resolution.replacement).toBeNull();
      expect(resolution.firstLevelId).toBe(2);
    });

    it('ligne de remplacement désactivée → ignorée', async () => {
      replacementRepository.findOne.mockResolvedValue(null);
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).toBeNull();
      expect(replacementRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 1,
            isActive: true,
          }),
        }),
      );
    });

    it('remplaçant devenu inéligible (rôle COLLABORATEUR) → remplacement inopérant, retour au circuit normal', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.COLLABORATEUR })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).toBeNull();
      expect(resolution.firstLevelId).toBe(2);
      expect(resolution.firstLevelEligible).toBe(true);
      expect(resolution.firstLevelPresent).toBe(true);
    });

    it('remplaçant devenu inéligible (rôle ADMIN) → remplacement inopérant, retour au circuit normal', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.ADMIN })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).toBeNull();
      expect(resolution.firstLevelId).toBe(2);
      expect(resolution.firstLevelEligible).toBe(true);
    });

    it('remplaçant désactivé → remplacement inopérant, retour au circuit normal', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, isActive: false })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).toBeNull();
      expect(resolution.firstLevelId).toBe(2);
      expect(resolution.firstLevelEligible).toBe(true);
      expect(resolution.firstLevelPresent).toBe(true);
    });

    it('remplaçant actif et éligible mais ABSENT → remplacement conservé (non ignoré)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.replacement).not.toBeNull();
      expect(resolution.firstLevelId).toBe(3);
      expect(resolution.firstLevelEligible).toBe(true);
      expect(resolution.firstLevelPresent).toBe(false);
    });

    it('aucun remplacement pour un salarié RH / Responsable / externe', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());

      await service.buildResolution(
        leaveRequest({
          employee: employee({ role: UserRole.RH }),
        }),
        { now: nowWithinDelay },
      );
      expect(replacementRepository.findOne).not.toHaveBeenCalled();

      replacementRepository.findOne.mockClear();
      await service.buildResolution(
        leaveRequest({
          employee: employee({
            employmentType: EmploymentType.EXTERNE,
          }),
        }),
        { now: nowWithinDelay },
      );
      expect(replacementRepository.findOne).not.toHaveBeenCalled();
    });

    it('aucun remplacement hors circuit RESPONSABLE_PUIS_RELAIS', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());

      await service.buildResolution(
        leaveRequest({
          service: makeService({
            validationMode: ValidationMode.DIRECTEUR_ET_RH,
          }),
        }),
        { now: nowWithinDelay },
      );

      expect(replacementRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('buildResolution — valideurs de secours', () => {
    it('tous les secours actifs et éligibles sont autorisés', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
          serviceId: 10,
          validatorId: 4,
          isActive: true,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
        {
          id: 2,
          serviceId: 10,
          validatorId: 5,
          isActive: true,
          validator: user({ id: 5, role: UserRole.RH }),
        },
        {
          id: 3,
          serviceId: 10,
          validatorId: 6,
          isActive: true,
          validator: user({ id: 6, role: UserRole.DIRECTEUR }),
        },
      ]);

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.backupValidatorIds).toEqual([4, 5, 6]);
    });

    it('secours désactivé ou inéligible exclu', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
          serviceId: 10,
          validatorId: 4,
          isActive: false,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
        {
          id: 2,
          serviceId: 10,
          validatorId: 5,
          isActive: true,
          validator: user({ id: 5, role: UserRole.COLLABORATEUR }),
        },
        {
          id: 3,
          serviceId: 10,
          validatorId: 6,
          isActive: true,
          validator: user({ id: 6, role: UserRole.RESPONSABLE_SERVICE, isActive: false }),
        },
      ]);

      const resolution = await service.buildResolution(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(resolution.backupValidatorIds).toEqual([]);
    });
  });

  describe('getDecisionRecipientIds', () => {
    it('demande RH → Directeurs uniquement', async () => {
      userRepository.find.mockResolvedValue([{ id: 7 }]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest({ employee: employee({ role: UserRole.RH }) }),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([7]);
      expect(userRepository.find).toHaveBeenCalledWith({
        where: { role: UserRole.DIRECTEUR, isActive: true },
        select: { id: true },
      });
    });

    it('sans remplacement, Responsable disponible et délai non expiré → [Responsable]', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([2]);
    });

    it('Responsable absent → secours + RH + Directeur', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);
      userRepository.find.mockResolvedValue([
        { id: 7 },
        { id: 8 },
      ]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(ids.sort((a, b) => a - b)).toEqual([4, 7, 8]);
    });

    it('délai expiré → secours + RH + Directeur', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([]);
      userRepository.find.mockResolvedValue([{ id: 7 }]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowAfterDelay },
      );

      expect(ids).toEqual([7]);
    });

    it('remplacement actif et disponible → [remplaçant]', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([3]);
    });

    it('remplacement actif mais indisponible → secours + RH + Directeur', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);
      userRepository.find.mockResolvedValue([{ id: 7 }]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(ids.sort((a, b) => a - b)).toEqual([4, 7]);
    });

    it('remplaçant désactivé → notification vers le Responsable s’il est présent et délai non expiré', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, isActive: false })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const ids = await service.getDecisionRecipientIds(
        leaveRequest(),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([2]);
    });

    it('mode DIRECTEUR_SEUL → Directeurs', async () => {
      userRepository.find.mockResolvedValue([{ id: 7 }, { id: 9 }]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest({
          service: makeService({
            validationMode: ValidationMode.DIRECTEUR_SEUL,
          }),
        }),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([7, 9]);
    });

    it('autres modes → RH + Directeur', async () => {
      userRepository.find.mockResolvedValue([{ id: 7 }, { id: 8 }]);

      const ids = await service.getDecisionRecipientIds(
        leaveRequest({
          service: makeService({
            validationMode: ValidationMode.DIRECTEUR_ET_RH,
          }),
        }),
        { now: nowWithinDelay },
      );

      expect(ids).toEqual([7, 8]);
    });
  });

  describe('resolveAccess — circuits personnels', () => {
    it('sa propre demande → Forbidden', async () => {
      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 1, role: UserRole.COLLABORATEUR }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('demande RH → Directeur uniquement', async () => {
      const request = leaveRequest({
        employee: employee({ role: UserRole.RH }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_SEUL', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 8, role: UserRole.RH }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('demande Responsable → Directeur ou RH', async () => {
      const request = leaveRequest({
        employee: employee({ role: UserRole.RESPONSABLE_SERVICE }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_RH', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 8, role: UserRole.RH }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_RH', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 2, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('demande externe → Directeur ou RH', async () => {
      const request = leaveRequest({
        service: makeService({ serviceType: ServiceType.EXTERNE }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_RH', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 2, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('mode DIRECTEUR_ET_RH → Directeur ou RH', async () => {
      const request = leaveRequest({
        service: makeService({
          validationMode: ValidationMode.DIRECTEUR_ET_RH,
        }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_RH', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 2, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('mode DIRECTEUR_SEUL → Directeur uniquement', async () => {
      const request = leaveRequest({
        service: makeService({
          validationMode: ValidationMode.DIRECTEUR_SEUL,
        }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).resolves.toEqual({ kind: 'DIRECTEUR_SEUL', reason: null });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 8, role: UserRole.RH }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('mode SANS_VALIDATION → BadRequest', async () => {
      const request = leaveRequest({
        service: makeService({
          validationMode: ValidationMode.SANS_VALIDATION,
        }),
      });
      await expect(
        service.resolveAccess(
          request,
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveAccess — circuit Responsable puis relais sans remplacement', () => {
    it('le Responsable principal reste autorisé même quand le relais est ouvert (règle E3 conservée)', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'RESPONSABLE_PRINCIPAL', reason: null });
    });

    it('secours autorisé quand le Responsable est absent → SECOURS', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        { now: nowWithinDelay },
      );

      expect(access.kind).toBe('SECOURS');
    });

    it('secours refusé quand le Responsable est disponible', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Directeur/RH refusé quand le Responsable est disponible et délai non expiré', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Directeur/RH autorisé en relais quand le Responsable est absent → RELAIS', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        { now: nowWithinDelay },
      );

      expect(access.kind).toBe('RELAIS');
    });

    it('Directeur/RH autorisé en relais quand le délai est expiré → RELAIS', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        { now: nowAfterDelay },
      );

      expect(access.kind).toBe('RELAIS');
    });

    it('urgence avec motif → URGENCE pour Directeur/RH', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        {
          now: nowWithinDelay,
          emergencyTakeover: true,
          takeoverReason: 'Urgence opérationnelle',
        },
      );

      expect(access).toEqual({
        kind: 'URGENCE',
        reason: 'Urgence opérationnelle',
      });
    });

    it('urgence sans motif → BadRequest', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 7, role: UserRole.DIRECTEUR }),
          {
            now: nowWithinDelay,
            emergencyTakeover: true,
            takeoverReason: '   ',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('l’urgence seule n’active pas les secours', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
          {
            now: nowWithinDelay,
            emergencyTakeover: true,
            takeoverReason: 'Motif',
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resolveAccess — remplacement temporaire actif', () => {
    it('le remplaçant est le premier niveau → REMPLACEMENT', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'REMPLACEMENT', reason: null });
    });

    it('RH désignée comme remplaçante → REMPLACEMENT quel que soit son rôle', async () => {
      replacementRepository.findOne.mockResolvedValue(
        replacement({ replacementValidatorId: 8 }),
      );
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 8, role: UserRole.RH }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 8, role: UserRole.RH }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'REMPLACEMENT', reason: null });
    });

    it('Directeur désigné comme remplaçant → REMPLACEMENT quel que soit son rôle', async () => {
      replacementRepository.findOne.mockResolvedValue(
        replacement({ replacementValidatorId: 7 }),
      );
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 7, role: UserRole.DIRECTEUR }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'REMPLACEMENT', reason: null });
    });

    it('remplaçant présent avec délai expiré → conserve son droit de REMPLACEMENT', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
        { now: nowAfterDelay },
      );

      expect(access).toEqual({ kind: 'REMPLACEMENT', reason: null });
    });

    it('délai expiré pendant le remplacement → secours également autorisé (SECOURS)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
          isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        { now: nowAfterDelay },
      );

      expect(access.kind).toBe('SECOURS');
    });

    it('délai expiré pendant le remplacement → Directeur/RH également autorisés (RELAIS)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        { now: nowAfterDelay },
      );

      expect(access.kind).toBe('RELAIS');
    });

    it('le Responsable principal remplacé → Forbidden pour les demandes du collaborateur', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('remplaçant désactivé → le Responsable principal redevient autorisé (RESPONSABLE_PRINCIPAL)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, isActive: false })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'RESPONSABLE_PRINCIPAL', reason: null });
    });

    it('remplaçant au rôle COLLABORATEUR → le Responsable principal redevient autorisé', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.COLLABORATEUR })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'RESPONSABLE_PRINCIPAL', reason: null });
    });

    it('remplaçant au rôle ADMIN → le Responsable principal redevient autorisé', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.ADMIN })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
        { now: nowWithinDelay },
      );

      expect(access).toEqual({ kind: 'RESPONSABLE_PRINCIPAL', reason: null });
    });

    it('remplaçant désactivé → le secours reste refusé quand le Responsable est présent', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, isActive: false })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
          isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('remplaçant actif et éligible mais ABSENT → le Responsable principal reste exclu', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('secours autorisé quand le remplaçant est absent → SECOURS', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        { now: nowWithinDelay },
      );

      expect(access.kind).toBe('SECOURS');
    });

    it('secours refusé quand le remplaçant est disponible', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Directeur/RH autorisé en relais quand le remplaçant est absent', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 7, role: UserRole.DIRECTEUR }),
        { now: nowWithinDelay },
      );

      expect(access.kind).toBe('RELAIS');
    });

    it('Directeur/RH refusé quand le remplaçant est disponible et délai non expiré', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await expect(
        service.resolveAccess(
          leaveRequest(),
          user({ id: 7, role: UserRole.DIRECTEUR }),
          { now: nowWithinDelay },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('après la fin du remplacement, le Responsable principal redevient autorisé', async () => {
      replacementRepository.findOne.mockResolvedValue(null);
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      const access = await service.resolveAccess(
        leaveRequest(),
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
        { now: nowAfterReplacement },
      );

      expect(access).toEqual({ kind: 'RESPONSABLE_PRINCIPAL', reason: null });
    });
  });

  describe('isResponsableAuthorizedForRequest', () => {
    it('Responsable principal → autorisé', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          2,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('Responsable remplacé → non autorisé pour ce collaborateur', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          2,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(false);
    });

    it('remplaçant disponible → autorisé', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          3,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('remplaçant toujours autorisé après expiration du délai (liste d’attente)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          3,
          { now: nowAfterDelay },
        ),
      ).resolves.toBe(true);
    });

    it('remplaçant indisponible → secours autorisé, remplaçant non autorisé', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 3, role: UserRole.RESPONSABLE_SERVICE }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.ABSENT,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          3,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(false);
      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          4,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('remplaçant désactivé → le Responsable principal redevient autorisé (liste d’attente)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.RESPONSABLE_SERVICE, isActive: false })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          2,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('remplaçant au rôle ADMIN → le Responsable principal redevient autorisé (liste d’attente)', async () => {
      replacementRepository.findOne.mockResolvedValue(replacement());
      userRepository.findOneBy.mockImplementation(async ({ id }) =>
        id === 3
          ? user({ id: 3, role: UserRole.ADMIN })
          : user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          2,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('secours autorisé quand le relais est ouvert sans remplacement', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      presenceService.computeStatus.mockResolvedValue(
        PresenceStatus.EN_VACANCES,
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          4,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(true);
    });

    it('secours non autorisé quand le Responsable est disponible', async () => {
      userRepository.findOneBy.mockResolvedValue(
        user({ id: 2, role: UserRole.RESPONSABLE_SERVICE, serviceId: 10 }),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
        isActive: true,
          validatorId: 4,
          validator: user({ id: 4, role: UserRole.RESPONSABLE_SERVICE }),
        },
      ]);

      await expect(
        service.isResponsableAuthorizedForRequest(
          leaveRequest(),
          4,
          { now: nowWithinDelay },
        ),
      ).resolves.toBe(false);
    });
  });
});
