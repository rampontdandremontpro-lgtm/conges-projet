import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { BalanceReminderService } from '../leave-balances/balance-reminder.service';
import { LeaveBalancesService } from '../leave-balances/leave-balances.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { SettingsService } from '../settings/settings.service';
import { LeaveRequest } from './leave-request.entity';
import { LeaveRequestSchedulerService } from './leave-request-scheduler.service';

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
  let settingsService: {
    getString: jest.Mock;
    onAfternoonStartHourChange: jest.Mock;
    removeAfternoonStartHourChangeListener: jest.Mock;
  };
  let balanceReminderService: { runIfDue: jest.Mock };
  let capturedSettingChangeListener: (() => void) | undefined;

  beforeEach(async () => {
    capturedSettingChangeListener = undefined;
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
      onAfternoonStartHourChange: jest.fn((listener: () => void) => {
        capturedSettingChangeListener = listener;
      }),
      removeAfternoonStartHourChangeListener: jest.fn(),
    };
    balanceReminderService = {
      runIfDue: jest.fn().mockResolvedValue({
        runAt: '',
        referencePeriod: null,
        deadline: null,
        afterPeriodEnd: false,
        periodClosed: false,
        eligibleEmployees: [],
        remindersCreated: 0,
        recapRecipients: 0,
        recapNotificationsCreated: 0,
        errors: [],
      }),
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
        { provide: BalanceReminderService, useValue: balanceReminderService },
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
          balanceReminders: null,
          errors: [],
        });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(23 * 60 * 1000);

      await jest.advanceTimersByTimeAsync(23 * 60 * 1000);
      expect(runSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(0);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy.mock.calls[1][1]).toBe(12 * 60 * 60 * 1000);
    });

    it('12:01 Martinique → prochaine bascule directement le lendemain à 00:00', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T16:01:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(
        11 * 60 * 60 * 1000 + 59 * 60 * 1000,
      );
    });

    it('utilise la valeur configurée de AFTERNOON_START_HOUR (08:30)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T11:00:00.000Z'));
      settingsService.getString.mockResolvedValue('08:30');

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      await service.scheduleNextSwitchMaintenance();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(90 * 60 * 1000);
      expect(settingsService.getString).toHaveBeenCalledWith(
        'AFTERNOON_START_HOUR',
        '12:00',
      );
    });
  });

  describe('replanification après modification de AFTERNOON_START_HOUR', () => {
    const bootstrapWithTimer = async () => {
      leaveRepository.find.mockResolvedValue([]);
      presenceService.refreshAllStatuses.mockResolvedValue({ updated: 0 });
      service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
    };

    it('A — 10:30 Martinique : 12:00 → 11:00 annule l’ancien timer et reprogramme à 11:00', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T14:30:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      await bootstrapWithTimer();

      const firstTimer = setTimeoutSpy.mock.results[0].value;
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(90 * 60 * 1000);
      expect(capturedSettingChangeListener).toBeDefined();

      settingsService.getString.mockResolvedValue('11:00');
      capturedSettingChangeListener?.();
      await jest.advanceTimersByTimeAsync(0);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy.mock.calls[1][1]).toBe(30 * 60 * 1000);
      expect(jest.getTimerCount()).toBe(2);
    });

    it('B — 10:30 Martinique : 12:00 → 13:00 reprogramme à 13:00', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T14:30:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      await bootstrapWithTimer();
      const firstTimer = setTimeoutSpy.mock.results[0].value;
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(90 * 60 * 1000);

      settingsService.getString.mockResolvedValue('13:00');
      capturedSettingChangeListener?.();
      await jest.advanceTimersByTimeAsync(0);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy.mock.calls[1][1]).toBe(150 * 60 * 1000);
      expect(jest.getTimerCount()).toBe(2);
    });

    it('D — modifications successives : un seul switchTimer actif', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T14:30:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      await bootstrapWithTimer();
      const firstTimer = setTimeoutSpy.mock.results[0].value;

      settingsService.getString.mockResolvedValue('11:00');
      capturedSettingChangeListener?.();
      await jest.advanceTimersByTimeAsync(0);
      const secondTimer = setTimeoutSpy.mock.results[1].value;

      settingsService.getString.mockResolvedValue('13:00');
      capturedSettingChangeListener?.();
      await jest.advanceTimersByTimeAsync(0);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(secondTimer);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy.mock.calls[2][1]).toBe(150 * 60 * 1000);
      expect(jest.getTimerCount()).toBe(2);
    });

    it('E — onApplicationShutdown désabonne l’écouteur et annule le switchTimer', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-07T14:30:00.000Z'));
      settingsService.getString.mockResolvedValue('12:00');

      await bootstrapWithTimer();
      expect(jest.getTimerCount()).toBe(2);

      service.onApplicationShutdown();

      expect(
        settingsService.removeAfternoonStartHourChangeListener,
      ).toHaveBeenCalledWith(capturedSettingChangeListener);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
