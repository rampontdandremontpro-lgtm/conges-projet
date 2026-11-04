import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { withDeadlockRetry } from '../common/deadlock-retry.util';
import {
  LegalEntityConventionType,
} from '../legal-entities/legal-entity.entity';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole } from '../users/user.entity';
import { resolveSeniorityRule } from './convention-rules.util';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import { parseReferencePeriod } from './reference-period.util';
import {
  fullYearsBetween,
  seniorityExtraDays,
  SYNTEC_SENIORITY_THRESHOLDS,
  type SeniorityThreshold,
} from './syntec-seniority.util';

export interface SeniorityExtraDaysConfig {
  enabled: boolean;
  /** MM-JJ de la date d'appréciation (ouverture de la période de prise). */
  referenceMonthDay: string;
  /** Paliers triés par ancienneté croissante (jours TOTAUX, non cumulatifs). */
  thresholds: SeniorityThreshold[];
  /** Codes d'entités légales concernées. Vide = aucune attribution. */
  legalEntityCodes: string[];
}

export interface SeniorityExtraPreviewItem {
  employeeId: number;
  nom: string;
  prenom: string;
  legalEntityCode: string | null;
  hireDate: string | null;
  referenceDate: string;
  fullYears: number;
  extraDays: number;
  applicable: boolean;
  alreadyAllocated: boolean;
  skipReason: string | null;
}

export interface SeniorityExtraApplyResult {
  referencePeriod: string;
  referenceDate: string;
  allocated: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    legalEntityCode: string | null;
    extraDays: number;
    leaveBalanceId: number;
  }>;
  skipped: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    reason: string;
  }>;
}

const DEFAULT_THRESHOLDS: SeniorityThreshold[] = SYNTEC_SENIORITY_THRESHOLDS;

const DEFAULT_CONFIG: SeniorityExtraDaysConfig = {
  enabled: false,
  referenceMonthDay: '05-01',
  thresholds: DEFAULT_THRESHOLDS,
  legalEntityCodes: [],
};

@Injectable()
export class SeniorityExtraDaysService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
  ) {}

  async getConfig(): Promise<SeniorityExtraDaysConfig> {
    const raw = await this.settingsService.getValue(
      'SENIORITY_EXTRA_DAYS_CONFIG',
    );
    if (!raw) {
      return { ...DEFAULT_CONFIG, thresholds: [...DEFAULT_THRESHOLDS] };
    }
    return this.parseConfig(raw);
  }

  async updateConfig(
    config: SeniorityExtraDaysConfig,
    actorId: number,
  ): Promise<SeniorityExtraDaysConfig> {
    const normalized = this.parseConfig(JSON.stringify(config));
    await this.settingsService.upsertInternal(
      'SENIORITY_EXTRA_DAYS_CONFIG',
      JSON.stringify(normalized),
      'Jours supplémentaires d’ancienneté (Syntec 5.1) — configuration RH.',
      actorId,
    );
    await this.auditService.record({
      actorId,
      action: 'SENIORITY_EXTRA_CONFIG_UPDATED',
      resourceType: 'SETTINGS',
      resourceId: null,
      newValue: { config: normalized },
    });
    return normalized;
  }

  referenceDateFor(
    referencePeriod: string,
    referenceMonthDay: string,
  ): string {
    const { endYear } = parseReferencePeriod(referencePeriod);
    const [month, day] = referenceMonthDay.split('-').map(Number);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${endYear}-${pad(month)}-${pad(day)}`;
  }

  isApplicable(
    employee: Pick<User, 'legalEntity'>,
    config: SeniorityExtraDaysConfig,
  ): boolean {
    if (!config.enabled) return false;
    // JUR-024 : l'ancienneté est une matière conventionnelle (Syntec 5.1).
    // Applicable uniquement si la convention de l'entité est explicitement SYNTEC.
    const convention =
      employee.legalEntity?.conventionType ??
      LegalEntityConventionType.NON_RENSEIGNEE;
    return resolveSeniorityRule(convention).applicable;
  }

  extraDaysFor(
    employee: Pick<User, 'hireDate' | 'legalEntity'>,
    referenceDate: string,
    config: SeniorityExtraDaysConfig,
  ): number {
    if (!this.isApplicable(employee, config) || !employee.hireDate) {
      return 0;
    }
    return seniorityExtraDays(
      employee.hireDate,
      referenceDate,
      config.thresholds,
    );
  }

  async preview(
    referencePeriod: string,
  ): Promise<SeniorityExtraPreviewItem[]> {
    const config = await this.getConfig();
    const referenceDate = this.referenceDateFor(
      referencePeriod,
      config.referenceMonthDay,
    );
    const employees = await this.findEligibleEmployees();
    const items: SeniorityExtraPreviewItem[] = [];

    for (const employee of employees) {
      const applicable = this.isApplicable(employee, config);
      const extraDays = this.extraDaysFor(employee, referenceDate, config);
      const fullYears = employee.hireDate
        ? fullYearsBetween(employee.hireDate, referenceDate)
        : 0;
      const skipReason = !config.enabled
        ? 'CONFIG_DISABLED'
        : !applicable
          ? 'ENTITE_NON_CONCERNEE'
          : !employee.hireDate
            ? 'DATE_EMBAUCHE_INCONNUE'
            : null;

      items.push({
        employeeId: employee.id,
        nom: employee.nom,
        prenom: employee.prenom,
        legalEntityCode: employee.legalEntity?.code ?? null,
        hireDate: employee.hireDate,
        referenceDate,
        fullYears,
        extraDays,
        applicable,
        alreadyAllocated: await this.isAlreadyAllocated(
          employee.id,
          referencePeriod,
        ),
        skipReason,
      });
    }

    return items;
  }

  async apply(
    referencePeriod: string,
    actorId: number,
  ): Promise<SeniorityExtraApplyResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new BadRequestException(
        'L’attribution automatique des jours d’ancienneté est désactivée (SENIORITY_EXTRA_DAYS_CONFIG.enabled = false).',
      );
    }
    this.validateReferencePeriod(referencePeriod);
    const referenceDate = this.referenceDateFor(
      referencePeriod,
      config.referenceMonthDay,
    );
    const employees = await this.findEligibleEmployees();

    const result: SeniorityExtraApplyResult = {
      referencePeriod,
      referenceDate,
      allocated: [],
      skipped: [],
    };

    for (const employee of employees) {
      if (!this.isApplicable(employee, config)) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'ENTITE_NON_CONCERNEE',
        });
        continue;
      }
      if (!employee.hireDate) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'DATE_EMBAUCHE_INCONNUE',
        });
        continue;
      }

      const extraDays = this.extraDaysFor(employee, referenceDate, config);
      if (extraDays <= 0) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'ANCIENNETE_INSUFFISANTE',
        });
        continue;
      }

      const allocated = await withDeadlockRetry(
        () =>
          this.allocateForEmployee(
            employee,
            referencePeriod,
            referenceDate,
            extraDays,
            actorId,
          ),
        { label: `ancienneté ${employee.id}` },
      );

      if (allocated === 'ALREADY_ALLOCATED') {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'DEJA_ATTRIBUE',
        });
        continue;
      }

      result.allocated.push({
        employeeId: employee.id,
        nom: employee.nom,
        prenom: employee.prenom,
        legalEntityCode: employee.legalEntity?.code ?? null,
        extraDays,
        leaveBalanceId: allocated.leaveBalanceId,
      });
    }

    return result;
  }

  private async allocateForEmployee(
    employee: User,
    referencePeriod: string,
    referenceDate: string,
    extraDays: number,
    actorId: number,
  ): Promise<{ leaveBalanceId: number } | 'ALREADY_ALLOCATED'> {
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.findOrCreateBalanceForUpdate(
        manager,
        employee.id,
        referencePeriod,
      );

      const existing = await manager.getRepository(BalanceMovement).findOne({
        where: {
          leaveBalanceId: balance.id,
          movementType: BalanceMovementType.SENIORITY_EXTRA,
        },
      });
      if (existing) {
        return 'ALREADY_ALLOCATED' as const;
      }

      const years = fullYearsBetween(employee.hireDate as string, referenceDate);
      const convention =
        employee.legalEntity?.conventionType ??
        LegalEntityConventionType.NON_RENSEIGNEE;
      const rule = resolveSeniorityRule(convention);
      const balanceBefore = this.round(balance.availableDays);
      const balanceAfter = this.round(balanceBefore + extraDays);

      balance.acquiredDays = this.round(balance.acquiredDays + extraDays);
      balance.availableDays = balanceAfter;
      await manager.getRepository(LeaveBalance).save(balance);

      const reason =
        `Ancienneté ${employee.legalEntity?.name ?? employee.legalEntity?.code ?? 'entité'} — ` +
        `${years} an(s) révolu(s) au ${referenceDate} → +${extraDays} jour(s) ouvré(s) ` +
        `(source : ${rule.source ?? 'sans convention'}).`;

      const movement = manager.getRepository(BalanceMovement).create({
        employeeId: employee.id,
        employee,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: null,
        leaveRequest: null,
        actorId,
        actor: null,
        movementType: BalanceMovementType.SENIORITY_EXTRA,
        days: extraDays,
        balanceBefore,
        balanceAfter,
        reason,
      });
      await manager.getRepository(BalanceMovement).save(movement);

      await this.auditService.record(
        {
          actorId,
          action: 'SENIORITY_EXTRA_ALLOCATED',
          resourceType: 'LEAVE_BALANCE',
          resourceId: balance.id,
          oldValue: { availableDays: balanceBefore },
          newValue: {
            availableDays: balanceAfter,
            extraDays,
            referenceDate,
            fullYears: years,
            source: rule.source,
          },
        },
        manager,
      );

      return { leaveBalanceId: balance.id };
    });
  }

  private async isAlreadyAllocated(
    employeeId: number,
    referencePeriod: string,
  ): Promise<boolean> {
    const row = await this.dataSource
      .getRepository(BalanceMovement)
      .createQueryBuilder('movement')
      .innerJoin('movement.leaveBalance', 'balance')
      .where('movement.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N,
      })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.SENIORITY_EXTRA,
      })
      .getOne();
    return row !== null;
  }

  private async findEligibleEmployees(): Promise<User[]> {
    return this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.legalEntity', 'legalEntity')
      .where('user.role != :adminRole', { adminRole: UserRole.ADMIN })
      .andWhere('user.hireDate IS NOT NULL')
      .orderBy('user.nom', 'ASC')
      .addOrderBy('user.prenom', 'ASC')
      .getMany();
  }

  private async findOrCreateBalanceForUpdate(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
  ): Promise<LeaveBalance> {
    const repository = manager.getRepository(LeaveBalance);
    await manager.query(
      `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, reserved_days, consumed_days, available_days)
       VALUES (?, ?, ?, 0, 0, 0, 0)
       ON DUPLICATE KEY UPDATE id = id`,
      [employeeId, referencePeriod, LeaveBalanceCounterType.N],
    );

    const balance = await repository
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N,
      })
      .getOne();

    if (!balance) {
      throw new BadRequestException(
        'Impossible de créer ou de verrouiller le compteur de solde.',
      );
    }
    return balance;
  }

  private parseConfig(raw: string): SeniorityExtraDaysConfig {
    let parsed: Partial<SeniorityExtraDaysConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<SeniorityExtraDaysConfig>;
    } catch {
      throw new BadRequestException(
        'SENIORITY_EXTRA_DAYS_CONFIG doit être un objet JSON valide.',
      );
    }

    const enabled = parsed.enabled === true;
    const referenceMonthDay =
      typeof parsed.referenceMonthDay === 'string' &&
      /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(parsed.referenceMonthDay)
        ? parsed.referenceMonthDay
        : DEFAULT_CONFIG.referenceMonthDay;

    const thresholds = Array.isArray(parsed.thresholds)
      ? parsed.thresholds
          .filter(
            (item): item is SeniorityThreshold =>
              typeof item?.minYears === 'number' &&
              typeof item?.extraDays === 'number' &&
              item.minYears >= 0 &&
              item.extraDays >= 0,
          )
          .map((item) => ({
            minYears: Math.trunc(item.minYears),
            extraDays: Math.round(item.extraDays * 100) / 100,
          }))
      : [...DEFAULT_THRESHOLDS];

    if (thresholds.length === 0) {
      throw new BadRequestException(
        'SENIORITY_EXTRA_DAYS_CONFIG.thresholds ne doit pas être vide.',
      );
    }

    const legalEntityCodes = Array.isArray(parsed.legalEntityCodes)
      ? parsed.legalEntityCodes.filter(
          (code): code is string =>
            typeof code === 'string' && code.trim().length > 0,
        ).map((code) => code.trim().toUpperCase())
      : [];

    return { enabled, referenceMonthDay, thresholds, legalEntityCodes };
  }

  private validateReferencePeriod(referencePeriod: string): void {
    // Lève si le format AAAA-AAAA est invalide.
    parseReferencePeriod(referencePeriod);
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
