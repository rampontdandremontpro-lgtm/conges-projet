import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { SettingsService } from '../settings/settings.service';
import { PresenceStatus, User } from '../users/user.entity';
import { PresenceService } from './presence.service';

function martiniqueClock(date: string, time: string): Date {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCHours(hour + 4, minute, 0, 0);
  return utc;
}

const absenceMatinOnly = {
  startDate: '2025-06-15',
  endDate: '2025-06-15',
  startPeriod: DayPeriod.MATIN,
  endPeriod: DayPeriod.MATIN,
};

const absenceApresMidiOnly = {
  startDate: '2025-06-15',
  endDate: '2025-06-15',
  startPeriod: DayPeriod.APRES_MIDI,
  endPeriod: DayPeriod.APRES_MIDI,
};

const leaveFullDay = {
  startDate: '2025-06-15',
  endDate: '2025-06-15',
  startPeriod: DayPeriod.MATIN,
  endPeriod: DayPeriod.APRES_MIDI,
};

describe('PresenceService', () => {
  let service: PresenceService;
  let leaveRepository: { find: jest.Mock };
  let absenceRepository: { find: jest.Mock };
  let userRepository: { find: jest.Mock; update: jest.Mock };
  let settingsService: { getString: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const absenceFullDay = {
    startDate: today,
    endDate: today,
    startPeriod: DayPeriod.MATIN,
    endPeriod: DayPeriod.APRES_MIDI,
  };

  beforeEach(async () => {
    leaveRepository = { find: jest.fn() };
    absenceRepository = { find: jest.fn() };
    userRepository = { find: jest.fn(), update: jest.fn() };
    settingsService = {
      getString: jest.fn().mockResolvedValue('12:00'),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        {
          provide: getRepositoryToken(LeaveRequest),
          useValue: leaveRepository,
        },
        {
          provide: getRepositoryToken(AbsenceDeclaration),
          useValue: absenceRepository,
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: SettingsService, useValue: settingsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(PresenceService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getCurrentSlot', () => {
    it('avant 12:00 → MATIN (11:59)', async () => {
      await expect(
        service.getCurrentSlot(martiniqueClock('2025-06-15', '11:59')),
      ).resolves.toBe(DayPeriod.MATIN);
    });

    it('à 12:00 inclus → APRES_MIDI', async () => {
      await expect(
        service.getCurrentSlot(martiniqueClock('2025-06-15', '12:00')),
      ).resolves.toBe(DayPeriod.APRES_MIDI);
    });

    it('après 12:00 → APRES_MIDI (12:01)', async () => {
      await expect(
        service.getCurrentSlot(martiniqueClock('2025-06-15', '12:01')),
      ).resolves.toBe(DayPeriod.APRES_MIDI);
    });

    it('utilise la valeur configurée AFTERNOON_START_HOUR', async () => {
      settingsService.getString.mockResolvedValue('08:30');

      await expect(
        service.getCurrentSlot(martiniqueClock('2025-06-15', '08:29')),
      ).resolves.toBe(DayPeriod.MATIN);
      await expect(
        service.getCurrentSlot(martiniqueClock('2025-06-15', '08:30')),
      ).resolves.toBe(DayPeriod.APRES_MIDI);

      expect(settingsService.getString).toHaveBeenCalledWith(
        'AFTERNOON_START_HOUR',
        '12:00',
      );
    });
  });

  describe('computeStatusForPeriod', () => {
    it('PRESENT lorsqu’aucun congé ni absence ne couvre le slot', async () => {
      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.MATIN,
        ),
      ).resolves.toBe(PresenceStatus.PRESENT);
    });

    it('ABSENT pour le slot MATIN couvert par une absence MATIN seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceMatinOnly]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.MATIN,
        ),
      ).resolves.toBe(PresenceStatus.ABSENT);

      expect(leaveRepository.find).not.toHaveBeenCalled();
    });

    it('PRESENT pour le slot APRES_MIDI non couvert par une absence MATIN seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceMatinOnly]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.APRES_MIDI,
        ),
      ).resolves.toBe(PresenceStatus.PRESENT);
    });

    it('ABSENT pour le slot APRES_MIDI couvert par une absence APRES_MIDI seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceApresMidiOnly]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.APRES_MIDI,
        ),
      ).resolves.toBe(PresenceStatus.ABSENT);
    });

    it('EN_VACANCES pour un congé validé couvrant le slot', async () => {
      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([leaveFullDay]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.APRES_MIDI,
        ),
      ).resolves.toBe(PresenceStatus.EN_VACANCES);
    });

    it('ABSENT prioritaire sur EN_VACANCES pour le même slot', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceMatinOnly]);

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.MATIN,
        ),
      ).resolves.toBe(PresenceStatus.ABSENT);
    });

    it('ne filtre que les absences ENREGISTREE et les congés VALIDEE / ANNULATION_EN_ATTENTE_ACCORD', async () => {
      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await service.computeStatusForPeriod(
        1,
        '2025-06-15',
        DayPeriod.MATIN,
      );

      const absenceWhere =
        absenceRepository.find.mock.calls[0][0].where;
      expect(absenceWhere.status).toBe(
        AbsenceDeclarationStatus.ENREGISTREE,
      );

      const leaveWhere = leaveRepository.find.mock.calls[0][0].where;
      expect(leaveWhere.status._value).toEqual(
        expect.arrayContaining([
          LeaveRequestStatus.VALIDEE,
          LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
        ]),
      );
      expect(leaveWhere.status._value).not.toEqual(
        expect.arrayContaining([
          LeaveRequestStatus.REFUSEE,
          LeaveRequestStatus.ANNULEE,
          LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
          LeaveRequestStatus.EXPIREE_NON_VALIDEE,
        ]),
      );
    });

    it('utilise les repositories du manager lorsqu’il est fourni (cohérence transactionnelle)', async () => {
      const managerAbsenceFind = jest.fn().mockResolvedValueOnce([]);
      const managerLeaveFind = jest.fn().mockResolvedValueOnce([]);
      const manager = {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === AbsenceDeclaration) {
            return { find: managerAbsenceFind };
          }
          if (entity === LeaveRequest) {
            return { find: managerLeaveFind };
          }
          return {};
        }),
      } as unknown as EntityManager;

      await expect(
        service.computeStatusForPeriod(
          1,
          '2025-06-15',
          DayPeriod.MATIN,
          manager,
        ),
      ).resolves.toBe(PresenceStatus.PRESENT);

      expect(managerAbsenceFind).toHaveBeenCalledTimes(1);
      expect(managerLeaveFind).toHaveBeenCalledTimes(1);
      expect(absenceRepository.find).not.toHaveBeenCalled();
      expect(leaveRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('computeDailyAvailability', () => {
    it('détaille les deux slots avec statut et disponibilité', async () => {
      absenceRepository.find
        .mockResolvedValueOnce([absenceMatinOnly])
        .mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.computeDailyAvailability(1, '2025-06-15'),
      ).resolves.toEqual({
        date: '2025-06-15',
        morning: {
          status: PresenceStatus.ABSENT,
          available: false,
        },
        afternoon: {
          status: PresenceStatus.PRESENT,
          available: true,
        },
      });
    });

    it('calcule par défaut sur la date du jour America/Martinique', async () => {
      absenceRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.computeDailyAvailability(1);

      expect(result.date).toEqual(today);
    });
  });

  describe('computeStatus (slot courant)', () => {
    it('PRESENT lorsqu’aucun congé ni absence ne couvre le slot courant', async () => {
      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.computeStatus(1, '2025-06-15', undefined, martiniqueClock('2025-06-15', '11:59')),
      ).resolves.toBe(PresenceStatus.PRESENT);
    });

    it('ABSENT le matin (11:59) pour une absence MATIN seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceMatinOnly]);

      await expect(
        service.computeStatus(1, '2025-06-15', undefined, martiniqueClock('2025-06-15', '11:59')),
      ).resolves.toBe(PresenceStatus.ABSENT);
    });

    it('PRESENT l’après-midi (12:01) pour la même absence MATIN seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceMatinOnly]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.computeStatus(1, '2025-06-15', undefined, martiniqueClock('2025-06-15', '12:01')),
      ).resolves.toBe(PresenceStatus.PRESENT);
    });

    it('ABSENT à 12:00 inclus pour une absence APRES_MIDI seulement', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceApresMidiOnly]);

      await expect(
        service.computeStatus(1, '2025-06-15', undefined, martiniqueClock('2025-06-15', '12:00')),
      ).resolves.toBe(PresenceStatus.ABSENT);
    });

    it('calcule par défaut sur la date du jour et le slot courant', async () => {
      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await service.computeStatus(1);

      const absenceWhere =
        absenceRepository.find.mock.calls[0][0].where;
      expect(absenceWhere.startDate._value).toEqual(today);
      expect(absenceWhere.endDate._value).toEqual(today);
      expect(settingsService.getString).toHaveBeenCalledWith(
        'AFTERNOON_START_HOUR',
        '12:00',
      );
    });
  });

  describe('refreshUserStatus', () => {
    it('recalcule le statut du slot courant puis met à jour le champ stocké', async () => {
      absenceRepository.find.mockResolvedValueOnce([absenceFullDay]);
      userRepository.update.mockResolvedValueOnce(undefined);

      await expect(service.refreshUserStatus(42)).resolves.toBe(
        PresenceStatus.ABSENT,
      );

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 42 },
        { presenceStatus: PresenceStatus.ABSENT },
      );
    });
  });

  describe('refreshAllStatuses', () => {
    it('ne réécrit que les statuts modifiés et retourne le nombre de mises à jour', async () => {
      userRepository.find.mockResolvedValueOnce([
        { id: 1, presenceStatus: PresenceStatus.PRESENT },
        { id: 2, presenceStatus: PresenceStatus.EN_VACANCES },
      ]);

      absenceRepository.find.mockResolvedValueOnce([absenceFullDay]);

      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(service.refreshAllStatuses()).resolves.toEqual({
        updated: 2,
      });

      expect(userRepository.update).toHaveBeenCalledTimes(2);
      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        { presenceStatus: PresenceStatus.ABSENT },
      );
      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 2 },
        { presenceStatus: PresenceStatus.PRESENT },
      );
    });

    it('ne réécrit rien lorsque les statuts sont inchangés', async () => {
      userRepository.find.mockResolvedValueOnce([
        { id: 1, presenceStatus: PresenceStatus.PRESENT },
      ]);

      absenceRepository.find.mockResolvedValueOnce([]);
      leaveRepository.find.mockResolvedValueOnce([]);

      await expect(service.refreshAllStatuses()).resolves.toEqual({
        updated: 0,
      });

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });
});
