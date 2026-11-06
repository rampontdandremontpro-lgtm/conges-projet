import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SettingsService } from '../settings/settings.service';
import { MonthlyAccrualService } from './monthly-accrual.service';

interface MonthInfo {
  year: number;
  month: number;
  firstDate: string;
  lastDate: string;
  accrualMonth: string;
  referencePeriod: string;
  monthLabel: string;
}

describe('MonthlyAccrualService — REF-1 période d’acquisition', () => {
  const settingsService = {
    getString: jest.fn(),
    getNumber: jest.fn(),
    getValue: jest.fn(),
    getInteger: jest.fn(),
    upsertInternal: jest.fn(),
  } as unknown as SettingsService;

  const dataSource = {} as DataSource;
  const accrualAnomalyService = { reconcile: jest.fn().mockResolvedValue(null) } as never;
  const notificationsService = {
    createForActiveRoles: jest.fn().mockResolvedValue([]),
  } as never;

  const service = new MonthlyAccrualService(
    dataSource,
    settingsService,
    accrualAnomalyService,
    notificationsService,
  );

  const info = (accrualMonth: string, referencePeriodStart: string) =>
    (service as unknown as {
      getMonthInformation: (
        accrualMonth: string,
        referencePeriodStart: string,
      ) => MonthInfo;
    }).getMonthInformation(accrualMonth, referencePeriodStart);

  describe('A — configuration GMES REFERENCE_PERIOD_START = 06-01 (non-régression)', () => {
    it('mai 2027 : crédit le 31/05/2027 → période 2026-2027', () => {
      const month = info('2027-05', '06-01');
      expect(month.lastDate).toBe('2027-05-31');
      expect(month.firstDate).toBe('2027-05-01');
      expect(month.referencePeriod).toBe('2026-2027');
    });

    it('juin 2027 : crédit le 30/06/2027 → période 2027-2028', () => {
      const month = info('2027-06', '06-01');
      expect(month.lastDate).toBe('2027-06-30');
      expect(month.referencePeriod).toBe('2027-2028');
    });

    it('bascule mai/juin : chaque mois entier dans UNE seule période', () => {
      expect(info('2027-05', '06-01').referencePeriod).toBe('2026-2027');
      expect(info('2027-06', '06-01').referencePeriod).toBe('2027-2028');
      expect(info('2028-05', '06-01').referencePeriod).toBe('2027-2028');
      expect(info('2028-06', '06-01').referencePeriod).toBe('2028-2029');
    });
  });

  describe('B — début en milieu de mois REFERENCE_PERIOD_START = 04-15', () => {
    it('mars 2027 : crédit le 31/03/2027 → période 2026-2027', () => {
      const month = info('2027-03', '04-15');
      expect(month.lastDate).toBe('2027-03-31');
      expect(month.referencePeriod).toBe('2026-2027');
    });

    it('avril 2027 : crédit le 30/04/2027 → période 2027-2028 (aucun prorata)', () => {
      const month = info('2027-04', '04-15');
      expect(month.lastDate).toBe('2027-04-30');
      expect(month.referencePeriod).toBe('2027-2028');
    });

    it('bascule mars/avril : 2,5 jours d’avril entièrement dans 2027-2028', () => {
      expect(info('2027-03', '04-15').referencePeriod).toBe('2026-2027');
      expect(info('2027-04', '04-15').referencePeriod).toBe('2027-2028');
      expect(info('2028-03', '04-15').referencePeriod).toBe('2027-2028');
      expect(info('2028-04', '04-15').referencePeriod).toBe('2028-2029');
    });
  });

  describe('C — REFERENCE_PERIOD_START = 01-01 (année civile)', () => {
    it('décembre 2026 : crédit le 31/12/2026 → période 2026-2027', () => {
      expect(info('2026-12', '01-01').lastDate).toBe('2026-12-31');
      expect(info('2026-12', '01-01').referencePeriod).toBe('2026-2027');
    });

    it('janvier 2027 : crédit le 31/01/2027 → période 2027-2028', () => {
      expect(info('2027-01', '01-01').lastDate).toBe('2027-01-31');
      expect(info('2027-01', '01-01').referencePeriod).toBe('2027-2028');
    });
  });

  describe('D — REFERENCE_PERIOD_START = 12-15', () => {
    it('novembre 2026 : crédit le 30/11/2026 → période 2025-2026', () => {
      expect(info('2026-11', '12-15').lastDate).toBe('2026-11-30');
      expect(info('2026-11', '12-15').referencePeriod).toBe('2025-2026');
    });

    it('décembre 2026 : crédit le 31/12/2026 → période 2026-2027', () => {
      expect(info('2026-12', '12-15').lastDate).toBe('2026-12-31');
      expect(info('2026-12', '12-15').referencePeriod).toBe('2026-2027');
    });
  });

  describe('E — février et années bissextiles (dernier jour réel)', () => {
    it('février 2027 : crédit le 28/02/2027', () => {
      const month = info('2027-02', '06-01');
      expect(month.lastDate).toBe('2027-02-28');
      expect(month.referencePeriod).toBe('2026-2027');
    });

    it('février 2028 : crédit le 29/02/2028 (jamais 28 jours codé en dur)', () => {
      const month = info('2028-02', '06-01');
      expect(month.lastDate).toBe('2028-02-29');
      expect(month.referencePeriod).toBe('2027-2028');
    });

    it('février 2028 avec 04-15 : 29/02/2028 → 2027-2028', () => {
      const month = info('2028-02', '04-15');
      expect(month.lastDate).toBe('2028-02-29');
      expect(month.referencePeriod).toBe('2027-2028');
    });
  });

  describe('F — déterminisme : mois traité, jamais la date d’exécution', () => {
    it('le mois et l’année renvoyés sont ceux du paramètre AAAA-MM', () => {
      const month = info('2027-04', '04-15');
      expect(month.year).toBe(2027);
      expect(month.month).toBe(4);
      expect(month.accrualMonth).toBe('2027-04');
      expect(month.monthLabel).toBe('avril');
    });

    it('deux appels identiques produisent exactement le même résultat', () => {
      expect(info('2027-04', '04-15')).toEqual(info('2027-04', '04-15'));
    });
  });

  describe('G — garde-fous du format AAAA-MM', () => {
    it('rejette un mois invalide', () => {
      expect(() => info('2027-13', '06-01')).toThrow(BadRequestException);
      expect(() => info('2027-4', '06-01')).toThrow(BadRequestException);
      expect(() => info('abc', '06-01')).toThrow(BadRequestException);
    });
  });

  describe('H — runForMonth lit REFERENCE_PERIOD_START via SettingsService', () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const runDataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        find: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
      }),
      transaction: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource;

    let runService: MonthlyAccrualService;
    let martiniqueSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      runService = new MonthlyAccrualService(
        runDataSource,
        settingsService,
        accrualAnomalyService,
        notificationsService,
      );
      martiniqueSpy = jest
        .spyOn(
          MonthlyAccrualService.prototype as unknown as {
            getMartiniqueDateString: () => string;
          },
          'getMartiniqueDateString',
        )
        .mockReturnValue('2027-12-31');
    });

    afterEach(() => {
      martiniqueSpy.mockRestore();
    });

    it('force 04-15 : avril 2027 → rattaché à 2027-2028 (date effective 30/04/2027)', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('04-15');
      (settingsService.getNumber as jest.Mock).mockResolvedValue(2.5);

      const result = await runService.runForMonth('2027-04', 1);

      expect(settingsService.getString).toHaveBeenCalledWith(
        'REFERENCE_PERIOD_START',
        '06-01',
      );
      expect(result.accrualMonth).toBe('2027-04');
      expect(result.effectiveDate).toBe('2027-04-30');
      expect(result.referencePeriod).toBe('2027-2028');
    });

    it('force 06-01 : mai 2027 → rattaché à 2026-2027 (non-régression GMES)', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('06-01');
      (settingsService.getNumber as jest.Mock).mockResolvedValue(2.5);

      const result = await runService.runForMonth('2027-05', 1);

      expect(result.referencePeriod).toBe('2026-2027');
      expect(result.effectiveDate).toBe('2027-05-31');
    });
  });

  describe('I — prorata calendaire arrivée/départ (règle validée BAL-009)', () => {
    const computePresence = (
      hireDate: string | null,
      exitDate: string | null,
      accrualMonth = '2026-07',
    ) =>
      (service as unknown as {
        computePresence: (
          hireDate: string | null,
          exitDate: string | null,
          monthInformation: MonthInfo,
        ) => { daysPresent: number; daysInMonth: number } | null;
      }).computePresence(hireDate, exitDate, info(accrualMonth, '06-01'));

    const computeCredit = (
      daysPresent: number,
      daysInMonth: number,
      rate = 2.5,
    ) =>
      (service as unknown as {
        computeMonthlyCredit: (
          rate: number,
          presence: { daysPresent: number; daysInMonth: number },
        ) => number;
      }).computeMonthlyCredit(rate, { daysPresent, daysInMonth });

    it('mois complet 01/07 → 31/07 : 31 jours, crédit 2,50', () => {
      expect(computePresence(null, null)).toMatchObject({ daysPresent: 31, daysInMonth: 31 });
      expect(computeCredit(31, 31)).toBe(2.5);
    });

    it('arrivée 16/07 : 16 jours de présence, crédit 1,29', () => {
      expect(computePresence('2026-07-16', null)).toMatchObject({ daysPresent: 16, daysInMonth: 31 });
      expect(computeCredit(16, 31)).toBe(1.29);
    });

    it('arrivée 31/07 : 1 jour, crédit 0,08', () => {
      expect(computePresence('2026-07-31', null)).toMatchObject({ daysPresent: 1, daysInMonth: 31 });
      expect(computeCredit(1, 31)).toBe(0.08);
    });

    it('départ 15/07 : 15 jours, crédit 1,21', () => {
      expect(computePresence('2026-07-01', '2026-07-15')).toMatchObject({ daysPresent: 15, daysInMonth: 31 });
      expect(computeCredit(15, 31)).toBe(1.21);
    });

    it('départ 31/07 : mois complet, crédit 2,50', () => {
      expect(computePresence('2026-07-01', '2026-07-31')).toMatchObject({ daysPresent: 31, daysInMonth: 31 });
      expect(computeCredit(31, 31)).toBe(2.5);
    });

    it('arrivée 16/07 + départ 20/07 : 5 jours, crédit 0,40', () => {
      expect(computePresence('2026-07-16', '2026-07-20')).toMatchObject({ daysPresent: 5, daysInMonth: 31 });
      expect(computeCredit(5, 31)).toBe(0.4);
    });

    it('hireDate après le mois : aucune présence (null)', () => {
      expect(computePresence('2026-08-01', null)).toBeNull();
    });

    it('exitDate avant le mois : aucune présence (null)', () => {
      expect(computePresence('2026-01-01', '2026-06-30')).toBeNull();
    });

    it('exitDate dans le mois alors que le salarié est désormais inactif : prorata du dernier mois', () => {
      // L'éligibilité est gérée dans findEligibleEmployees ; ici le calcul
      // ne dépend que des dates.
      expect(computePresence('2026-05-01', '2026-07-15')).toMatchObject({ daysPresent: 15, daysInMonth: 31 });
      expect(computeCredit(15, 31)).toBe(1.21);
    });

    it('exitDate null : comportement normal (mois complet)', () => {
      expect(computePresence('2026-01-01', null)).toMatchObject({ daysPresent: 31, daysInMonth: 31 });
    });
  });
});

describe('MonthlyAccrualService — déclenchement automatique et rattrapage', () => {
  const settingsService = {
    getString: jest.fn(),
    getNumber: jest.fn(),
    getValue: jest.fn(),
    getInteger: jest.fn(),
    upsertInternal: jest.fn().mockResolvedValue({}),
  } as unknown as SettingsService;
  const dataSource = {} as DataSource;
  const accrualAnomalyService = { reconcile: jest.fn().mockResolvedValue(null) } as never;
  const notificationsService = {
    createForActiveRoles: jest.fn().mockResolvedValue([]),
  } as never;

  const service = new MonthlyAccrualService(
    dataSource,
    settingsService,
    accrualAnomalyService,
    notificationsService,
  );

  const months = (service as unknown as {
    mostRecentEligibleAccrualMonth: (now: Date) => string;
    nextAccrualMonth: (month: string) => string;
    determineAutomaticMonthsToProcess: (now: Date) => Promise<string[]>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (settingsService.getString as jest.Mock).mockResolvedValue('');
  });

  describe('mostRecentEligibleAccrualMonth (heure Martinique, UTC-4)', () => {
    it('dernier jour du mois à 23 h locale → mois courant éligible', () => {
      // 2026-11-01 03:00 UTC = 31/10/2026 23:00 Martinique
      expect(months.mostRecentEligibleAccrualMonth(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10');
    });

    it('dernier jour du mois AVANT 23 h → mois précédent (aucune anticipation)', () => {
      // 2026-11-01 00:00 UTC = 31/10/2026 20:00 Martinique
      expect(months.mostRecentEligibleAccrualMonth(new Date('2026-11-01T00:00:00Z'))).toBe('2026-09');
    });

    it('en milieu de mois → mois précédent', () => {
      // 2026-11-05 12:00 UTC = 05/11/2026 08:00 Martinique
      expect(months.mostRecentEligibleAccrualMonth(new Date('2026-11-05T12:00:00Z'))).toBe('2026-10');
    });

    it('début janvier → décembre de l’année précédente', () => {
      // 2026-01-05 12:00 UTC = 05/01/2026 08:00 Martinique → mois précédent = 2025-12
      expect(months.mostRecentEligibleAccrualMonth(new Date('2026-01-05T12:00:00Z'))).toBe('2025-12');
    });

    it('31/12 AVANT 23 h → novembre (décembre pas encore terminé)', () => {
      // 2026-01-01 00:00 UTC = 31/12/2025 20:00 Martinique
      expect(months.mostRecentEligibleAccrualMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2025-11');
    });
  });

  describe('nextAccrualMonth', () => {
    it('passe au mois suivant', () => {
      expect(months.nextAccrualMonth('2026-11')).toBe('2026-12');
    });

    it('change d’année en décembre', () => {
      expect(months.nextAccrualMonth('2026-12')).toBe('2027-01');
    });
  });

  describe('determineAutomaticMonthsToProcess — pas d’acquisition prématurée', () => {
    it('jalon = mois précédent, milieu de mois → aucun mois', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('2026-10');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-05T12:00:00Z'))).resolves.toEqual([]);
    });
  });

  describe('determineAutomaticMonthsToProcess — créneau prévu', () => {
    it('dernier jour 23 h → le mois qui vient de se terminer', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('2026-09');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-01T03:00:00Z'))).resolves.toEqual(['2026-10']);
    });
  });

  describe('determineAutomaticMonthsToProcess — rattrapage après interruption', () => {
    it('serveur arrêté pendant le créneau : le mois manqué est rattrapé au redémarrage', async () => {
      // Jalon = septembre ; redémarrage le 05/11 : octobre doit être rattrapé.
      (settingsService.getString as jest.Mock).mockResolvedValue('2026-09');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-05T12:00:00Z'))).resolves.toEqual(['2026-10']);
    });

    it('plusieurs mois manqués sont traités dans l’ordre', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('2026-07');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-05T12:00:00Z'))).resolves.toEqual(['2026-08', '2026-09', '2026-10']);
    });

    it('jalon = mois éligible le plus récent → aucun re-traitement (idempotence)', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('2026-10');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-05T12:00:00Z'))).resolves.toEqual([]);
    });
  });

  describe('determineAutomaticMonthsToProcess — premier démarrage', () => {
    it('sans jalon : seul le mois éligible le plus récent est traité (pas de remontée historique)', async () => {
      (settingsService.getString as jest.Mock).mockResolvedValue('');
      await expect(months.determineAutomaticMonthsToProcess(new Date('2026-11-05T12:00:00Z'))).resolves.toEqual(['2026-10']);
    });
  });
});

describe('MonthlyAccrualService — rattrapage : un échec ne masque jamais un mois', () => {
  const settingsService = {
    getString: jest.fn(),
    getNumber: jest.fn(),
    getValue: jest.fn(),
    getInteger: jest.fn(),
    upsertInternal: jest.fn().mockResolvedValue({}),
  } as unknown as SettingsService;
  const dataSource = {} as DataSource;
  const accrualAnomalyService = { reconcile: jest.fn().mockResolvedValue(null) } as never;
  const notificationsService = {
    createForActiveRoles: jest.fn().mockResolvedValue([]),
  } as never;

  const service = new MonthlyAccrualService(
    dataSource,
    settingsService,
    accrualAnomalyService,
    notificationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Jalon = juillet ; au 05/11 (Martinique) → mois à traiter : août, sept., oct.
    // Le jalon est stateful : upsertInternal met à jour la valeur lue ensuite.
    let watermark = '2026-07';
    (settingsService.getString as jest.Mock).mockImplementation(
      async (key: string) =>
        key === 'AUTO_ACCRUAL_LAST_PROCESSED_MONTH' ? watermark : '',
    );
    (settingsService.upsertInternal as jest.Mock).mockImplementation(
      async (_key: string, value: string) => {
        watermark = value;
        return {};
      },
    );
  });

  const runForMonthSpy = (service, behavior) =>
    jest.spyOn(service, 'runForMonth').mockImplementation(async (month: string) => {
      const action = behavior[month];
      if (action === 'fail') throw new Error(`échec simulé ${month}`);
      return {
        accrualMonth: month,
        effectiveDate: `${month}-01`,
        referencePeriod: '2026-2027',
        daysPerEmployee: 2.5,
        creditedEmployees: [],
        alreadyCreditedEmployees: [],
        legacyMovementsLinked: [],
        manualReviewRequired: [],
      };
    });

  it('août OK, septembre échoue → octobre N’EST PAS traité, jalon reste août', async () => {
    const spy = runForMonthSpy(service, { '2026-08': 'ok', '2026-09': 'fail', '2026-10': 'ok' });

    await (service as unknown as { runAutomaticAccrualIfDue: (now: Date) => Promise<void> }).runAutomaticAccrualIfDue(new Date("2026-11-05T12:00:00Z"));

    expect(spy.mock.calls.map((c) => c[0])).toEqual(['2026-08', '2026-09']);
    expect(settingsService.upsertInternal).toHaveBeenCalledTimes(1);
    expect(settingsService.upsertInternal).toHaveBeenCalledWith(
      'AUTO_ACCRUAL_LAST_PROCESSED_MONTH',
      '2026-08',
      expect.any(String),
      null,
    );
    expect(notificationsService.createForActiveRoles).toHaveBeenCalledTimes(1);
    expect(notificationsService.createForActiveRoles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'AUTO_ACCRUAL_FAILED' }),
    );
  });

  it('notification défaillante → l’échec reste signalé et ne fait pas échouer le cycle', async () => {
    const spy = runForMonthSpy(service, { '2026-08': 'fail' });
    (notificationsService.createForActiveRoles as jest.Mock).mockRejectedValue(new Error('notif down'));

    await (service as unknown as { runAutomaticAccrualIfDue: (now: Date) => Promise<void> }).runAutomaticAccrualIfDue(new Date("2026-11-05T12:00:00Z"));

    // août seul tenté ; aucune exception ne remonte ; le jalon n'avance pas.
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['2026-08']);
    expect(settingsService.upsertInternal).not.toHaveBeenCalled();
  });

  it('relance après échec : le mois échoué est retenté, sans double crédit (idempotence)', async () => {
    const behavior = { '2026-08': 'ok', '2026-09': 'fail', '2026-10': 'ok' };
    const spy = jest.spyOn(service, 'runForMonth').mockImplementation(async (month: string) => {
      if (behavior[month] === 'fail') throw new Error(`échec simulé ${month}`);
      return {
        accrualMonth: month, effectiveDate: `${month}-01`, referencePeriod: '2026-2027',
        daysPerEmployee: 2.5, creditedEmployees: [], alreadyCreditedEmployees: [],
        legacyMovementsLinked: [], manualReviewRequired: [],
      };
    });

    // Cycle 1 : août OK, septembre échoue → octobre non tenté.
    await (service as unknown as { runAutomaticAccrualIfDue: (now: Date) => Promise<void> }).runAutomaticAccrualIfDue(new Date("2026-11-05T12:00:00Z"));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['2026-08', '2026-09']);

    // Cycle 2 : septembre réussit désormais → septembre retenté puis octobre (août non rejoué).
    behavior['2026-09'] = 'ok';
    await (service as unknown as { runAutomaticAccrualIfDue: (now: Date) => Promise<void> }).runAutomaticAccrualIfDue(new Date("2026-11-05T12:00:00Z"));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['2026-08', '2026-09', '2026-09', '2026-10']);
  });
});
