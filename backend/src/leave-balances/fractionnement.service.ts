import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { withDeadlockRetry } from '../common/deadlock-retry.util';
import { HolidaysService } from '../holidays/holidays.service';
import {
  LegalEntityConventionType,
} from '../legal-entities/legal-entity.entity';
import { resolveFractionnementRule } from './convention-rules.util';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole } from '../users/user.entity';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import {
  buildFractionnementDayList,
  computeFractionnement,
  defaultMainLeaveCapForRegime,
  defaultThresholdsForRegime,
  type FractionnementDay,
  type FractionnementRegime,
  type FractionnementThresholds,
} from './fractionnement.util';
import {
  calculateDeductedLeaveDayList,
  sumDatedDays,
  type DatedLeaveDay,
} from './carryover-allocation.core';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import {
  BalanceProcessingStatus,
  LeaveClassification,
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import {
  parseReferencePeriod,
} from './reference-period.util';

export interface FractionnementEntityConfig {
  code: string;
  regime: FractionnementRegime | 'NONE';
  oneDayMin?: number;
  twoDaysMin?: number;
  mainLeaveCap?: number;
}

export interface FractionnementConfig {
  eligiblePeriodStart: string;
  eligiblePeriodEnd: string;
  entities: FractionnementEntityConfig[];
}

export interface FractionnementPreviewItem {
  employeeId: number;
  nom: string;
  prenom: string;
  legalEntityCode: string | null;
  regime: FractionnementRegime | 'NONE';
  outsidePeriodDays: number;
  mainLeaveDays: number;
  fifthWeekDays: number;
  bonusDays: number;
  currentAllocated: number;
  uncertainRequests: number;
  applicable: boolean;
  skipReason: string | null;
}

export interface FractionnementApplyResult {
  referencePeriod: string;
  allocated: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    legalEntityCode: string | null;
    regime: FractionnementRegime;
    bonusDays: number;
    leaveBalanceId: number;
  }>;
  skipped: Array<{
    employeeId: number;
    nom: string;
    prenom: string;
    reason: string;
  }>;
}

const DEFAULT_CONFIG: FractionnementConfig = {
  eligiblePeriodStart: '05-01',
  eligiblePeriodEnd: '10-31',
  entities: [],
};

@Injectable()
export class FractionnementService {
  private readonly logger = new Logger(FractionnementService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly holidaysService: HolidaysService,
  ) {}

  async getConfig(): Promise<FractionnementConfig> {
    const raw = await this.settingsService.getValue('FRACTIONNEMENT_CONFIG');
    if (!raw) {
      return { ...DEFAULT_CONFIG, entities: [] };
    }
    return this.parseConfig(raw);
  }

  async updateConfig(
    config: FractionnementConfig,
    actorId: number,
  ): Promise<FractionnementConfig> {
    const normalized = this.parseConfig(JSON.stringify(config));
    await this.settingsService.upsertInternal(
      'FRACTIONNEMENT_CONFIG',
      JSON.stringify(normalized),
      'Fractionnement des congés payés (Syntec 5.1 / L3141-23) — configuration RH.',
      actorId,
    );
    await this.auditService.record({
      actorId,
      action: 'FRACTIONNEMENT_CONFIG_UPDATED',
      resourceType: 'SETTINGS',
      resourceId: null,
      newValue: { config: normalized },
    });
    return normalized;
  }

  entityConfigFor(
    employee: Pick<User, 'legalEntity'>,
    config: FractionnementConfig,
  ): FractionnementEntityConfig | null {
    const code = employee.legalEntity?.code ?? null;
    if (!code) return null;
    const configured =
      config.entities.find((item) => item.code === code) ?? null;
    if (!configured) return null;

    // JUR-024 : le régime effectif est déterminé par la convention enregistrée.
    // Une configuration contradictoire (ex. SYNTEC pour une entité sans
    // convention Syntec) bloque tout calcul automatique.
    const convention =
      employee.legalEntity?.conventionType ??
      LegalEntityConventionType.NON_RENSEIGNEE;
    const rule = resolveFractionnementRule(convention, configured.regime);
    if (rule.contradiction) {
      this.logger.warn(
        `Fractionnement : configuration contradictoire pour l'entité ${code} (convention ${convention}, régime configuré ${configured.regime}) — aucun calcul automatique.`,
      );
      return null;
    }
    return { ...configured, regime: rule.regime };
  }

  thresholdsFor(entity: FractionnementEntityConfig): FractionnementThresholds {
    if (entity.regime === 'NONE') {
      return defaultThresholdsForRegime('LEGAL');
    }
    const base = defaultThresholdsForRegime(entity.regime);
    return {
      oneDayMin: entity.oneDayMin ?? base.oneDayMin,
      twoDaysMin: entity.twoDaysMin ?? base.twoDaysMin,
    };
  }

  mainLeaveCapFor(entity: FractionnementEntityConfig): number {
    if (entity.regime === 'NONE') {
      return defaultMainLeaveCapForRegime('LEGAL');
    }
    return entity.mainLeaveCap ?? defaultMainLeaveCapForRegime(entity.regime);
  }

  async preview(
    referencePeriod: string,
  ): Promise<FractionnementPreviewItem[]> {
    const config = await this.getConfig();
    const employees = await this.findEligibleEmployees();
    const items: FractionnementPreviewItem[] = [];

    for (const employee of employees) {
      const entity = this.entityConfigFor(employee, config);
      const applicable =
        entity !== null && entity.regime !== 'NONE';
      const skipReason = !applicable
        ? 'ENTITE_NON_CONCERNEE'
        : null;

      if (!applicable) {
        items.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          legalEntityCode: employee.legalEntity?.code ?? null,
          regime: entity?.regime ?? 'NONE',
          outsidePeriodDays: 0,
          mainLeaveDays: 0,
          fifthWeekDays: 0,
          bonusDays: 0,
          currentAllocated: await this.currentAllocated(
            employee.id,
            referencePeriod,
          ),
          uncertainRequests: 0,
          applicable: false,
          skipReason,
        });
        continue;
      }

      const computation = await this.computeForEmployee(
        employee,
        referencePeriod,
        entity,
        config,
      );
      items.push({
        employeeId: employee.id,
        nom: employee.nom,
        prenom: employee.prenom,
        legalEntityCode: employee.legalEntity?.code ?? null,
        regime: entity.regime,
        outsidePeriodDays: computation.outsidePeriodDays,
        mainLeaveDays: computation.mainLeaveDays,
        fifthWeekDays: computation.fifthWeekDays,
        bonusDays: computation.bonusDays,
        currentAllocated: computation.currentAllocated,
        uncertainRequests: computation.uncertainRequests,
        applicable: true,
        skipReason: null,
      });
    }

    return items;
  }

  async apply(
    referencePeriod: string,
    actorId: number,
  ): Promise<FractionnementApplyResult> {
    this.validateReferencePeriod(referencePeriod);
    const config = await this.getConfig();
    const employees = await this.findEligibleEmployees();
    const result: FractionnementApplyResult = {
      referencePeriod,
      allocated: [],
      skipped: [],
    };

    for (const employee of employees) {
      const entity = this.entityConfigFor(employee, config);
      if (!entity || entity.regime === 'NONE') {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'ENTITE_NON_CONCERNEE',
        });
        continue;
      }

      const computation = await this.computeForEmployee(
        employee,
        referencePeriod,
        entity,
        config,
      );

      if (computation.alreadyAllocated) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'DEJA_ATTRIBUE',
        });
        continue;
      }

      if (computation.uncertainRequests > 0) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'INCERTITUDE_VERIFICATION_RH',
        });
        continue;
      }

      if (computation.bonusDays <= 0) {
        result.skipped.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: 'AUCUN_DROIT',
        });
        continue;
      }

      const leaveBalanceId = await withDeadlockRetry(
        () =>
          this.allocate(
            employee,
            referencePeriod,
            computation,
            actorId,
          ),
        { label: `fractionnement ${employee.id}` },
      );

      result.allocated.push({
        employeeId: employee.id,
        nom: employee.nom,
        prenom: employee.prenom,
        legalEntityCode: employee.legalEntity?.code ?? null,
        regime: entity.regime,
        bonusDays: computation.bonusDays,
        leaveBalanceId,
      });
    }

    return result;
  }

  /**
   * Recalcule le droit de fractionnement après annulation/modification d'un
   * congé. Applique un ajustement (positif ou négatif) tracé par rapport au
   * droit déjà attribué. À appeler dans la transaction d'annulation.
   */
  async recomputeForEmployee(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
    actorId: number,
  ): Promise<void> {
    const config = await this.getConfig();

    // Verrouiller le compteur AVANT TOUTE lecture cohérente de la transaction :
    // deux recalculs concurrents sont ainsi sérialisés sur le verrou, et le
    // second (dont le snapshot est établi après le verrou) voit l'ajustement du
    // premier → delta nul, aucune double écriture.
    const balance = await this.findOrCreateBalanceForUpdate(
      manager,
      employeeId,
      referencePeriod,
    );

    const employee = await manager
      .getRepository(User)
      .findOne({ where: { id: employeeId }, relations: { legalEntity: true } });
    if (!employee) return;

    const entity = this.entityConfigFor(employee, config);
    if (!entity || entity.regime === 'NONE') return;

    const computation = await this.computeBonusForEmployee(
      employee,
      referencePeriod,
      entity,
      config,
      manager,
    );
    // Tant qu'une incertitude de répartition existe, aucune régularisation
    // automatique n'est effectuée (ni à la hausse ni à la baisse).
    if (computation.uncertainRequests > 0) return;

    const current = await this.currentAllocated(
      employee.id,
      referencePeriod,
      manager,
    );
    const delta = this.round(computation.bonusDays - current);
    if (delta === 0) return;

    const balanceBefore = this.round(balance.availableDays);
    const balanceAfter = this.round(balanceBefore + delta);

    balance.acquiredDays = this.round(balance.acquiredDays + delta);
    balance.availableDays = balanceAfter;
    await manager.getRepository(LeaveBalance).save(balance);

    const reason =
      delta > 0
        ? `Fractionnement recalculé : ${current} → ${computation.bonusDays} jour(s) (congés hors période pris en compte).`
        : `Fractionnement recalculé après annulation/modification : ${current} → ${computation.bonusDays} jour(s).`;

    await manager.getRepository(BalanceMovement).save(
      manager.getRepository(BalanceMovement).create({
        employeeId,
        employee,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: null,
        leaveRequest: null,
        actorId,
        actor: null,
        movementType: BalanceMovementType.FRACTIONNEMENT,
        days: delta,
        balanceBefore,
        balanceAfter,
        reason,
      }),
    );

    await this.auditService.record(
      {
        actorId,
        action: 'FRACTIONNEMENT_RECALCULATED',
        resourceType: 'LEAVE_BALANCE',
        resourceId: balance.id,
        oldValue: { allocated: current },
        newValue: { allocated: computation.bonusDays, delta },
      },
      manager,
    );
  }

  /** Recalcul en masse pour une période (action RH manuelle). */
  async recomputeAll(
    referencePeriod: string,
    actorId: number,
  ): Promise<{
    referencePeriod: string;
    adjusted: Array<{ employeeId: number; nom: string; prenom: string }>;
    unchanged: number;
  }> {
    this.validateReferencePeriod(referencePeriod);
    const config = await this.getConfig();
    const employees = await this.findEligibleEmployees();
    const adjusted: Array<{
      employeeId: number;
      nom: string;
      prenom: string;
    }> = [];
    let unchanged = 0;

    for (const employee of employees) {
      const entity = this.entityConfigFor(employee, config);
      if (!entity || entity.regime === 'NONE') {
        unchanged += 1;
        continue;
      }

      const before = await this.currentAllocated(employee.id, referencePeriod);
      await withDeadlockRetry(
        () =>
          this.dataSource.transaction(async (manager) => {
            await this.recomputeForEmployee(
              manager,
              employee.id,
              referencePeriod,
              actorId,
            );
          }),
        { label: `fractionnement-recalc ${employee.id}` },
      );
      const after = await this.currentAllocated(employee.id, referencePeriod);
      if (after !== before) {
        adjusted.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
        });
      } else {
        unchanged += 1;
      }
    }

    return { referencePeriod, adjusted, unchanged };
  }

  private async computeBonusForEmployee(
    employee: User,
    referencePeriod: string,
    entity: FractionnementEntityConfig,
    config: FractionnementConfig,
    manager?: EntityManager,
  ): Promise<{
    outsidePeriodDays: number;
    mainLeaveDays: number;
    fifthWeekDays: number;
    bonusDays: number;
    uncertainRequests: number;
  }> {
    const { days, uncertainRequests } = await this.buildMainLeaveDays(
      employee,
      referencePeriod,
      entity.regime,
      manager,
    );
    const flaggedFifthWeekDays = await this.buildFifthWeekDays(
      employee,
      referencePeriod,
      entity.regime,
      manager,
    );
    const result = computeFractionnement({
      regime: entity.regime as FractionnementRegime,
      days,
      eligiblePeriodStart: config.eligiblePeriodStart,
      eligiblePeriodEnd: config.eligiblePeriodEnd,
      mainLeaveCap: this.mainLeaveCapFor(entity),
      thresholds: this.thresholdsFor(entity),
    });

    return {
      outsidePeriodDays: result.outsidePeriodDays,
      mainLeaveDays: this.round(
        result.mainLeaveDays.reduce((s, d) => s + d.value, 0),
      ),
      fifthWeekDays: this.round(
        result.fifthWeekDays.reduce((s, d) => s + d.value, 0) +
          flaggedFifthWeekDays.reduce((s, d) => s + d.value, 0),
      ),
      // Tant qu'une incertitude de répartition existe, aucun bonus ne peut être
      // attribué automatiquement (même partiel).
      bonusDays: uncertainRequests > 0 ? 0 : result.bonusDays,
      uncertainRequests,
    };
  }

  private async computeForEmployee(
    employee: User,
    referencePeriod: string,
    entity: FractionnementEntityConfig,
    config: FractionnementConfig,
    manager?: EntityManager,
  ): Promise<{
    outsidePeriodDays: number;
    mainLeaveDays: number;
    fifthWeekDays: number;
    bonusDays: number;
    uncertainRequests: number;
    currentAllocated: number;
    alreadyAllocated: boolean;
  }> {
    const computation = await this.computeBonusForEmployee(
      employee,
      referencePeriod,
      entity,
      config,
      manager,
    );
    const currentAllocated = await this.currentAllocated(
      employee.id,
      referencePeriod,
      manager,
    );
    const alreadyAllocated = await this.hasAllocation(
      employee.id,
      referencePeriod,
      manager,
    );

    return {
      ...computation,
      currentAllocated,
      alreadyAllocated,
    };
  }

  private async buildMainLeaveDays(
    employee: User,
    referencePeriod: string,
    regime: FractionnementRegime | 'NONE',
    manager: EntityManager | undefined,
  ): Promise<{ days: FractionnementDay[]; uncertainRequests: number }> {
    const requests = await this.fetchMainRequests(
      employee,
      manager,
      LeaveClassification.MAIN,
    );
    if (requests.length === 0) return { days: [], uncertainRequests: 0 };

    const { nDebitByRequest, nMinus1DebitByRequest } = await this.fetchDebits(
      requests,
      referencePeriod,
      manager,
    );

    const allDays: FractionnementDay[] = [];
    let uncertainRequests = 0;

    for (const request of requests) {
      const nDays = nDebitByRequest.get(request.id) ?? 0;
      const nMinus1Days = nMinus1DebitByRequest.get(request.id) ?? 0;

      // Entièrement reportée (N-1) → période antérieure, non comptée ici.
      if (nDays <= 0) continue;

      const holidays = await this.holidaysService.findNonDeductibleBetween(
        request.startDate,
        request.endDate,
      );
      // Journées datées dans l'UNITÉ DE DÉCOMPTE de l'application (identique
      // aux mouvements DEDUCTION) : aucune conversion, somme exacte attendue.
      const appDays = calculateDeductedLeaveDayList(
        request.startDate,
        request.endDate,
        request.startPeriod,
        request.endPeriod,
        new Set(holidays.map((holiday) => holiday.date)),
      );
      const totalApp = sumDatedDays(appDays);
      const expected = this.round(Number(request.deductedDays));
      const debits = this.round(nDays + nMinus1Days);

      // Reconstruction certaine exigée : somme datée == deductedDays == N+N-1.
      // Sinon (jours fériés modifiés, historique non reconstituable) → signalée
      // pour vérification RH, jamais d'attribution automatique incertaine.
      if (
        Math.abs(totalApp - expected) > 0.001 ||
        Math.abs(debits - expected) > 0.001
      ) {
        uncertainRequests += 1;
        continue;
      }

      // N finance les DERNIERS jours (N-1 consommé d'abord) — jours entiers/demis.
      const nAppDays = this.takeLastDays(appDays, nDays);
      allDays.push(...this.toRegimeDays(nAppDays, regime));
    }

    return {
      days: allDays.sort((a, b) => a.date.localeCompare(b.date)),
      uncertainRequests,
    };
  }

  private async buildFifthWeekDays(
    employee: User,
    referencePeriod: string,
    regime: FractionnementRegime | 'NONE',
    manager: EntityManager | undefined,
  ): Promise<FractionnementDay[]> {
    const requests = await this.fetchMainRequests(
      employee,
      manager,
      LeaveClassification.FIFTH_WEEK,
    );
    const allDays: FractionnementDay[] = [];
    const includeSaturdays = regime !== 'SYNTEC';
    for (const request of requests) {
      const holidays = await this.holidaysService.findNonDeductibleBetween(
        request.startDate,
        request.endDate,
      );
      allDays.push(
        ...buildFractionnementDayList(
          request.startDate,
          request.endDate,
          request.startPeriod,
          request.endPeriod,
          new Set(holidays.map((holiday) => holiday.date)),
          includeSaturdays,
        ),
      );
    }
    return allDays.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async fetchMainRequests(
    employee: User,
    manager: EntityManager | undefined,
    classification: LeaveClassification,
  ): Promise<LeaveRequest[]> {
    const repository = manager
      ? manager.getRepository(LeaveRequest)
      : this.dataSource.getRepository(LeaveRequest);
    return repository
      .createQueryBuilder('leaveRequest')
      .innerJoin('leaveRequest.leaveType', 'leaveType')
      .where('leaveRequest.employeeId = :employeeId', {
        employeeId: employee.id,
      })
      .andWhere('leaveType.deductsPaidLeaveBalance = :deducts', {
        deducts: true,
      })
      .andWhere('leaveRequest.balanceProcessingStatus = :status', {
        status: BalanceProcessingStatus.DEFINITIF,
      })
      .andWhere('leaveRequest.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [
          LeaveRequestStatus.ANNULEE,
          LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
        ],
      })
      .andWhere('leaveRequest.classification = :classification', {
        classification,
      })
      .getMany();
  }

  private async fetchDebits(
    requests: LeaveRequest[],
    referencePeriod: string,
    manager: EntityManager | undefined,
  ): Promise<{
    nDebitByRequest: Map<number, number>;
    nMinus1DebitByRequest: Map<number, number>;
  }> {
    const movementRepository = manager
      ? manager.getRepository(BalanceMovement)
      : this.dataSource.getRepository(BalanceMovement);
    const rows = await movementRepository
      .createQueryBuilder('movement')
      .innerJoin('movement.leaveBalance', 'balance')
      .select('movement.leaveRequestId', 'leaveRequestId')
      .addSelect('balance.counterType', 'counterType')
      .addSelect('COALESCE(SUM(movement.days), 0)', 'days')
      .where('movement.leaveRequestId IN (:...requestIds)', {
        requestIds: requests.map((request) => request.id),
      })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType IN (:...counterTypes)', {
        counterTypes: [
          LeaveBalanceCounterType.N,
          LeaveBalanceCounterType.N_MINUS_1,
        ],
      })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.DEDUCTION,
      })
      .groupBy('movement.leaveRequestId')
      .addGroupBy('balance.counterType')
      .getRawMany<{
        leaveRequestId: number;
        counterType: string;
        days: string;
      }>();

    const nDebitByRequest = new Map<number, number>();
    const nMinus1DebitByRequest = new Map<number, number>();
    for (const row of rows) {
      const debit = this.round(Number(row.days));
      if (row.counterType === LeaveBalanceCounterType.N) {
        nDebitByRequest.set(Number(row.leaveRequestId), debit);
      } else if (row.counterType === LeaveBalanceCounterType.N_MINUS_1) {
        nMinus1DebitByRequest.set(Number(row.leaveRequestId), debit);
      }
    }
    return { nDebitByRequest, nMinus1DebitByRequest };
  }

  /** Conserve les DERNIERS jours (jusqu'à `targetValue`) d'une liste triée. */
  private takeLastDays(
    days: readonly DatedLeaveDay[],
    targetValue: number,
  ): DatedLeaveDay[] {
    let remaining = this.round(targetValue);
    const result: DatedLeaveDay[] = [];
    for (let index = days.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const day = days[index];
      const take = this.round(Math.min(day.value, remaining));
      result.unshift({ date: day.date, value: take });
      remaining = this.round(remaining - take);
    }
    return result;
  }

  /** Convertit des journées (unité application) vers l'unité juridique du régime. */
  private toRegimeDays(
    days: readonly DatedLeaveDay[],
    regime: FractionnementRegime | 'NONE',
  ): FractionnementDay[] {
    if (regime !== 'SYNTEC') {
      return days.map((day) => ({ date: day.date, value: day.value }));
    }
    // Syntec (jours ouvrés) : exclut les samedis.
    return days
      .filter((day) => new Date(`${day.date}T00:00:00.000Z`).getUTCDay() !== 6)
      .map((day) => ({ date: day.date, value: day.value }));
  }

  private async allocate(
    employee: User,
    referencePeriod: string,
    computation: {
      bonusDays: number;
      outsidePeriodDays: number;
    },
    actorId: number,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.findOrCreateBalanceForUpdate(
        manager,
        employee.id,
        referencePeriod,
      );

      const existing = await manager.getRepository(BalanceMovement).findOne({
        where: {
          leaveBalanceId: balance.id,
          movementType: BalanceMovementType.FRACTIONNEMENT,
        },
      });
      if (existing) {
        throw new BadRequestException(
          'Le fractionnement a déjà été attribué pour cette période.',
        );
      }

      const balanceBefore = this.round(balance.availableDays);
      const balanceAfter = this.round(balanceBefore + computation.bonusDays);
      balance.acquiredDays = this.round(
        balance.acquiredDays + computation.bonusDays,
      );
      balance.availableDays = balanceAfter;
      await manager.getRepository(LeaveBalance).save(balance);

      const convention =
        employee.legalEntity?.conventionType ??
        LegalEntityConventionType.NON_RENSEIGNEE;
      const rule = resolveFractionnementRule(convention);
      const reason =
        `Fractionnement ${employee.legalEntity?.code ?? 'entité'} — ` +
        `${this.formatDays(computation.outsidePeriodDays)} jour(s) éligible(s) ` +
        `hors période → +${computation.bonusDays} jour(s) ` +
        `(source : ${rule.source}).`;

      await manager.getRepository(BalanceMovement).save(
        manager.getRepository(BalanceMovement).create({
          employeeId: employee.id,
          employee,
          leaveBalanceId: balance.id,
          leaveBalance: balance,
          leaveRequestId: null,
          leaveRequest: null,
          actorId,
          actor: null,
          movementType: BalanceMovementType.FRACTIONNEMENT,
          days: computation.bonusDays,
          balanceBefore,
          balanceAfter,
          reason,
        }),
      );

      await this.auditService.record(
        {
          actorId,
          action: 'FRACTIONNEMENT_ALLOCATED',
          resourceType: 'LEAVE_BALANCE',
          resourceId: balance.id,
          oldValue: { availableDays: balanceBefore },
          newValue: {
            availableDays: balanceAfter,
            bonusDays: computation.bonusDays,
            source: rule.source,
          },
        },
        manager,
      );

      return balance.id;
    });
  }

  private async currentAllocated(
    employeeId: number,
    referencePeriod: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(BalanceMovement)
      : this.dataSource.getRepository(BalanceMovement);
    const row = await repository
      .createQueryBuilder('movement')
      .innerJoin('movement.leaveBalance', 'balance')
      .select('COALESCE(SUM(movement.days), 0)', 'total')
      .where('movement.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N,
      })
      .andWhere('movement.movementType = :movementType', {
        movementType: BalanceMovementType.FRACTIONNEMENT,
      })
      .getRawOne<{ total: string }>();
    return this.round(Number(row?.total ?? 0));
  }

  private async hasAllocation(
    employeeId: number,
    referencePeriod: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = manager
      ? manager.getRepository(BalanceMovement)
      : this.dataSource.getRepository(BalanceMovement);
    const row = await repository
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
        movementType: BalanceMovementType.FRACTIONNEMENT,
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

  private parseConfig(raw: string): FractionnementConfig {
    let parsed: Partial<FractionnementConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<FractionnementConfig>;
    } catch {
      throw new BadRequestException(
        'FRACTIONNEMENT_CONFIG doit être un objet JSON valide.',
      );
    }

    const validMonthDay = (value: unknown): boolean =>
      typeof value === 'string' &&
      /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);

    const eligiblePeriodStart = validMonthDay(parsed.eligiblePeriodStart)
      ? (parsed.eligiblePeriodStart as string)
      : DEFAULT_CONFIG.eligiblePeriodStart;
    const eligiblePeriodEnd = validMonthDay(parsed.eligiblePeriodEnd)
      ? (parsed.eligiblePeriodEnd as string)
      : DEFAULT_CONFIG.eligiblePeriodEnd;

    const entities: FractionnementEntityConfig[] = Array.isArray(
      parsed.entities,
    )
      ? parsed.entities
          .filter(
            (item): item is FractionnementEntityConfig =>
              typeof item?.code === 'string' &&
              item.code.trim().length > 0 &&
              ['SYNTEC', 'LEGAL', 'NONE'].includes(item.regime),
          )
          .map((item) => ({
            code: item.code.trim().toUpperCase(),
            regime: item.regime,
            oneDayMin:
              typeof item.oneDayMin === 'number' && item.oneDayMin > 0
                ? Math.round(item.oneDayMin * 100) / 100
                : undefined,
            twoDaysMin:
              typeof item.twoDaysMin === 'number' && item.twoDaysMin > 0
                ? Math.round(item.twoDaysMin * 100) / 100
                : undefined,
            mainLeaveCap:
              typeof item.mainLeaveCap === 'number' && item.mainLeaveCap > 0
                ? Math.round(item.mainLeaveCap * 100) / 100
                : undefined,
          }))
      : [];

    return { eligiblePeriodStart, eligiblePeriodEnd, entities };
  }

  private validateReferencePeriod(referencePeriod: string): void {
    parseReferencePeriod(referencePeriod);
  }

  private formatDays(days: number): string {
    return days
      .toFixed(2)
      .replace(/0+$/, '')
      .replace(/\.$/, '')
      .replace('.', ',');
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
