import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Document } from '../documents/document.entity';
import {
  DayPeriod,
  LeaveRequest,
} from '../leave-requests/leave-request.entity';
import {
  LeaveType,
  LeaveTypeCategory,
} from '../leave-types/leave-type.entity';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import { PresenceService } from '../presence/presence.service';
import { UsersService } from '../users/users.service';
import {
  AbsenceDeclaration,
} from './absence-declaration.entity';
import { AbsenceDeclarationsService } from './absence-declarations.service';

const MIXED_MODE_MESSAGE =
  'Une absence doit être saisie soit en jours/demi-journées, soit en heures, mais pas dans les deux modes simultanément.';

const leaveType = {
  id: 7,
  isActive: true,
  category: LeaveTypeCategory.DECLARATION_ABSENCE,
  rhOnly: false,
  employeeCanCreate: true,
  allowsDays: true,
  allowsHalfDays: true,
  allowsHours: true,
} as unknown as LeaveType;

const rhUser = { id: 2, role: 'RH' } as never;
const collaboratorUser = { id: 1, role: 'COLLABORATEUR' } as never;

describe('AbsenceDeclarationsService — un seul mode (jours / heures)', () => {
  let service: AbsenceDeclarationsService;
  let absenceRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersService: { findOne: jest.Mock };
  let leaveTypesService: { findOne: jest.Mock };
  let serviceAny: {
    resolveEmployee: jest.Mock;
    ensureNoPersonalOverlap: jest.Mock;
    validateLeaveType: jest.Mock;
    findAccessibleOne: jest.Mock;
    ensureDraft: jest.Mock;
  };

  beforeEach(async () => {
    absenceRepository = { create: jest.fn(), save: jest.fn() };
    usersService = { findOne: jest.fn() };
    leaveTypesService = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbsenceDeclarationsService,
        {
          provide: getRepositoryToken(AbsenceDeclaration),
          useValue: absenceRepository,
        },
        {
          provide: getRepositoryToken(Document),
          useValue: {},
        },
        {
          provide: getRepositoryToken(LeaveRequest),
          useValue: {},
        },
        { provide: UsersService, useValue: usersService },
        { provide: LeaveTypesService, useValue: leaveTypesService },
        { provide: PresenceService, useValue: {} },
      ],
    }).compile();

    service = module.get(AbsenceDeclarationsService);

    // Dépendances privées : contours minimaux, le comportement testé est
    // uniquement le contrôle de mode unique (ensureSingleMode) et le calcul.
    serviceAny = service as unknown as {
      resolveEmployee: jest.Mock;
      ensureNoPersonalOverlap: jest.Mock;
      validateLeaveType: jest.Mock;
      findAccessibleOne: jest.Mock;
      ensureDraft: jest.Mock;
    };
    serviceAny.resolveEmployee = jest.fn().mockResolvedValue({
      id: 5,
      serviceId: 1,
      service: { isActive: true },
    });
    serviceAny.ensureNoPersonalOverlap = jest.fn().mockResolvedValue(undefined);
    serviceAny.validateLeaveType = jest.fn().mockImplementation(() => undefined);
    serviceAny.findAccessibleOne = jest
      .fn()
      .mockImplementation((id: number) =>
        Promise.resolve(absenceRepository.save.mock.results[0]?.value ?? { id }),
      );
    serviceAny.ensureDraft = jest.fn().mockImplementation(() => undefined);

    usersService.findOne.mockResolvedValue({ id: 1 });
    leaveTypesService.findOne.mockResolvedValue(leaveType);
    absenceRepository.create.mockImplementation((input) => input);
    absenceRepository.save.mockImplementation(async (input) => ({
      ...input,
      id: 42,
    }));
  });

  afterEach(() => jest.clearAllMocks());

  describe('création — refus du mélange durationHours + périodes', () => {
    it('durationHours + startPeriod → HTTP 400 (BadRequestException)', async () => {
      await expect(
        service.createDraft(rhUser as never, {
          leaveTypeId: 7,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
          startPeriod: DayPeriod.MATIN,
          durationHours: 3,
        } as never),
      ).rejects.toThrow(
        new BadRequestException(MIXED_MODE_MESSAGE),
      );
    });

    it('durationHours + endPeriod → HTTP 400', async () => {
      await expect(
        service.createDraft(rhUser as never, {
          leaveTypeId: 7,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
          endPeriod: DayPeriod.MATIN,
          durationHours: 3,
        } as never),
      ).rejects.toThrow(
        new BadRequestException(MIXED_MODE_MESSAGE),
      );
    });

    it('durationHours seul (mode heures) → accepté, périodes nulles', async () => {
      const saved = await service.createDraft(rhUser as never, {
        leaveTypeId: 7,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        durationHours: 4,
        comment: 'Heures',
      } as never);

      expect(saved.startPeriod).toBeNull();
      expect(saved.endPeriod).toBeNull();
      expect(saved.durationDays).toBeNull();
      expect(saved.durationHours).toBe(4);
    });

    it('périodes seules (demi-journée) → accepté, sans durée en heures', async () => {
      const saved = await service.createDraft(rhUser as never, {
        leaveTypeId: 7,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.MATIN,
      } as never);

      expect(saved.startPeriod).toBe(DayPeriod.MATIN);
      expect(saved.endPeriod).toBe(DayPeriod.MATIN);
      expect(saved.durationHours).toBeNull();
      expect(saved.durationDays).toBe(0.5);
    });
  });

  describe('mise à jour (PATCH) — refus du mélange explicite', () => {
    const storedHalfDay = {
      id: 42,
      createdById: 1,
      leaveType,
      startDate: '2026-01-05',
      endDate: '2026-01-05',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.MATIN,
      durationDays: 0.5,
      durationHours: null,
      status: 'BROUILLON',
    } as never;

    it('PATCH durationHours + startPeriod explicites → HTTP 400', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue(storedHalfDay);

      await expect(
        service.updateDraft(42, collaboratorUser as never, {
          durationHours: 4,
          startPeriod: DayPeriod.MATIN,
        } as never),
      ).rejects.toThrow(
        new BadRequestException(MIXED_MODE_MESSAGE),
      );
    });

    it('DEMI-JOURNÉE → HEURES : PATCH { durationHours } sans période → mode heures (périodes réinitialisées par le calcul)', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue(storedHalfDay);

      const saved = await service.updateDraft(
        42,
        collaboratorUser as never,
        { durationHours: 4 } as never,
      );

      expect(saved.startPeriod).toBeNull();
      expect(saved.endPeriod).toBeNull();
      expect(saved.durationHours).toBe(4);
      expect(saved.durationDays).toBeNull();
    });

    it('HEURES → DEMI-JOURNÉE : PATCH périodes sans heures → reste en heures (contrat partiel, pas de convention de remise à zéro)', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue({
          id: 42,
          createdById: 1,
          leaveType,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
          startPeriod: null,
          endPeriod: null,
          durationDays: null,
          durationHours: 4,
          status: 'BROUILLON',
        } as never);

      const saved = await service.updateDraft(
        42,
        collaboratorUser as never,
        {
          startPeriod: DayPeriod.MATIN,
          endPeriod: DayPeriod.MATIN,
        } as never,
      );

      // Le DTO partiel conserve durationHours (aucun moyen de le retirer) :
      // le mode heures reste prioritaire, les périodes sont ignorées.
      expect(saved.startPeriod).toBeNull();
      expect(saved.endPeriod).toBeNull();
      expect(saved.durationHours).toBe(4);
    });
  });
});
