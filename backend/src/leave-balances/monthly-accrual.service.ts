import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { SettingsService } from '../settings/settings.service';
import { User, UserRole } from '../users/user.entity';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import { currentReferencePeriod } from './reference-period.util';

export interface MonthlyAccrualRunResult {
  accrualMonth: string;
  effectiveDate: string;
  referencePeriod: string;
  daysPerEmployee: number;
  creditedEmployees: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    leaveBalanceId: number;
    movementId: number;
  }>;
  alreadyCreditedEmployees: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
  }>;
  legacyMovementsLinked: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    movementId: number;
  }>;
  manualReviewRequired: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    reason: string;
  }>;
}

interface MonthInformation {
  year: number;
  month: number;
  firstDate: string;
  lastDate: string;
  accrualMonth: string;
  referencePeriod: string;
  monthLabel: string;
}

interface MartiniqueDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

@Injectable()
export class MonthlyAccrualService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MonthlyAccrualService.name);
  private readonly martiniqueTimeZone = 'America/Martinique';
  private readonly schedulerIntervalMilliseconds = 15 * 60 * 1000;
  private scheduler?: NodeJS.Timeout;
  private automaticRunInProgress = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.runAutomaticAccrualIfDue();

    this.scheduler = setInterval(() => {
      void this.runAutomaticAccrualIfDue();
    }, this.schedulerIntervalMilliseconds);

    this.scheduler.unref();
  }

  onApplicationShutdown(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
    }
  }

  async runForMonth(
    accrualMonth: string,
    actorId: number | null,
  ): Promise<MonthlyAccrualRunResult> {
    const referencePeriodStart = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const monthInformation = this.getMonthInformation(
      accrualMonth,
      referencePeriodStart,
    );
    const currentDate = this.getMartiniqueDateString(new Date());

    if (monthInformation.lastDate > currentDate) {
      throw new BadRequestException(
        `Le mois ${accrualMonth} n’est pas terminé. L’acquisition ne peut être créditée qu’au dernier jour du mois.`,
      );
    }

    const daysPerEmployee = await this.settingsService.getNumber(
      'MONTHLY_ACCRUAL_RATE',
      2.5,
    );

    if (daysPerEmployee <= 0) {
      throw new BadRequestException(
        'Le paramètre MONTHLY_ACCRUAL_RATE doit être strictement positif.',
      );
    }

    const employees = await this.findEligibleEmployees(
      monthInformation.firstDate,
      monthInformation.lastDate,
    );
    const result: MonthlyAccrualRunResult = {
      accrualMonth: monthInformation.accrualMonth,
      effectiveDate: monthInformation.lastDate,
      referencePeriod: monthInformation.referencePeriod,
      daysPerEmployee,
      creditedEmployees: [],
      alreadyCreditedEmployees: [],
      legacyMovementsLinked: [],
      manualReviewRequired: [],
    };

    for (const employee of employees) {
      const presence = this.computePresence(
        employee.hireDate,
        employee.exitDate,
        monthInformation,
      );

      if (!presence) {
        // Aucune présence dans le mois cible (ex. départ antérieur au mois) :
        // aucun droit, aucun mouvement, aucun signalement.
        continue;
      }

      const days = this.computeMonthlyCredit(
        daysPerEmployee,
        presence,
      );

      if (days <= 0) {
        continue;
      }

      const employeeResult = await this.processEmployeeAccrual({
        employee,
        monthInformation,
        days,
        actorId,
        presence,
      });

      if (employeeResult.status === 'CREDITED') {
        result.creditedEmployees.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          leaveBalanceId: employeeResult.leaveBalanceId,
          movementId: employeeResult.movementId,
        });
      } else if (employeeResult.status === 'LEGACY_LINKED') {
        result.legacyMovementsLinked.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          movementId: employeeResult.movementId,
        });
      } else {
        result.alreadyCreditedEmployees.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
        });
      }
    }

    return result;
  }

  private async runAutomaticAccrualIfDue(): Promise<void> {
    if (this.automaticRunInProgress) {
      return;
    }

    const localDate = this.getMartiniqueDateParts(new Date());
    const lastDay = new Date(
      Date.UTC(localDate.year, localDate.month, 0),
    ).getUTCDate();

    if (localDate.day !== lastDay || localDate.hour < 23) {
      return;
    }

    this.automaticRunInProgress = true;
    const accrualMonth = `${localDate.year}-${String(
      localDate.month,
    ).padStart(2, '0')}`;

    try {
      const result = await this.runForMonth(accrualMonth, null);
      this.logger.log(
        [
          `Acquisition mensuelle ${accrualMonth} terminée.`,
          `${result.creditedEmployees.length} collaborateur(s) crédité(s).`,
          `${result.alreadyCreditedEmployees.length} déjà crédité(s).`,
          `${result.manualReviewRequired.length} dossier(s) à contrôler par la RH.`,
        ].join(' '),
      );
    } catch (error) {
      this.logger.error(
        `Échec de l’acquisition mensuelle ${accrualMonth} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.automaticRunInProgress = false;
    }
  }

  private async processEmployeeAccrual(data: {
    employee: User;
    monthInformation: MonthInformation;
    days: number;
    actorId: number | null;
    presence: { daysPresent: number; daysInMonth: number } | null;
  }): Promise<
    | {
        status: 'CREDITED';
        leaveBalanceId: number;
        movementId: number;
      }
    | { status: 'ALREADY_CREDITED' }
    | { status: 'LEGACY_LINKED'; movementId: number }
  > {
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.findOrCreateMonthlyBalance(
        manager,
        data.employee,
        data.monthInformation.referencePeriod,
      );
      const reason = this.buildMonthlyAccrualReason(
        data.monthInformation,
        data.days,
        data.presence,
      );
      const movementRepository = manager.getRepository(BalanceMovement);
      const existingMovement = await movementRepository.findOne({
        where: {
          employeeId: data.employee.id,
          movementType: BalanceMovementType.ACQUISITION,
          reason,
        },
      });

      if (existingMovement) {
        return { status: 'ALREADY_CREDITED' as const };
      }

      const legacyMovement = await this.findLegacyMonthlyMovement(
        manager,
        data.employee.id,
        data.monthInformation,
      );

      if (legacyMovement) {
        return {
          status: 'LEGACY_LINKED' as const,
          movementId: legacyMovement.id,
        };
      }

      const balanceBefore = this.round(balance.availableDays);
      const balanceAfter = this.round(balanceBefore + data.days);

      balance.acquiredDays = this.round(
        balance.acquiredDays + data.days,
      );
      balance.availableDays = balanceAfter;
      await manager.getRepository(LeaveBalance).save(balance);

      const movement = movementRepository.create({
        employeeId: data.employee.id,
        employee: data.employee,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: null,
        leaveRequest: null,
        actorId: data.actorId,
        actor: null,
        movementType: BalanceMovementType.ACQUISITION,
        days: data.days,
        balanceBefore,
        balanceAfter,
        reason,
        createdAt: new Date(
          `${data.monthInformation.lastDate}T23:59:59-04:00`,
        ),
      });

      const savedMovement = await movementRepository.save(movement);

      return {
        status: 'CREDITED' as const,
        leaveBalanceId: balance.id,
        movementId: savedMovement.id,
      };
    });
  }

  private async findEligibleEmployees(
    firstDate: string,
    lastDate: string,
  ): Promise<User[]> {
    return this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.role != :adminRole', { adminRole: UserRole.ADMIN })
      .andWhere('user.hireDate IS NOT NULL')
      .andWhere('user.hireDate <= :lastDate', { lastDate })
      .andWhere(
        '(user.isActive = :active OR (user.exitDate IS NOT NULL AND user.exitDate >= :firstDate))',
        { active: true, firstDate },
      )
      .orderBy('user.nom', 'ASC')
      .addOrderBy('user.prenom', 'ASC')
      .getMany();
  }

  private async findOrCreateMonthlyBalance(
    manager: EntityManager,
    employee: User,
    referencePeriod: string,
  ): Promise<LeaveBalance> {
    const repository = manager.getRepository(LeaveBalance);
    const existingBalance = await repository
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', {
        employeeId: employee.id,
      })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N,
      })
      .getOne();

    if (existingBalance) {
      return existingBalance;
    }

    return repository.save(
      repository.create({
        employeeId: employee.id,
        employee,
        referencePeriod,
        counterType: LeaveBalanceCounterType.N,
        acquiredDays: 0,
        reservedDays: 0,
        consumedDays: 0,
        availableDays: 0,
      }),
    );
  }

  private async findLegacyMonthlyMovement(
    manager: EntityManager,
    employeeId: number,
    monthInformation: MonthInformation,
  ): Promise<BalanceMovement | null> {
    const movements = await manager.getRepository(BalanceMovement).find({
      where: {
        employeeId,
        movementType: BalanceMovementType.ACQUISITION,
      },
      order: { id: 'ASC' },
    });
    const monthLabel = this.normalizeText(monthInformation.monthLabel);

    return (
      movements.find((movement) => {
        const reason = this.normalizeText(movement.reason ?? '');
        return (
          reason.includes('acquisition') &&
          reason.includes(monthLabel) &&
          reason.includes(String(monthInformation.year))
        );
      }) ?? null
    );
  }

  private getMonthInformation(
    accrualMonth: string,
    referencePeriodStart: string,
  ): MonthInformation {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(accrualMonth);

    if (!match) {
      throw new BadRequestException(
        'Le mois d’acquisition doit respecter le format AAAA-MM.',
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDate = `${year}-${String(month).padStart(2, '0')}-${String(
      lastDay,
    ).padStart(2, '0')}`;
    const referencePeriod = currentReferencePeriod(
      lastDate,
      referencePeriodStart,
    );
    const labels = [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ];

    return {
      year,
      month,
      firstDate,
      lastDate,
      accrualMonth,
      referencePeriod,
      monthLabel: labels[month - 1],
    };
  }

  private buildMonthlyAccrualReason(
    monthInformation: MonthInformation,
    days: number,
    presence: { daysPresent: number; daysInMonth: number } | null,
  ): string {
    const usesElision = ['avril', 'août', 'octobre'].includes(
      monthInformation.monthLabel,
    );
    const monthPart = usesElision
      ? `d’${monthInformation.monthLabel}`
      : `de ${monthInformation.monthLabel}`;
    const formattedDays = this.formatDays(days);

    if (presence && presence.daysPresent < presence.daysInMonth) {
      return `Acquisition proratisée ${monthPart} ${monthInformation.year} : +${formattedDays} jour(s) (présence ${presence.daysPresent}/${presence.daysInMonth})`;
    }

    return `Acquisition mensuelle ${monthPart} ${monthInformation.year} : +${formattedDays} jours`;
  }

  private computePresence(
    hireDate: string | null,
    exitDate: string | null,
    monthInformation: MonthInformation,
  ): { daysPresent: number; daysInMonth: number } | null {
    const first = new Date(`${monthInformation.firstDate}T00:00:00Z`);
    const last = new Date(`${monthInformation.lastDate}T00:00:00Z`);
    const hire = hireDate ? new Date(`${hireDate}T00:00:00Z`) : first;
    const exit = exitDate ? new Date(`${exitDate}T00:00:00Z`) : last;

    const start = hire.getTime() > first.getTime() ? hire : first;
    const end = exit.getTime() < last.getTime() ? exit : last;

    if (start.getTime() > end.getTime()) {
      return null;
    }

    const daysPresent =
      Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    const daysInMonth = Number(monthInformation.lastDate.slice(8, 10));

    return { daysPresent, daysInMonth };
  }

  private computeMonthlyCredit(
    daysPerEmployee: number,
    presence: { daysPresent: number; daysInMonth: number },
  ): number {
    if (presence.daysPresent === presence.daysInMonth) {
      return this.round(daysPerEmployee);
    }

    return this.round(
      (daysPerEmployee * presence.daysPresent) / presence.daysInMonth,
    );
  }

  private getMartiniqueDateParts(date: Date): MartiniqueDateParts {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.martiniqueTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const values = new Map(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );

    return {
      year: Number(values.get('year')),
      month: Number(values.get('month')),
      day: Number(values.get('day')),
      hour: Number(values.get('hour')),
    };
  }

  private getMartiniqueDateString(date: Date): string {
    const parts = this.getMartiniqueDateParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day,
    ).padStart(2, '0')}`;
  }

  private formatDays(days: number): string {
    return days
      .toFixed(2)
      .replace(/0+$/, '')
      .replace(/\.$/, '')
      .replace('.', ',');
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .toLowerCase();
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
