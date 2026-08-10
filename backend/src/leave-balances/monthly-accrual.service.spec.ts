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
  } as unknown as SettingsService;

  const dataSource = {} as DataSource;

  const service = new MonthlyAccrualService(dataSource, settingsService);

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
      }),
      transaction: jest.fn(),
    } as unknown as DataSource;

    let runService: MonthlyAccrualService;
    let martiniqueSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      runService = new MonthlyAccrualService(
        runDataSource,
        settingsService,
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
});
