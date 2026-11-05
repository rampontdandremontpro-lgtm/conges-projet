import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { BirthEventsService } from '../birth-events/birth-events.service';
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
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { UsersService } from '../users/users.service';
import { ArreteChevauchementService } from '../leave-balances/arrete-chevauchement.service';
import { MonthlyAccrualService } from '../leave-balances/monthly-accrual.service';
import { HolidaysService } from '../holidays/holidays.service';
import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
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
  let presenceService: { refreshUserStatus: jest.Mock };
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
    presenceService = { refreshUserStatus: jest.fn() };

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
        { provide: BirthEventsService, useValue: { assertOwnedBy: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } },
        { provide: LeaveTypesService, useValue: leaveTypesService },
        { provide: NotificationsService, useValue: { create: jest.fn(), createForActiveRoles: jest.fn(), createForServiceManagers: jest.fn() } },
        { provide: PresenceService, useValue: presenceService },
        { provide: ArreteChevauchementService, useValue: { shouldRelaxLeaveOverlap: jest.fn().mockResolvedValue(false), restoreForAbsence: jest.fn(), reverseForAbsence: jest.fn() } },
        { provide: MonthlyAccrualService, useValue: { regularizeAbsenceImpact: jest.fn().mockResolvedValue({ regularizedMonths: [], corrections: [] }) } },
        { provide: HolidaysService, useValue: { findNonDeductibleBetween: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: { transaction: (cb: (m: unknown) => unknown) => cb({ getRepository: () => ({ save: jest.fn(async (row: unknown) => row) }) }), getRepository: () => ({ findOne: jest.fn() }) } },
      ],
    }).compile();

    service = module.get(AbsenceDeclarationsService);

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
      status: AbsenceDeclarationStatus.BROUILLON,
    } as never;

    it('PATCH durationHours + startPeriod explicites → HTTP 400', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue(storedHalfDay);

      await expect(
        service.updateDraft(42, rhUser as never, {
          durationHours: 4,
          startPeriod: DayPeriod.MATIN,
        } as never),
      ).rejects.toThrow(
        new BadRequestException(MIXED_MODE_MESSAGE),
      );
    });

    it('DEMI-JOURNÉE → HEURES : PATCH { durationHours } sans période → mode heures (périodes réinitialisées)', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue(storedHalfDay);

      const saved = await service.updateDraft(
        42,
        rhUser as never,
        { durationHours: 4 } as never,
      );

      expect(saved.startPeriod).toBeNull();
      expect(saved.endPeriod).toBeNull();
      expect(saved.durationHours).toBe(4);
      expect(saved.durationDays).toBeNull();
    });

    it('HEURES → JOURS : PATCH périodes seules → refus (400) sans mutation du mode', async () => {
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
        status: AbsenceDeclarationStatus.BROUILLON,
      } as never);

      await expect(
        service.updateDraft(42, rhUser as never, {
          startPeriod: DayPeriod.MATIN,
          endPeriod: DayPeriod.APRES_MIDI,
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('JOURS → DEMI-JOURNÉE : PATCH périodes identiques → demi-journée', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue({
        id: 42,
        createdById: 1,
        leaveType,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.APRES_MIDI,
        durationDays: 1,
        durationHours: null,
        status: AbsenceDeclarationStatus.BROUILLON,
      } as never);

      const saved = await service.updateDraft(
        42,
        rhUser as never,
        {
          startPeriod: DayPeriod.MATIN,
          endPeriod: DayPeriod.MATIN,
        } as never,
      );

      expect(saved.startPeriod).toBe(DayPeriod.MATIN);
      expect(saved.endPeriod).toBe(DayPeriod.MATIN);
      expect(saved.durationHours).toBeNull();
      expect(saved.durationDays).toBe(0.5);
    });
  });

  describe('mise à jour (PATCH) — commentaire supprimable', () => {
    it('un commentaire vide remplace bien le commentaire existant', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue({
        id: 42,
        createdById: 1,
        leaveType,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.APRES_MIDI,
        durationDays: 1,
        durationHours: null,
        status: AbsenceDeclarationStatus.BROUILLON,
        comment: 'Rendez-vous médical',
      } as never);

      const saved = await service.updateDraft(
        42,
        rhUser as never,
        { comment: '' } as never,
      );

      expect(saved.comment).toBeNull();
    });
  });

  describe('mise à jour (PATCH) — statuts RH modifiables', () => {
    it.each([
      AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
      AbsenceDeclarationStatus.A_VERIFIER_PAR_RH,
      AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
      AbsenceDeclarationStatus.ENREGISTREE,
    ])('%s → la RH peut modifier une absence déjà transmise', async (status) => {
      serviceAny.findAccessibleOne.mockResolvedValue({
        id: 42,
        createdById: 1,
        employeeId: 5,
        leaveType,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.APRES_MIDI,
        durationDays: 1,
        durationHours: null,
        status,
      } as never);

      const saved = await service.updateDraft(
        42,
        rhUser as never,
        {
          startDate: '2026-02-10',
          endDate: '2026-02-10',
          startPeriod: DayPeriod.MATIN,
          endPeriod: DayPeriod.MATIN,
        } as never,
      );

      expect(saved.startDate).toBe('2026-02-10');
      expect(saved.endDate).toBe('2026-02-10');
      expect(saved.durationHours).toBeNull();
      expect(saved.durationDays).toBe(0.5);

      if (status === AbsenceDeclarationStatus.ENREGISTREE) {
        expect(presenceService.refreshUserStatus).toHaveBeenCalledWith(5);
      } else {
        expect(presenceService.refreshUserStatus).not.toHaveBeenCalled();
      }
    });
  });

  describe('autorisation — création/soumission des déclarations', () => {
    it('collaborateur ne peut plus créer de brouillon (déclaration réservée à la RH)', async () => {
      await expect(
        service.createDraft(collaboratorUser as never, {
          leaveTypeId: 7,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
          startPeriod: DayPeriod.MATIN,
          endPeriod: DayPeriod.MATIN,
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('collaborateur ne peut pas créer une déclaration pour un autre salarié', async () => {
      serviceAny.resolveEmployee.mockRejectedValueOnce(
        new ForbiddenException(
          'Seule la RH peut créer une déclaration pour un autre collaborateur.',
        ),
      );
      await expect(
        service.createDraft(collaboratorUser as never, {
          employeeId: 9,
          leaveTypeId: 7,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('collaborateur ne peut pas utiliser un type réservé à la RH', async () => {
      serviceAny.validateLeaveType.mockImplementationOnce(() => {
        throw new ForbiddenException(
          'Ce type d’absence ne peut pas être déclaré par un collaborateur.',
        );
      });
      await expect(
        service.createDraft(collaboratorUser as never, {
          leaveTypeId: 7,
          startDate: '2026-01-05',
          endDate: '2026-01-05',
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('RH crée un brouillon pour un autre salarié', async () => {
      const saved = await service.createDraft(rhUser as never, {
        employeeId: 5,
        leaveTypeId: 7,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        startPeriod: DayPeriod.MATIN,
        endPeriod: DayPeriod.MATIN,
      } as never);
      expect(saved.startPeriod).toBe(DayPeriod.MATIN);
    });

    it('collaborateur ne peut plus soumettre un brouillon (déclaration réservée à la RH)', async () => {
      await expect(
        service.submit(42, collaboratorUser as never, {
          certifiedAccurate: true,
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('collaborateur ne soumet pas le brouillon d’un autre salarié', async () => {
      serviceAny.findAccessibleOne.mockResolvedValue({
        id: 42,
        createdById: 2,
        employeeId: 1,
        status: AbsenceDeclarationStatus.BROUILLON,
      } as never);
      serviceAny.ensureDraft.mockImplementation(() => undefined);

      await expect(
        service.submit(42, collaboratorUser as never, {
          certifiedAccurate: true,
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('l’annulation reste réservée à la RH', async () => {
      await expect(
        service.cancel(42, collaboratorUser as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
