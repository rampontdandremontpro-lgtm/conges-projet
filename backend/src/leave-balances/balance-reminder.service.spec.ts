import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { LeaveBalance } from './leave-balance.entity';
import { User } from '../users/user.entity';
import { BalanceReminderService } from './balance-reminder.service';

const NOON = 'T12:00:00.000Z';

function user(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    nom: `NOM${id}`,
    prenom: `Prénom${id}`,
    role: 'COLLABORATEUR',
    employmentType: 'INTERNE',
    isActive: true,
    service: { name: 'Service Test' },
    ...overrides,
  };
}

function balance(employeeId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: employeeId * 100,
    employeeId,
    referencePeriod: '2026-2027',
    counterType: 'N-1',
    acquiredDays: 10,
    reservedDays: 0,
    consumedDays: 0,
    availableDays: 10,
    employee: user(employeeId),
    ...overrides,
  };
}

describe('BalanceReminderService — E4 rappels de fin de période', () => {
  let service: BalanceReminderService;
  let balanceRepository: { find: jest.Mock };
  let userRepository: { find: jest.Mock };
  let settingsService: { getString: jest.Mock; getValue: jest.Mock };
  let notificationsService: {
    alreadyExists: jest.Mock;
    create: jest.Mock;
  };

  const run = (date: string) =>
    service.runIfDue(new Date(`${date}${NOON}`));

  const createdTypes = () =>
    notificationsService.create.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );

  const createdArgs = (type: string) =>
    notificationsService.create.mock.calls.find(
      (call) => (call[0] as { type: string }).type === type,
    )?.[0];

  beforeEach(async () => {
    balanceRepository = { find: jest.fn() };
    userRepository = { find: jest.fn().mockResolvedValue([]) };
    settingsService = {
      getString: jest.fn().mockResolvedValue('06-01'),
      getValue: jest.fn().mockResolvedValue(null),
    };
    notificationsService = {
      alreadyExists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceReminderService,
        { provide: getRepositoryToken(LeaveBalance), useValue: balanceRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: SettingsService, useValue: settingsService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(BalanceReminderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('F — avant la première échéance', () => {
    it('27/02/2027 (3M due le 28/02) : aucun rappel', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-02-27');
      expect(result.deadline).toBeNull();
      expect(result.remindersCreated).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('G — jour exact de l’échéance', () => {
    it('28/02/2027 : rappel 3M envoyé', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-02-28');
      expect(result.deadline?.key).toBe('3M');
      expect(result.deadline?.date).toBe('2027-02-28');
      expect(result.remindersCreated).toBe(1);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          channel: 'LES_DEUX',
          type: 'BALANCE_REMINDER_3M_2026-2027',
        }),
      );
      expect(
        notificationsService.create.mock.calls[0][0].emailSentAt,
      ).toBeUndefined();
    });
  });

  describe('H — lendemain avec rappel déjà envoyé', () => {
    it('01/03/2027 : pas de doublon', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      notificationsService.alreadyExists.mockResolvedValue(true);
      const result = await run('2027-03-01');
      expect(result.deadline?.key).toBe('3M');
      expect(result.remindersCreated).toBe(0);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('I — lendemain avec rappel NON envoyé (rattrapage)', () => {
    it('01/03/2027 : le dernier palier dû (3M) est envoyé', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-03-01');
      expect(result.deadline?.key).toBe('3M');
      expect(result.remindersCreated).toBe(1);
      expect(createdTypes()).toContain('BALANCE_REMINDER_3M_2026-2027');
    });
  });

  describe('J — plusieurs paliers manqués', () => {
    it('10/05/2027 : seul le 1M (30/04) est envoyé, pas les anciens', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-05-10');
      expect(result.deadline?.key).toBe('1M');
      expect(result.remindersCreated).toBe(1);
      const types = createdTypes();
      expect(types).toContain('BALANCE_REMINDER_1M_2026-2027');
      expect(types).not.toContain('BALANCE_REMINDER_3M_2026-2027');
      expect(types).not.toContain('BALANCE_REMINDER_2M_2026-2027');
      expect(types).not.toContain('BALANCE_REMINDER_15D_2026-2027');
    });
  });

  describe('K — available=8 reserved=3 → potential=5', () => {
    it('message principal avec réservation — la date affichée est la fin de période (31/05), pas le déclenchement (28/02)', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 8, reservedDays: 3 }),
      ]);
      await run('2027-02-28');
      const args = createdArgs('BALANCE_REMINDER_3M_2026-2027');
      expect(args.message).toBe(
        'Il vous reste 5 jours encore utilisables sur un solde de 8 jours, dont 3 jours déjà réservés, à utiliser avant le 31 mai 2027.',
      );
      expect(args.title).toBe('Congés à utiliser avant le 31 mai 2027');
    });

    it('reserved=0 : formulation simple sans lourdeur — date affichée = 31/05', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 8, reservedDays: 0 }),
      ]);
      await run('2027-02-28');
      const args = createdArgs('BALANCE_REMINDER_3M_2026-2027');
      expect(args.message).toBe(
        'Il vous reste 8 jours de congés à utiliser avant le 31 mai 2027.',
      );
    });

    it('singulier : 1 jour disponible — date affichée = 31/05', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 1, reservedDays: 0 }),
      ]);
      await run('2027-02-28');
      const args = createdArgs('BALANCE_REMINDER_3M_2026-2027');
      expect(args.message).toBe(
        'Il vous reste 1 jour de congés à utiliser avant le 31 mai 2027.',
      );
    });
  });

  describe('L — potential=0 → pas de rappel', () => {
    it('available=3 reserved=3 : aucun rappel, aucun récap, solde intact', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 3, reservedDays: 3 }),
      ]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
      expect(result.eligibleEmployees).toEqual([]);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('M — utilisateur inactif', () => {
    it('aucun rappel', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { employee: user(1, { isActive: false }) }),
      ]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
    });
  });

  describe('N — Admin', () => {
    it('aucun rappel même avec un compteur positif', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { employee: user(1, { role: 'ADMIN' }) }),
      ]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(0);
      expect(createdTypes()).not.toContain('BALANCE_REMINDER_3M_2026-2027');
    });
  });

  describe('O — Responsable/RH/Directeur avec compteur positif', () => {
    it.each(['RESPONSABLE_SERVICE', 'RH', 'DIRECTEUR'])(
      '%s reçoit son propre rappel individuel',
      async (role) => {
        balanceRepository.find.mockResolvedValue([
          balance(1, { employee: user(1, { role }) }),
        ]);
        const result = await run('2027-02-28');
        expect(result.remindersCreated).toBe(1);
      },
    );
  });

  describe('P — collaborateur EXTERNE avec compteur positif', () => {
    it('reçoit le rappel (aucune exclusion employmentType)', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { employee: user(1, { employmentType: 'EXTERNE' }) }),
      ]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(1);
    });
  });

  describe('Q — plusieurs RH', () => {
    it('un récapitulatif par RH active', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      userRepository.find.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      const result = await run('2027-02-28');
      expect(result.recapRecipients).toBe(2);
      expect(result.recapNotificationsCreated).toBe(2);
      expect(userRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: 'RH', isActive: true },
        }),
      );
      const recapCalls = notificationsService.create.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === 'BALANCE_RECAP_3M_2026-2027',
      );
      expect(recapCalls).toHaveLength(2);
    });
  });

  describe('R — aucune personne éligible', () => {
    it('aucun récapitulatif RH vide', async () => {
      balanceRepository.find.mockResolvedValue([]);
      userRepository.find.mockResolvedValue([{ id: 10 }]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
      expect(userRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('S — deuxième exécution → aucun doublon', () => {
    it('même échéance déjà notifiée : 0 rappel et 0 récap', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      userRepository.find.mockResolvedValue([{ id: 10 }]);
      notificationsService.alreadyExists.mockResolvedValue(true);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('T — nouvelle échéance', () => {
    it('31/03/2027 : BALANCE_REMINDER_2M distinct, 3M déjà envoyé non recréé', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      notificationsService.alreadyExists.mockImplementation(
        ({ type }: { type: string }) =>
          Promise.resolve(type === 'BALANCE_REMINDER_3M_2026-2027'),
      );
      const result = await run('2027-03-31');
      expect(result.deadline?.key).toBe('2M');
      expect(result.remindersCreated).toBe(1);
      const types = createdTypes();
      expect(types).toContain('BALANCE_REMINDER_2M_2026-2027');
      expect(types).not.toContain('BALANCE_REMINDER_3M_2026-2027');
    });
  });

  describe('U — solde modifié entre deux rappels', () => {
    it('chaque échéance relit les données actuelles de la base', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 8, reservedDays: 0 }),
      ]);
      await run('2027-02-28');
      expect(createdArgs('BALANCE_REMINDER_3M_2026-2027').message).toContain(
        '8 jours',
      );

      balanceRepository.find.mockResolvedValue([
        balance(1, { availableDays: 3, reservedDays: 0 }),
      ]);
      notificationsService.alreadyExists.mockImplementation(
        ({ type }: { type: string }) =>
          Promise.resolve(type === 'BALANCE_REMINDER_3M_2026-2027'),
      );
      await run('2027-03-31');
      expect(createdArgs('BALANCE_REMINDER_2M_2026-2027').message).toContain(
        '3 jours',
      );
      expect(createdArgs('BALANCE_REMINDER_2M_2026-2027').message).not.toContain(
        '8 jours',
      );
    });
  });

  describe('V — période clôturée / passée', () => {
    it('marqueur REFERENCE_PERIOD_CLOSED_2026_2027 présent : aucun rappel', async () => {
      settingsService.getValue.mockResolvedValue('2027-06-01T00:00:00.000Z');
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-05-10');
      expect(result.periodClosed).toBe(true);
      expect(result.remindersCreated).toBe(0);
      expect(settingsService.getValue).toHaveBeenCalledWith(
        'REFERENCE_PERIOD_CLOSED_2026_2027',
      );
      expect(balanceRepository.find).not.toHaveBeenCalled();
    });

    it('01/06/2027 : nouvelle période 2027-2028, aucun rappel de l’ancienne', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      const result = await run('2027-06-01');
      expect(result.referencePeriod).toBe('2027-2028');
      expect(result.afterPeriodEnd).toBe(false);
      expect(result.deadline).toBeNull();
      expect(result.remindersCreated).toBe(0);
      expect(balanceRepository.find).not.toHaveBeenCalled();
    });

    it('jour de fin (31/05/2027) : le 7D (24/05) reste le dernier dû', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      notificationsService.alreadyExists.mockResolvedValue(true);
      const result = await run('2027-05-31');
      expect(result.afterPeriodEnd).toBe(false);
      expect(result.deadline?.key).toBe('7D');
      expect(result.remindersCreated).toBe(0);
    });
  });

  describe('E4.1 — 31 mai : date de déclenchement ≠ date limite d’utilisation', () => {
    it.each([
      ['3M', '2027-02-28', '28 février 2027'],
      ['2M', '2027-03-31', '31 mars 2027'],
      ['1M', '2027-04-30', '30 avril 2027'],
      ['15D', '2027-05-16', '16 mai 2027'],
      ['7D', '2027-05-24', '24 mai 2027'],
    ])(
      '%s déclenché le %s → titre et message indiquent le 31 mai 2027, jamais le %s',
      async (key, reminderDate, frenchReminderDate) => {
        balanceRepository.find.mockResolvedValue([
          balance(1, { availableDays: 8, reservedDays: 0 }),
        ]);
        const result = await run(reminderDate);
        expect(result.deadline?.key).toBe(key);
        expect(result.deadline?.date).toBe(reminderDate);
        const args = createdArgs(`BALANCE_REMINDER_${key}_2026-2027`);
        expect(args.title).toBe('Congés à utiliser avant le 31 mai 2027');
        expect(args.message).toContain('à utiliser avant le 31 mai 2027.');
        expect(args.message).not.toContain(
          `à utiliser avant le ${frenchReminderDate}`,
        );
      },
    );

    it('récapitulatif RH : le palier déclenché et la date limite réelle sont distincts', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      userRepository.find.mockResolvedValue([{ id: 10 }]);
      await run('2027-05-16');
      const recap = createdArgs('BALANCE_RECAP_15D_2026-2027');
      expect(recap.title).toBe(
        'Récapitulatif des congés à utiliser avant le 31 mai 2027',
      );
      expect(recap.message).toContain(
        'Rappel 15 jours — période 2025/2026 (compteur N-1), congés à utiliser avant le 31 mai 2027.',
      );
      expect(recap.message).not.toContain('16 mai 2027');
    });
  });

  describe('cas transverses', () => {
    it('une RH avec compteur positif reçoit son rappel individuel ET le récapitulatif', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, { employee: user(1, { role: 'RH' }) }),
      ]);
      userRepository.find.mockResolvedValue([{ id: 1 }]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(1);
      expect(result.recapNotificationsCreated).toBe(1);
      const types = createdTypes();
      expect(types).toContain('BALANCE_REMINDER_3M_2026-2027');
      expect(types).toContain('BALANCE_RECAP_3M_2026-2027');
    });

    it('aucune RH active : rappels individuels OK, aucun récap, aucune erreur', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      userRepository.find.mockResolvedValue([]);
      const result = await run('2027-02-28');
      expect(result.remindersCreated).toBe(1);
      expect(result.recapRecipients).toBe(0);
      expect(result.recapNotificationsCreated).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('le récapitulatif contient nom, prénom, service, période, compteur et date limite (fin de période)', async () => {
      balanceRepository.find.mockResolvedValue([
        balance(1, {
          employee: user(1, {
            nom: 'DUPONT',
            prenom: 'Marie',
            service: { name: 'Équipe RH' },
          }),
          availableDays: 8,
          reservedDays: 3,
        }),
      ]);
      userRepository.find.mockResolvedValue([{ id: 10 }]);
      await run('2027-02-28');
      const recap = createdArgs('BALANCE_RECAP_3M_2026-2027');
      expect(recap.title).toBe(
        'Récapitulatif des congés à utiliser avant le 31 mai 2027',
      );
      expect(recap.message).toContain('Marie DUPONT');
      expect(recap.message).toContain('Équipe RH');
      expect(recap.message).toContain('2026-2027');
      expect(recap.message).toContain('N-1');
      expect(recap.message).toContain('Rappel 3 mois');
      expect(recap.message).toContain(
        'congés à utiliser avant le 31 mai 2027.',
      );
      expect(recap.message).not.toContain('28 février 2027');
      expect(recap.message).toContain('8');
      expect(recap.message).toContain('3');
      expect(recap.message).toContain('5');
    });

    it('les rappels et récapitulatif utilisent le canal LES_DEUX', async () => {
      balanceRepository.find.mockResolvedValue([balance(1)]);
      userRepository.find.mockResolvedValue([{ id: 10 }]);
      await run('2027-02-28');
      for (const call of notificationsService.create.mock.calls) {
        expect((call[0] as { channel: string }).channel).toBe('LES_DEUX');
      }
    });
  });
});
