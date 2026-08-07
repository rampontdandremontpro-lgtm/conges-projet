import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { LeaveBalancesService } from '../leave-balances/leave-balances.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { SettingsService } from '../settings/settings.service';
import { LeaveRequest } from './leave-request.entity';
import { LeaveRequestSchedulerService } from './leave-request-scheduler.service';

/**
 * Instants absolus dont l'horloge America/Martinique affiche `time`
 * (UTC−4 sans heure d'été). Ne dépend pas de l'heure réelle d'exécution.
 */
function martiniqueTime(time: string, date = '2026-08-07'): Date {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCHours(hour + 4, minute, 0, 0);
  return utc;
}

describe('LeaveRequestSchedulerService — maintenance à la bascule de période', () => {
  let service: LeaveRequestSchedulerService;
  let dataSource: { getRepository: jest.Mock };
  let leaveRepository: { find: jest.Mock };
  let notificationsService: {
    reevaluateRecipientsForRequest: jest.Mock;
  };
  let presenceService: { refreshAllStatuses: jest.Mock };
  let settingsService: { getString: jest.Mock };

  beforeEach(async () => {
    leaveRepository = { find: jest.fn() };
    dataSource = {
      getRepository: jest.fn().mockReturnValue(leaveRepository),
    };
    notificationsService = {
      reevaluateRecipientsForRequest: jest.fn(),
    };
    presenceService = { refreshAllStatuses: jest.fn() };
    settingsService = {
      getString: jest.fn().mockResolvedValue('12:00'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveRequestSchedulerService,
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: {} },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: LeaveBalancesService, useValue: {} },
        { provide: PresenceService, useValue: presenceService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(LeaveRequestSchedulerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('runSwitchMaintenance', () => {
    it('réévalue les destinataires et recalcule les statuts de présence', async () => {
      leaveRepository.find.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      notificationsService.reevaluateRecipientsForRequest
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      presenceService.refreshAllStatuses.mockResolvedValue({
        updated: 3,
      });

      const result = await service.runSwitchMaintenance();

      expect(result.notificationsReevaluated).toBe(1);
      expect(result.presenceStatusesRefreshed).toBe(3);
      expect(result.expiredRequests).toBe(0);
      expect(result.remindersCreated).toBe(0);
      expect(result.errors).toEqual([]);
      // La maintenance de bascule n'expire pas et ne rappelle pas :
      // elle ne fait que rafraîchir le présent et réévaluer les
      // destinataires (anti-doublon préservé par le service de
      // notifications).
      expect(notificationsService.reevaluateRecipientsForRequest).toHaveBeenCalledTimes(2);
    });

    it('remonte les erreurs de réévaluation par demande', async () => {
      leaveRepository.find.mockResolvedValue([{ id: 11 }]);
      notificationsService.reevaluateRecipientsForRequest.mockRejectedValue(
        new Error('échec simulé'),
      );
      presenceService.refreshAllStatuses.mockResolvedValue({
        updated: 0,
      });

      const result = await service.runSwitchMaintenance();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Demande 11');
      expect(result.notificationsReevaluated).toBe(0);
    });
  });

  describe('scheduleNextSwitchMaintenance — planification déterministe', () => {
    it('11:37 Martinique → maintenance programmée à 12:00, puis reprogrammée à 00:00', async () => {
      jest.useFakeTimers();
      // 15:37 UTC = 11:37 America/Martinique (UTC−4).
      jest.setSystemTime(new Date('2026-08-07T15:37:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');

      const runSpy = jest
        .spyOn(service, 'runSwitchMaintenance')
        .mockResolvedValue({
          runAt: '',
          remindersCreated: 0,
          expiredRequests: 0,
          notificationsReevaluated: 0,
          presenceStatusesRefreshed: 0,
          errors: [],
        });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      // 12:00 Martinique = 16:00 UTC ; 16:00 − 15:37 = 23 min.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(23 * 60 * 1000);

      // À la bascule : exécution de la maintenance de bascule.
      await jest.advanceTimersByTimeAsync(23 * 60 * 1000);
      expect(runSpy).toHaveBeenCalledTimes(1);

      // Puis reprogrammation : slot APRES_MIDI → prochaine bascule le
      // lendemain à 00:00 Martinique (04:00 UTC) = 12 h plus tard.
      await jest.advanceTimersByTimeAsync(0);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy.mock.calls[1][1]).toBe(12 * 60 * 60 * 1000);
    });

    it('12:01 Martinique → prochaine bascule directement le lendemain à 00:00', async () => {
      jest.useFakeTimers();
      // 16:01 UTC = 12:01 America/Martinique.
      jest.setSystemTime(new Date('2026-08-07T16:01:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      // 00:00 Martinique le 08/08 = 04:00 UTC : 16:01 → 04:00 = 11 h 59.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(
        11 * 60 * 60 * 1000 + 59 * 60 * 1000,
      );
    });

    it('utilise la valeur configurée de AFTERNOON_START_HOUR (08:30)', async () => {
      jest.useFakeTimers();
      // 07:00 Martinique.
      jest.setSystemTime(new Date('2026-08-07T11:00:00.000Z'));
      settingsService.getString.mockResolvedValue('08:30');

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      // 08:30 Martinique = 12:30 UTC ; 12:30 − 11:00 = 1 h 30.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(90 * 60 * 1000);
      expect(settingsService.getString).toHaveBeenCalledWith(
        'AFTERNOON_START_HOUR',
        '12:00',
      );
    });
  });
});
