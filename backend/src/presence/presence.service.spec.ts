import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { PresenceStatus, User } from '../users/user.entity';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;
  let leaveRepository: { count: jest.Mock };
  let absenceRepository: { count: jest.Mock };
  let userRepository: { find: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  beforeEach(async () => {
    leaveRepository = { count: jest.fn() };
    absenceRepository = { count: jest.fn() };
    userRepository = { find: jest.fn(), update: jest.fn() };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: getRepositoryToken(LeaveRequest), useValue: leaveRepository },
        { provide: getRepositoryToken(AbsenceDeclaration), useValue: absenceRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(PresenceService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('computeStatus', () => {
    it('PRESENT lorsqu’aucun congé validé ni absence enregistrée ne couvre la date', async () => {
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(0);

      await expect(service.computeStatus(1, '2025-06-15')).resolves.toBe(
        PresenceStatus.PRESENT,
      );

      expect(absenceRepository.count).toHaveBeenCalledWith({
        where: {
          employeeId: 1,
          startDate: expect.anything(),
          endDate: expect.anything(),
          status: AbsenceDeclarationStatus.ENREGISTREE,
        },
      });
    });

    it('ABSENT lorsqu’une déclaration d’absence ENREGISTREE couvre la date', async () => {
      absenceRepository.count.mockResolvedValueOnce(1);

      await expect(service.computeStatus(1, '2025-06-15')).resolves.toBe(
        PresenceStatus.ABSENT,
      );

      // Les congés ne sont même pas consultés : l'absence prime.
      expect(leaveRepository.count).not.toHaveBeenCalled();
    });

    it('EN_VACANCES lorsqu’un congé VALIDEE couvre la date', async () => {
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(1);

      await expect(service.computeStatus(1, '2025-06-15')).resolves.toBe(
        PresenceStatus.EN_VACANCES,
      );
    });

    it('EN_VACANCES pour un congé en cours d’annulation après validation', async () => {
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(1);

      await expect(service.computeStatus(1, '2025-06-15')).resolves.toBe(
        PresenceStatus.EN_VACANCES,
      );

      const leaveWhere = leaveRepository.count.mock.calls[0][0].where;
      expect(leaveWhere.status._value).toEqual(
        expect.arrayContaining([
          LeaveRequestStatus.VALIDEE,
          LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
        ]),
      );
    });

    it('PRESENT lorsque seuls des congés REFUSEE/ANNULEE/EXPIREE existent (statuts exclus)', async () => {
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(0);

      await expect(service.computeStatus(1, '2025-06-15')).resolves.toBe(
        PresenceStatus.PRESENT,
      );

      const leaveWhere = leaveRepository.count.mock.calls[0][0].where;
      expect(leaveWhere.status._value).not.toEqual(
        expect.arrayContaining([
          LeaveRequestStatus.REFUSEE,
          LeaveRequestStatus.ANNULEE,
          LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
          LeaveRequestStatus.EXPIREE_NON_VALIDEE,
        ]),
      );
    });

    it('calcule par défaut sur la date du jour dans le fuseau America/Martinique', async () => {
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(0);

      await service.computeStatus(1);

      const absenceWhere = absenceRepository.count.mock.calls[0][0].where;
      expect(absenceWhere.startDate._value).toEqual(today);
      expect(absenceWhere.endDate._value).toEqual(today);
    });

    it('utilise les repositories du manager lorsqu’il est fourni (cohérence transactionnelle)', async () => {
      const managerAbsenceCount = jest.fn().mockResolvedValueOnce(0);
      const managerLeaveCount = jest.fn().mockResolvedValueOnce(0);
      const manager = {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === AbsenceDeclaration) {
            return { count: managerAbsenceCount };
          }
          if (entity === LeaveRequest) {
            return { count: managerLeaveCount };
          }
          return {};
        }),
      } as unknown as EntityManager;

      await expect(
        service.computeStatus(1, '2025-06-15', manager),
      ).resolves.toBe(PresenceStatus.PRESENT);

      expect(managerAbsenceCount).toHaveBeenCalledTimes(1);
      expect(managerLeaveCount).toHaveBeenCalledTimes(1);
      expect(absenceRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('refreshUserStatus', () => {
    it('recalcule le statut puis met à jour le champ stocké', async () => {
      absenceRepository.count.mockResolvedValueOnce(1);
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

      // Utilisateur 1 : congé validé → EN_VACANCES (changement).
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(1);

      // Utilisateur 2 : rien → PRESENT (changement).
      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(0);

      await expect(service.refreshAllStatuses()).resolves.toEqual({
        updated: 2,
      });

      expect(userRepository.update).toHaveBeenCalledTimes(2);
      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        { presenceStatus: PresenceStatus.EN_VACANCES },
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

      absenceRepository.count.mockResolvedValueOnce(0);
      leaveRepository.count.mockResolvedValueOnce(0);

      await expect(service.refreshAllStatuses()).resolves.toEqual({
        updated: 0,
      });

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });
});
