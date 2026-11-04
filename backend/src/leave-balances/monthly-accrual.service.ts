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
  LegalEntity,
  LegalEntityConventionType,
  IllnessWageMaintenance,
} from '../legal-entities/legal-entity.entity';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import { currentReferencePeriod } from './reference-period.util';
import {
  AbsenceBreakdown,
  classifyAbsenceKind,
  computeMonthCredit,
  MonthCreditResult,
  roundCredit,
} from './monthly-credit.util';
import { LeaveTypeAbsenceKind } from '../leave-types/leave-type.entity';
import {
  AccrualAnomalyService,
} from './accrual-anomaly.service';
import { AccrualAnomalyType } from './accrual-anomaly.entity';

/**
 * Date d'entrée en vigueur des règles actuelles (loi 2024-364, L3141-5/-5-1).
 * Les mois antérieurs ne sont PAS crédités automatiquement avec ces règles
 * lorsque le mois comporte de la maladie non professionnelle ou de l'AT/MP
 * (traitement historique/transitoire → validation RH requise).
 */
const CURRENT_RULES_EFFECTIVE_DATE = '2024-04-24';

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

interface MonthlyPresence {
  daysPresent: number;
  daysInMonth: number;
  /** Première date de présence contractuelle dans le mois (AAAA-MM-JJ). */
  startDate: string;
  /** Dernière date de présence contractuelle dans le mois (AAAA-MM-JJ). */
  endDate: string;
  /** Jours travaillés ou assimilés (hors maladie non professionnelle). */
  workedDays?: number;
  /** Jours de maladie non professionnelle (L3141-5-1). */
  illnessDays?: number;
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
    private readonly accrualAnomalyService: AccrualAnomalyService,
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
    const legalEntities = await this.loadLegalEntities();
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
      const computed = await this.computeEmployeeMonth(
        employee,
        monthInformation,
        daysPerEmployee,
        legalEntities,
      );

      if (!computed) {
        continue;
      }

      // Signalements RH (jamais bloquants pour le socle légal).
      if (computed.breakdown.conflictDays > 0) {
        result.manualReviewRequired.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: `Chevauchement d'absences de natures contradictoires (${computed.breakdown.conflictDays} j en ${monthInformation.monthLabel} ${monthInformation.year}) : résolution RH requise, aucune classification arbitraire.`,
        });
      }
      if (computed.breakdown.historicalPendingDays > 0) {
        result.manualReviewRequired.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: `Jours antérieurs au 24/04/2024 (maladie non professionnelle ou AT/MP) (${computed.breakdown.historicalPendingDays} j en ${monthInformation.monthLabel} ${monthInformation.year}) : acquisition historique à valider par la RH (art. 37 II loi 2024-364).`,
        });
      }
      if (computed.breakdown.unclassifiedDays > 0) {
        result.manualReviewRequired.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: `Absence(s) non classifiée(s) (${computed.breakdown.unclassifiedDays} j en ${monthInformation.monthLabel} ${monthInformation.year}) : décision RH requise sur leur nature juridique avant de considérer le droit comme définitif.`,
        });
      }
      if (computed.regime.requiresRhDecision && computed.breakdown.illnessDays > 0) {
        result.manualReviewRequired.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: computed.regime.reason,
        });
      }

      // Anomalies persistantes (chevauchements, historiques) : ouvertes ou
      // résolues selon les jours réellement concernés.
      await this.reconcileAnomalies(
        employee.id,
        monthInformation,
        computed.breakdown,
      );

      if (computed.days <= 0) {
        continue;
      }

      const employeeResult = await this.processEmployeeAccrual({
        employee,
        monthInformation,
        days: computed.days,
        actorId,
        presence: {
          ...computed.presence,
          workedDays: computed.credit.workedDays,
          illnessDays: computed.credit.illnessDays,
        },
        illnessDays: computed.cappedIllnessCredit,
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
      } else if (employeeResult.status === 'AMBIGUOUS_LEGACY') {
        result.manualReviewRequired.push({
          employeeId: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          reason: `Ancien mouvement d'acquisition sans mois identifiable : rattachement contrôlé requis avant tout nouveau crédit (${monthInformation.monthLabel} ${monthInformation.year}).`,
        });
        await this.accrualAnomalyService.reconcile({
          employeeId: employee.id,
          type: AccrualAnomalyType.AMBIGUOUS_LEGACY,
          referencePeriod: monthInformation.referencePeriod,
          accrualMonth: monthInformation.accrualMonth,
          days: 1,
          detail: `Ancien mouvement d'acquisition sans mois identifiable (${monthInformation.monthLabel} ${monthInformation.year}).`,
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

  /**
   * JUR-025/037 — calcul du crédit d'un salarié pour un mois donné, SANS
   * écriture. Réutilisé par l'acquisition mensuelle et la régularisation afin
   * qu'il n'existe qu'une seule formule de calcul.
   */
  private async computeEmployeeMonth(
    employee: User,
    monthInformation: MonthInformation,
    daysPerEmployee: number,
    legalEntities: Map<number, LegalEntity>,
  ): Promise<{
    presence: MonthlyPresence;
    breakdown: AbsenceBreakdown;
    regime: { requiresRhDecision: boolean; reason: string };
    credit: MonthCreditResult;
    cappedIllnessCredit: number;
    days: number;
  } | null> {
    const presence = this.computePresence(
      employee.hireDate,
      employee.exitDate,
      monthInformation,
    );
    if (!presence) return null;

    const breakdown = await this.computeAbsenceBreakdown(
      employee.id,
      monthInformation,
      presence,
    );
    const legalEntity = employee.legalEntityId
      ? legalEntities.get(employee.legalEntityId)
      : undefined;
    const regime = this.resolveUncoveredIllnessSignal(legalEntity);

    // JUR-025/037 — les jours historiques (avant le 24/04/2024) maladie/AT-MP
    // sont déjà isolés dans breakdown.historicalPendingDays (exclus de
    // l'automatique). Les jours de travail et assimilés certains restent crédités.
    const credit = this.computeMonthCredit(
      daysPerEmployee,
      presence,
      breakdown,
    );
    const cappedIllnessCredit = await this.capIllnessCredit(
      employee.id,
      monthInformation,
      credit.illnessCredit,
    );
    const days = roundCredit(credit.workedCredit + cappedIllnessCredit);

    return {
      presence,
      breakdown,
      regime,
      credit,
      cappedIllnessCredit,
      days,
    };
  }

  /**
   * JUR-025/037 — anomalies persistantes : chevauchements contradictoires et
   * journées historiques à valider. Réconciliées de façon idempotente (ouvertes
   * si jours > 0, résolues si jours = 0), jamais dupliquées.
   */
  private async reconcileAnomalies(
    employeeId: number,
    monthInformation: MonthInformation,
    breakdown: AbsenceBreakdown,
  ): Promise<void> {
    // Un conflit = une anomalie distincte (scope par conflict_key). Une décision
    // RH ne peut donc pas résoudre implicitement un autre conflit du même mois.
    const currentKeys = Object.keys(breakdown.conflictDaysByKey);
    const existingConflicts: Array<{ conflict_key: string | null }> =
      await this.dataSource.query(
        `SELECT conflict_key
           FROM accrual_anomalies
          WHERE employee_id = ?
            AND type = 'ABSENCE_OVERLAP_CONFLICT'
            AND reference_period = ?
            AND accrual_month = ?`,
        [
          employeeId,
          monthInformation.referencePeriod,
          monthInformation.accrualMonth,
        ],
      );
    const existingKeys = new Set(
      existingConflicts
        .map((row) => row.conflict_key)
        .filter((key): key is string => Boolean(key)),
    );

    for (const [conflictKey, days] of Object.entries(
      breakdown.conflictDaysByKey,
    )) {
      await this.accrualAnomalyService.reconcile({
        employeeId,
        type: AccrualAnomalyType.ABSENCE_OVERLAP_CONFLICT,
        referencePeriod: monthInformation.referencePeriod,
        accrualMonth: monthInformation.accrualMonth,
        conflictKey,
        days,
        detail:
          `Chevauchement d'absences de natures contradictoires (${days} j en ${monthInformation.monthLabel} ${monthInformation.year}).`,
      });
    }

    // Résout les conflits disparus (plus de jour brut pour cette clé).
    for (const key of existingKeys) {
      if (!(key in breakdown.conflictDaysByKey)) {
        await this.accrualAnomalyService.reconcile({
          employeeId,
          type: AccrualAnomalyType.ABSENCE_OVERLAP_CONFLICT,
          referencePeriod: monthInformation.referencePeriod,
          accrualMonth: monthInformation.accrualMonth,
          conflictKey: key,
          days: 0,
          detail: null,
        });
      }
    }
    await this.accrualAnomalyService.reconcile({
      employeeId,
      type: AccrualAnomalyType.HISTORICAL_PENDING,
      referencePeriod: monthInformation.referencePeriod,
      accrualMonth: monthInformation.accrualMonth,
      days: breakdown.historicalPendingDays,
      detail:
        breakdown.historicalPendingDays > 0
          ? `Jours antérieurs au 24/04/2024 à valider (${breakdown.historicalPendingDays} j en ${monthInformation.monthLabel} ${monthInformation.year}). La limite d'un an de l'AT/MP peut être écartée (Cass. soc. 13/09/2023 n° 22-17.638) : aucun droit définitivement supprimé, décision RH requise.`
          : null,
    });
  }

  /**
   * JUR-025/037 — régularisation contrôlée et IDEMPOTENTE d'une période déjà
   * créditée, après création/correction/requalification/annulation d'une
   * absence. Recalcule le droit exact de chaque mois concerné, compare au
   * cumul des mouvements existants (ACQUISITION ± CORRECTION) et ne crée un
   * mouvement de correction que pour l'écart net restant.
   */
  async regularizeAbsenceImpact(
    employeeId: number,
    startDate: string,
    endDate: string,
    actorId: number | null,
  ): Promise<{
    regularizedMonths: string[];
    corrections: Array<{ month: string; delta: number }>;
  }> {
    const referencePeriodStart = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const daysPerEmployee = await this.settingsService.getNumber(
      'MONTHLY_ACCRUAL_RATE',
      2.5,
    );
    const employee = await this.dataSource
      .getRepository(User)
      .findOneBy({ id: employeeId });
    if (!employee) {
      return { regularizedMonths: [], corrections: [] };
    }
    const legalEntities = await this.loadLegalEntities();

    const months = this.enumerateMonths(startDate, endDate);
    const currentDate = this.getMartiniqueDateString(new Date());
    const corrections: Array<{ month: string; delta: number }> = [];
    const regularizedMonths: string[] = [];

    for (const month of months) {
      const monthInformation = this.getMonthInformation(
        month,
        referencePeriodStart,
      );
      if (monthInformation.lastDate > currentDate) {
        // Mois non terminé : pas encore créditable, aucune régularisation.
        continue;
      }

      const computed = await this.computeEmployeeMonth(
        employee,
        monthInformation,
        daysPerEmployee,
        legalEntities,
      );
      if (!computed) {
        continue;
      }

      // Réconcilie les anomalies persistantes (un conflit corrigé ou une
      // absence historique résolue clôture l'anomalie de façon traçable).
      await this.reconcileAnomalies(
        employee.id,
        monthInformation,
        computed.breakdown,
      );

      const correctDays = computed.days;
      const correctedIllnessDays = roundCredit(computed.cappedIllnessCredit);

      const result = await this.regularizeMonth(
        employee,
        monthInformation,
        correctDays,
        correctedIllnessDays,
        actorId,
        computed.breakdown.historicalPendingDays,
        computed.breakdown.legacyMaintainedIllnessDays,
        daysPerEmployee,
      );
      regularizedMonths.push(month);
      if (result.delta !== 0) {
        corrections.push({ month, delta: result.delta });
      }
    }

    return { regularizedMonths, corrections };
  }

  /**
   * JUR-025/037 — recalcule l'état RÉEL d'une anomalie d'acquisition.
   * Retourne `null` lorsque l'état ne peut pas être vérifié de façon fiable
   * (salarié introuvable, période de référence incohérente, présence
   * indéterminable) : une incohérence technique ne doit JAMAIS être
   * interprétée comme « zéro anomalie » et déclencher une clôture VERIFIED.
   */
  async recomputeAnomalyDays(input: {
    employeeId: number;
    type: AccrualAnomalyType;
    referencePeriod: string;
    accrualMonth: string | null;
    conflictKey?: string | null;
  }): Promise<number | null> {
    if (!input.accrualMonth) {
      // Anomalie sans mois (legacy ambigu) : se résout via rattachement RH.
      return input.type === AccrualAnomalyType.AMBIGUOUS_LEGACY ? 1 : null;
    }
    const referencePeriodStart = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const monthInformation = this.getMonthInformation(
      input.accrualMonth,
      referencePeriodStart,
    );
    if (monthInformation.referencePeriod !== input.referencePeriod) {
      // Période de référence incohérente : état non vérifiable.
      return null;
    }

    if (input.type === AccrualAnomalyType.AMBIGUOUS_LEGACY) {
      return this.dataSource.transaction(async (manager) => {
        const { ambiguous } = await this.findMovementsForMonth(
          manager,
          input.employeeId,
          monthInformation,
        );
        return ambiguous ? 1 : 0;
      });
    }

    const employee = await this.dataSource
      .getRepository(User)
      .findOneBy({ id: input.employeeId });
    if (!employee) return null;
    const presence = this.computePresence(
      employee.hireDate,
      employee.exitDate,
      monthInformation,
    );
    if (!presence) return null;
    const breakdown = await this.computeAbsenceBreakdown(
      employee.id,
      monthInformation,
      presence,
    );
    if (input.type === AccrualAnomalyType.ABSENCE_OVERLAP_CONFLICT) {
      // La cause est la contradiction BRUTE (même si une décision RH la gère) :
      // une décision RH ne doit pas faire disparaître l'existence du conflit.
      if (input.conflictKey) {
        return breakdown.conflictDaysByKey[input.conflictKey] ?? 0;
      }
      // Anomalies antérieures au scoping par conflit : total brut du mois.
      return breakdown.rawConflictDays;
    }
    if (input.type === AccrualAnomalyType.HISTORICAL_PENDING) {
      return breakdown.historicalPendingDays;
    }
    return 0;
  }

  /**
   * Compare le droit recalculé au cumul réel des mouvements du mois et applique
   * l'écart net en un seul mouvement CORRECTION (idempotent : relance sans
   * effet si déjà à l'équilibre).
   */
  private async regularizeMonth(
    employee: User,
    monthInformation: MonthInformation,
    correctDays: number,
    correctedIllnessDays: number,
    actorId: number | null,
    historicalPendingDays: number,
    legacyMaintainedIllnessDays: number,
    daysPerEmployee: number,
  ): Promise<{ delta: number; ambiguous: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const movementRepository = manager.getRepository(BalanceMovement);

      // Verrou transactionnel sur le solde AVANT lecture : deux régularisations
      // concurrentes du même mois se sérialisent (idempotence inter-instances).
      const balance = await manager
        .getRepository(LeaveBalance)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.employeeId = :employeeId', { employeeId: employee.id })
        .andWhere('b.referencePeriod = :referencePeriod', {
          referencePeriod: monthInformation.referencePeriod,
        })
        .andWhere('b.counterType = :counterType', {
          counterType: LeaveBalanceCounterType.N,
        })
        .getOne();

      if (!balance) {
        // Aucun solde → aucun mouvement d'acquisition possible → rien à régulariser.
        return { delta: 0, ambiguous: false };
      }

      const { movements, ambiguous } = await this.findMovementsForMonth(
        manager,
        employee.id,
        monthInformation,
      );

      const acquisition = movements.find(
        (m) => m.movementType === BalanceMovementType.ACQUISITION,
      );
      if (!acquisition) {
        // Mois non encore crédité : l'acquisition mensuelle (ou sa relance)
        // s'en chargera. Aucune correction anticipée (évite le double crédit).
        return { delta: 0, ambiguous };
      }

      // Ventilation maladie : la valeur illness_days du mouvement d'acquisition
      // est réalignée sur la situation CORRIGÉE (requalification maladie → AT/MP,
      // etc.), afin que le plafond et les statistiques reflètent le droit net.
      const roundedIllness = roundCredit(correctedIllnessDays);
      if (Number(acquisition.illnessDays ?? 0) !== roundedIllness) {
        acquisition.illnessDays = roundedIllness;
        await movementRepository.save(acquisition);
      }

      const currentTotal = roundCredit(
        movements.reduce((sum, m) => {
          const sign =
            m.movementType === BalanceMovementType.CORRECTION_NEGATIVE
              ? -1
              : 1;
          return sum + sign * m.days;
        }, 0),
      );
      let delta = roundCredit(correctDays - currentTotal);
      if (delta === 0) {
        return { delta: 0, ambiguous };
      }

      // JUR-025 — protection LIMITÉE aux parts indéterminées/protégées :
      //  - jours historiques (règles antérieures) crédités par un mouvement
      //    antérieur (illness_days NULL) ;
      //  - jours dont le maintien ne repose que sur une décision LEGACY_PENDING
      //    (validité indéterminée) : ils ne confèrent aucun droit NOUVEAU mais
      //    ne doivent pas être retirés s'ils avaient déjà été crédités.
      // Une correction négative CERTAINE et démontrée pour une AUTRE cause reste
      // appliquée (la protection ne couvre que la part indéterminée).
      if (delta < 0) {
        let protectedFloor = correctDays;

        if (historicalPendingDays > 0) {
          const acquisitionIsLegacy =
            acquisition.illnessDays === null ||
            acquisition.illnessDays === undefined;
          if (acquisitionIsLegacy) {
            const provisionalValue = roundCredit(
              (historicalPendingDays * daysPerEmployee) /
                Number(monthInformation.lastDate.slice(8, 10)),
            );
            protectedFloor = roundCredit(protectedFloor + provisionalValue);
          }
        }

        if (legacyMaintainedIllnessDays > 0) {
          const legacySupplement = roundCredit(
            ((daysPerEmployee - 2) * legacyMaintainedIllnessDays) /
              Number(monthInformation.lastDate.slice(8, 10)),
          );
          protectedFloor = roundCredit(protectedFloor + legacySupplement);
        }

        if (protectedFloor > correctDays) {
          delta = currentTotal > protectedFloor
            ? roundCredit(protectedFloor - currentTotal)
            : 0;
        }
      }

      if (delta === 0) {
        // Aucune écriture : protection historique ou équilibre déjà atteint.
        return { delta: 0, ambiguous };
      }

      const balanceBefore = this.round(balance.availableDays);
      const balanceAfter = this.round(balanceBefore + delta);

      balance.acquiredDays = this.round(balance.acquiredDays + delta);
      balance.availableDays = balanceAfter;
      await manager.getRepository(LeaveBalance).save(balance);

      const movement = movementRepository.create({
        employeeId: employee.id,
        employee,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: null,
        leaveRequest: null,
        actorId,
        actor: null,
        movementType:
          delta > 0
            ? BalanceMovementType.CORRECTION_POSITIVE
            : BalanceMovementType.CORRECTION_NEGATIVE,
        days: Math.abs(delta),
        balanceBefore,
        balanceAfter,
        accrualMonth: monthInformation.accrualMonth,
        illnessDays: null,
        reason: `Régularisation acquisition ${monthInformation.monthLabel} ${monthInformation.year} après correction d’absence : ${delta > 0 ? '+' : ''}${this.formatDays(delta)} jour(s)`,
        createdAt: new Date(),
      });
      await movementRepository.save(movement);

      return { delta, ambiguous };
    });
  }

  private enumerateMonths(startDate: string, endDate: string): string[] {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const months: string[] = [];
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    );
    while (cursor.getTime() <= end.getTime()) {
      months.push(
        `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, '0')}`,
      );
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    }
    return months;
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
    presence: MonthlyPresence | null;
    illnessDays: number;
  }): Promise<
    | {
        status: 'CREDITED';
        leaveBalanceId: number;
        movementId: number;
      }
    | { status: 'ALREADY_CREDITED' }
    | { status: 'LEGACY_LINKED'; movementId: number }
    | { status: 'AMBIGUOUS_LEGACY' }
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

      const { movements, ambiguous, backfilled } =
        await this.findMovementsForMonth(
          manager,
          data.employee.id,
          data.monthInformation,
        );

      const existingAcquisition = movements.find(
        (m) => m.movementType === BalanceMovementType.ACQUISITION,
      );
      if (existingAcquisition) {
        if (backfilled) {
          return {
            status: 'LEGACY_LINKED' as const,
            movementId: existingAcquisition.id,
          };
        }
        return { status: 'ALREADY_CREDITED' as const };
      }

      if (ambiguous) {
        // Un ancien mouvement d'acquisition sans mois identifiable : ne jamais
        // créditer deux fois — signal RH (rattachement contrôlé requis).
        return { status: 'AMBIGUOUS_LEGACY' as const };
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
        accrualMonth: data.monthInformation.accrualMonth,
        illnessDays: data.illnessDays,
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

  private readonly frenchMonthsNormalized = [
    'janvier',
    'fevrier',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'aout',
    'septembre',
    'octobre',
    'novembre',
    'decembre',
  ];

  /**
   * Extrait le mois + l'année d'un libellé de mouvement UNIQUEMENT si le
   * rattachement est sans ambiguïté (exactement UNE occurrence « mois année »).
   * Renvoie null sinon : aucune déduction arbitraire n'est faite.
   */
  private extractMonthYear(
    reason: string | null,
  ): { month: number; year: number } | null {
    if (!reason) return null;
    const normalized = this.normalizeText(reason);
    const regex =
      /(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/g;
    const matches: Array<{ month: number; year: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const idx = this.frenchMonthsNormalized.indexOf(match[1]);
      if (idx >= 0) {
        matches.push({ month: idx + 1, year: Number(match[2]) });
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Mouvements d'acquisition/correction d'un mois, y compris les anciens
   * mouvements (accrual_month NULL) dont le mois est identifiable sans
   * ambiguïté (rattachement non destructif : backfill de la colonne).
   */
  private async findMovementsForMonth(
    manager: EntityManager,
    employeeId: number,
    monthInformation: MonthInformation,
  ): Promise<{ movements: BalanceMovement[]; ambiguous: boolean; backfilled: boolean }> {
    const movementRepository = manager.getRepository(BalanceMovement);
    const movements = await movementRepository
      .createQueryBuilder('m')
      .where('m.employeeId = :employeeId', { employeeId })
      .andWhere('m.accrualMonth = :month', {
        month: monthInformation.accrualMonth,
      })
      .andWhere('m.movementType IN (:...types)', {
        types: [
          BalanceMovementType.ACQUISITION,
          BalanceMovementType.CORRECTION_POSITIVE,
          BalanceMovementType.CORRECTION_NEGATIVE,
        ],
      })
      .getMany();

    const legacy = await movementRepository
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.leaveBalance', 'b')
      .where('m.employeeId = :employeeId', { employeeId })
      .andWhere('m.accrualMonth IS NULL')
      .andWhere('m.movementType = :type', {
        type: BalanceMovementType.ACQUISITION,
      })
      .getMany();

    let ambiguous = false;
    let backfilled = false;
    for (const movement of legacy) {
      const samePeriod =
        movement.leaveBalance?.referencePeriod ===
        monthInformation.referencePeriod;
      const extracted = this.extractMonthYear(movement.reason);
      if (!extracted) {
        // Mois réellement non identifiable : l'ambiguïté ne bloque que la
        // période de référence concernée (pas les périodes étrangères).
        if (samePeriod) {
          ambiguous = true;
        }
        continue;
      }
      if (
        extracted.year === monthInformation.year &&
        extracted.month === monthInformation.month
      ) {
        // Rattachement sécurisé au mois demandé (pas de double crédit).
        movement.accrualMonth = monthInformation.accrualMonth;
        await movementRepository.save(movement);
        movements.push(movement);
        backfilled = true;
      }
      // Sinon : mouvement clairement rattaché à un AUTRE mois → ignoré, sans
      // signaler d'ambiguïté (il ne concerne pas le mois en cours).
    }

    return { movements, ambiguous, backfilled };
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
    presence: MonthlyPresence | null,
  ): string {
    const usesElision = ['avril', 'août', 'octobre'].includes(
      monthInformation.monthLabel,
    );
    const monthPart = usesElision
      ? `d’${monthInformation.monthLabel}`
      : `de ${monthInformation.monthLabel}`;
    const formattedDays = this.formatDays(days);

    if (presence && presence.illnessDays && presence.illnessDays > 0) {
      return `Acquisition ${monthPart} ${monthInformation.year} : +${formattedDays} jour(s) (travail/assimilé ${presence.workedDays ?? presence.daysPresent}/${presence.daysInMonth}, maladie non professionnelle ${presence.illnessDays} j)`;
    }

    if (presence && presence.daysPresent < presence.daysInMonth) {
      return `Acquisition proratisée ${monthPart} ${monthInformation.year} : +${formattedDays} jour(s) (présence ${presence.daysPresent}/${presence.daysInMonth})`;
    }

    return `Acquisition mensuelle ${monthPart} ${monthInformation.year} : +${formattedDays} jours`;
  }

  private computePresence(
    hireDate: string | null,
    exitDate: string | null,
    monthInformation: MonthInformation,
  ): MonthlyPresence | null {
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

    return {
      daysPresent,
      daysInMonth,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  private computeMonthlyCredit(
    daysPerEmployee: number,
    presence: MonthlyPresence,
  ): number {
    if (presence.daysPresent === presence.daysInMonth) {
      return this.round(daysPerEmployee);
    }

    return this.round(
      (daysPerEmployee * presence.daysPresent) / presence.daysInMonth,
    );
  }

  /**
   * JUR-025/037 — décompte JOURNALIER des absences ENREGISTREES par nature :
   *  - borné à la présence contractuelle réelle du salarié (embauche/sortie) ;
   *  - chaque jour n'est compté qu'UNE fois (pas de double comptage des
   *    chevauchements de déclarations) ;
   *  - maladie non professionnelle SPLIT en jours avec maintien de salaire
   *    (décision RH individuelle) et jours sans maintien (socle légal 2 j/mois).
   */
  private async computeAbsenceBreakdown(
    employeeId: number,
    monthInformation: MonthInformation,
    presence: MonthlyPresence,
  ): Promise<AbsenceBreakdown> {
    const rows: Array<{
      id: number;
      absence_kind: string;
      start_date: string;
      end_date: string;
    }> = await this.dataSource.query(
      `SELECT a.id,
              lt.absence_kind,
              DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date
         FROM absence_declarations a
         INNER JOIN leave_types lt ON lt.id = a.leave_type_id
        WHERE a.employee_id = ?
          AND a.status = 'ENREGISTREE'
          AND a.start_date <= ?
          AND a.end_date >= ?
        ORDER BY a.start_date ASC`,
      [employeeId, monthInformation.lastDate, monthInformation.firstDate],
    );

    const maintenanceRows: Array<{
      start_date: string;
      end_date: string;
      valid_from: string | null;
      valid_to: string | null;
    }> = await this.dataSource.query(
      `SELECT DATE_FORMAT(d.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(d.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(d.basis_valid_from, '%Y-%m-%d') AS valid_from,
              DATE_FORMAT(d.basis_valid_to, '%Y-%m-%d') AS valid_to
         FROM illness_maintenance_decisions d
         LEFT JOIN documents doc ON doc.id = d.basis_document_id
        WHERE d.employee_id = ?
          AND d.is_active = 1
          AND d.basis_validation_status = 'VALIDATED'
          AND d.start_date <= ?
          AND d.end_date >= ?
          AND (d.basis_document_id IS NULL OR (
                doc.status = 'ACCEPTE'
                AND doc.deleted_at IS NULL
                AND doc.verified_by_rh_id IS NOT NULL
              ))
        ORDER BY d.start_date ASC`,
      [employeeId, monthInformation.lastDate, monthInformation.firstDate],
    );

    // Décisions LEGACY_PENDING : elles ne confèrent AUCUN droit nouveau, mais
    // elles protègent un droit déjà crédité avant la structuration.
    const legacyMaintenanceRows: Array<{
      start_date: string;
      end_date: string;
      valid_from: string | null;
      valid_to: string | null;
    }> = await this.dataSource.query(
      `SELECT DATE_FORMAT(d.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(d.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(d.basis_valid_from, '%Y-%m-%d') AS valid_from,
              DATE_FORMAT(d.basis_valid_to, '%Y-%m-%d') AS valid_to
         FROM illness_maintenance_decisions d
         LEFT JOIN documents doc ON doc.id = d.basis_document_id
        WHERE d.employee_id = ?
          AND d.is_active = 1
          AND d.basis_validation_status = 'LEGACY_PENDING'
          AND d.start_date <= ?
          AND d.end_date >= ?
          AND (d.basis_document_id IS NULL OR (
                doc.status = 'ACCEPTE'
                AND doc.deleted_at IS NULL
                AND doc.verified_by_rh_id IS NOT NULL
              ))
        ORDER BY d.start_date ASC`,
      [employeeId, monthInformation.lastDate, monthInformation.firstDate],
    );

    // JUR-025 — pour la limite historique d'un an des AT/MP, il faut la
    // POSITION de chaque journée dans la période continue d'AT/MP (et non la
    // durée totale d'une déclaration). On construit les intervalles continus en
    // fusionnant les déclarations AT/MP adjacentes ou chevauchantes.
    const atMpRows: Array<{ start_date: string; end_date: string }> =
      await this.dataSource.query(
        `SELECT DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date
           FROM absence_declarations a
           INNER JOIN leave_types lt ON lt.id = a.leave_type_id
          WHERE a.employee_id = ?
            AND a.status = 'ENREGISTREE'
            AND lt.absence_kind = 'AT_MP'
          ORDER BY a.start_date ASC`,
        [employeeId],
      );
    const atMpIntervals = this.mergeContinuousIntervals(atMpRows);
    // JUR-025 — la limite historique d'un an s'apprécie par DATE ANNIVERSAIRE
    // (et non par « 365 jours ») : une année commence le jour du début de
    // l'arrêt et s'achève la veille de sa date anniversaire, y compris les
    // années bissextiles et le 29 février. Au-delà, la journée n'est PAS
    // définitivement privée de droits (Cass. soc. 13/09/2023 n° 22-17.638) :
    // elle est isolée comme provisoire (historicalPendingDays) pour décision RH.
    const atMpWithinFirstYear = (date: string): boolean => {
      for (const interval of atMpIntervals) {
        if (date >= interval.start && date <= interval.end) {
          return date < this.addYearsIso(interval.start, 1);
        }
      }
      return false;
    };

    const breakdown: AbsenceBreakdown = {
      illnessDays: 0,
      maintainedIllnessDays: 0,
      legacyMaintainedIllnessDays: 0,
      atMpDays: 0,
      assimilatedDays: 0,
      nonAssimilatedDays: 0,
      unclassifiedDays: 0,
      conflictDays: 0,
      rawConflictDays: 0,
      conflictDaysByKey: {},
      historicalPendingDays: 0,
    };

    const isMaintained = (date: string): boolean =>
      maintenanceRows.some((m) => {
        const lo = m.valid_from && m.valid_from > m.start_date
          ? m.valid_from
          : m.start_date;
        const hi = m.valid_to && m.valid_to < m.end_date
          ? m.valid_to
          : m.end_date;
        return date >= lo && date <= hi;
      });

    // Maintien dont la validité est INDÉTERMINÉE (décision antérieure) : non
    // crédité automatiquement, mais suivi pour protéger un droit déjà acquis.
    const isLegacyMaintained = (date: string): boolean =>
      legacyMaintenanceRows.some((m) => {
        const lo = m.valid_from && m.valid_from > m.start_date
          ? m.valid_from
          : m.start_date;
        const hi = m.valid_to && m.valid_to < m.end_date
          ? m.valid_to
          : m.end_date;
        return date >= lo && date <= hi;
      });

    // JUR-025/037 — une décision RH de classification retenue (anomalie
    // RH_DECIDED) est réellement APPLIQUÉE par le moteur, SCOPÉE au conflit
    // concerné (conflict_key). Un conflit non décidé reste exclu.
    const conflictDecisionRows: Array<{
      conflict_key: string | null;
      retained_kind: string | null;
    }> = await this.dataSource.query(
        `SELECT a.conflict_key, a.retained_kind
           FROM accrual_anomalies a
          WHERE a.employee_id = ?
            AND a.type = 'ABSENCE_OVERLAP_CONFLICT'
            AND a.status = 'RH_DECIDED'
            AND a.accrual_month = ?
            AND a.retained_kind IS NOT NULL`,
        [employeeId, monthInformation.accrualMonth],
      );
    const retainedKindByKey = new Map<string, string>();
    for (const row of conflictDecisionRows) {
      if (row.conflict_key) {
        retainedKindByKey.set(row.conflict_key, row.retained_kind as string);
      }
    }
    const conflictKeyFor = (covering: Array<{ id: number }>): string =>
      covering
        .map((r) => r.id)
        .sort((a, b) => a - b)
        .join(',');

    const cursor = new Date(`${presence.startDate}T00:00:00.000Z`);
    const end = new Date(`${presence.endDate}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      const date = cursor.toISOString().slice(0, 10);
      const covering = rows.filter(
        (r) => date >= r.start_date && date <= r.end_date,
      );

      if (covering.length === 0) {
        // Jour travaillé (non couvert par une absence).
      } else {
        const natures = [
          ...new Set(
            covering.map((r) =>
              classifyAbsenceKind(r.absence_kind as LeaveTypeAbsenceKind),
            ),
          ),
        ];

        if (natures.length > 1) {
          // Contradiction entre déclarations de natures différentes : jour
          // BRUT contradictoire. Si la RH a retenu une classification POUR CE
          // conflit précis, elle est appliquée ; sinon le jour reste exclu.
          breakdown.rawConflictDays += 1;
          const conflictKey = conflictKeyFor(covering);
          breakdown.conflictDaysByKey[conflictKey] =
            (breakdown.conflictDaysByKey[conflictKey] ?? 0) + 1;
          const retainedConflictKind = retainedKindByKey.get(conflictKey);
          if (retainedConflictKind) {
            this.applyDayClassification(
              breakdown,
              retainedConflictKind as LeaveTypeAbsenceKind,
              date,
              atMpWithinFirstYear,
              isMaintained,
              isLegacyMaintained,
            );
          } else {
            breakdown.conflictDays += 1;
          }
        } else {
          const kinds = [
            ...new Set(covering.map((r) => r.absence_kind as LeaveTypeAbsenceKind)),
          ];
          this.applyDayClassification(
            breakdown,
            kinds[0],
            date,
            atMpWithinFirstYear,
            isMaintained,
            isLegacyMaintained,
          );
        }
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return breakdown;
  }

  /**
   * JUR-025/037 — classement d'une journée selon UNE nature d'absence donnée
   * (nature unique, ou classification retenue par une décision RH).
   */
  private applyDayClassification(
    breakdown: AbsenceBreakdown,
    kind: LeaveTypeAbsenceKind,
    date: string,
    atMpWithinFirstYear: (date: string) => boolean,
    isMaintained: (date: string) => boolean,
    isLegacyMaintained: (date: string) => boolean,
  ): void {
    const nature = classifyAbsenceKind(kind);
    const historical = date < CURRENT_RULES_EFFECTIVE_DATE;

    if (historical && nature === 'ILLNESS') {
      breakdown.historicalPendingDays += 1;
    } else if (historical && nature === 'ASSIMILATED' && kind === LeaveTypeAbsenceKind.AT_MP) {
      if (atMpWithinFirstYear(date)) {
        breakdown.assimilatedDays += 1;
        breakdown.atMpDays += 1;
      } else {
        breakdown.historicalPendingDays += 1;
      }
    } else if (nature === 'ILLNESS') {
      if (isMaintained(date)) {
        breakdown.maintainedIllnessDays += 1;
        breakdown.assimilatedDays += 1;
      } else if (isLegacyMaintained(date)) {
        // Maintien à validité indéterminée : NON assimilé au calcul courant
        // (2 j/mois), mais suivi pour protéger un droit déjà crédité.
        breakdown.illnessDays += 1;
        breakdown.legacyMaintainedIllnessDays += 1;
      } else {
        breakdown.illnessDays += 1;
      }
    } else if (nature === 'ASSIMILATED') {
      breakdown.assimilatedDays += 1;
      if (kind === LeaveTypeAbsenceKind.AT_MP) {
        breakdown.atMpDays += 1;
      }
    } else if (nature === 'NON_ASSIMILATED') {
      breakdown.nonAssimilatedDays += 1;
    } else {
      breakdown.unclassifiedDays += 1;
    }
  }

  /**
   * JUR-025/037 — crédit mensuel par nature (utilitaire pur). La maladie sans
   * maintien est la seule soustraite (2 j/mois) ; la maladie avec maintien est
   * déjà incluse dans la base assimilée et n'est pas passée ici.
   */
  private computeMonthCredit(
    daysPerEmployee: number,
    presence: MonthlyPresence,
    breakdown: AbsenceBreakdown,
  ): MonthCreditResult {
    return computeMonthCredit({
      daysPresent: presence.daysPresent,
      daysInMonth: presence.daysInMonth,
      daysPerEmployee,
      illnessMonthlyRate: 2,
      illnessDays: breakdown.illnessDays,
      nonAssimilatedDays: breakdown.nonAssimilatedDays,
      // Jours non classifiés + contradictions + historiques à vérifier :
      // exclus de l'automatique (jamais de droit inventé ni de perte définitive).
      unclassifiedDays:
        breakdown.unclassifiedDays +
        breakdown.conflictDays +
        breakdown.historicalPendingDays,
    });
  }

  /**
   * JUR-037 — plafond de 24 jours ouvrables acquis au titre de la maladie non
   * professionnelle, STRICTEMENT isolé par salarié et par période de référence.
   * Le cumul est lu depuis les mouvements déjà crédités (illness_days) de la
   * période de référence courante, jamais depuis un historique non borné.
   */
  private async capIllnessCredit(
    employeeId: number,
    monthInformation: MonthInformation,
    illnessCreditThisMonth: number,
  ): Promise<number> {
    const CAP = 24;
    if (illnessCreditThisMonth <= 0) return 0;

    const rows: Array<{ total: string | number | null }> =
      await this.dataSource.query(
        `SELECT COALESCE(SUM(m.illness_days), 0) AS total
           FROM balance_movements m
           INNER JOIN leave_balances b ON b.id = m.leave_balance_id
          WHERE m.employee_id = ?
            AND m.movement_type = 'ACQUISITION'
            AND b.reference_period = ?
            AND (m.accrual_month IS NULL OR m.accrual_month <> ?)`,
        [
          employeeId,
          monthInformation.referencePeriod,
          monthInformation.accrualMonth,
        ],
      );

    const alreadyAcquired = Number(rows[0]?.total ?? 0);
    const remaining = Math.max(0, CAP - alreadyAcquired);
    // Précision interne conservée : l'arrondi final unique est appliqué par
    // l'appelant (computeEmployeeMonth) sur le total worked + illness.
    return Math.min(illnessCreditThisMonth, remaining);
  }

  /**
   * Fusionne des intervalles de dates en périodes CONTINUES (deux intervalles
   * adjacents — le suivant commence le lendemain de la fin du précédent — ou
   * chevauchants forment une même période ininterrompue).
   */
  private mergeContinuousIntervals(
    rows: Array<{ start_date: string; end_date: string }>,
  ): Array<{ start: string; end: string }> {
    const sorted = [...rows].sort((a, b) =>
      a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0,
    );
    const merged: Array<{ start: string; end: string }> = [];
    for (const row of sorted) {
      const previous = merged[merged.length - 1];
      if (!previous) {
        merged.push({ start: row.start_date, end: row.end_date });
        continue;
      }
      const nextDayAfterPrevious = new Date(
        `${previous.end}T00:00:00.000Z`,
      );
      nextDayAfterPrevious.setUTCDate(nextDayAfterPrevious.getUTCDate() + 1);
      const nextStart = new Date(`${row.start_date}T00:00:00.000Z`);
      if (nextStart.getTime() <= nextDayAfterPrevious.getTime()) {
        // Adjacent ou chevauchant : continuité de l'arrêt.
        if (row.end_date > previous.end) {
          previous.end = row.end_date;
        }
      } else {
        merged.push({ start: row.start_date, end: row.end_date });
      }
    }
    return merged;
  }

  /**
   * Date anniversaire d'une date donnée après N années, en gérant les années
   * bissextiles : le 29 février d'une année bissextile a pour anniversaire le
   * 28 février des années non bissextiles (et réciproquement le 28/02 reste
   * le 28/02). Une journée est « dans la première année » tant que sa date est
   * strictement antérieure à cette date anniversaire.
   */
  private addYearsIso(dateIso: string, years: number): string {
    const d = new Date(`${dateIso}T00:00:00.000Z`);
    const targetYear = d.getUTCFullYear() + years;
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    const lastDayOfTargetMonth = new Date(
      Date.UTC(targetYear, month + 1, 0),
    ).getUTCDate();
    const clampedDay = Math.min(day, lastDayOfTargetMonth);
    return `${targetYear}-${String(month + 1).padStart(2, '0')}-${String(
      clampedDay,
    ).padStart(2, '0')}`;
  }

  private async loadLegalEntities(): Promise<Map<number, LegalEntity>> {
    const entities = await this.dataSource
      .getRepository(LegalEntity)
      .find();
    return new Map(entities.map((entity) => [entity.id, entity]));
  }

  /**
   * JUR-025/037 — l'assimilation de la maladie non professionnelle au travail
   * effectif est décidée par une décision RH INDIVIDUELLE (illness_maintenance
   * _decisions), jamais par le seul paramétrage de l'entité. Cette méthode
   * détermine uniquement si les jours de maladie SANS maintien doivent faire
   * l'objet d'un signal RH (droit conventionnel supérieur possible).
   */
  private resolveUncoveredIllnessSignal(
    legalEntity: LegalEntity | undefined,
  ): { requiresRhDecision: boolean; reason: string } {
    if (!legalEntity) {
      return {
        requiresRhDecision: true,
        reason:
          'Entité juridique non rattachée : décision RH requise sur le régime applicable aux arrêts maladie non professionnels sans maintien de salaire.',
      };
    }

    const convention = legalEntity.conventionType;
    const maintenance = legalEntity.illnessWageMaintenance;

    if (convention === LegalEntityConventionType.SYNTEC) {
      if (maintenance === IllnessWageMaintenance.SANS_MAINTIEN) {
        return {
          requiresRhDecision: false,
          reason: 'Syntec — absence de maintien confirmée : socle légal 2 j/mois.',
        };
      }
      return {
        requiresRhDecision: true,
        reason:
          'Syntec — jours de maladie sans décision de maintien : socle légal 2 j/mois garanti, décision RH requise sur un éventuel maintien conventionnel (Syntec 5.5).',
      };
    }

    if (convention === LegalEntityConventionType.NON_RENSEIGNEE) {
      return {
        requiresRhDecision: true,
        reason:
          'Convention de branche non renseignée : socle légal 2 j/mois garanti, décision RH requise pour confirmer l’absence de disposition plus favorable.',
      };
    }

    return {
      requiresRhDecision: false,
      reason: 'Régime légal supplétif confirmé (L3141-5-1) : 2 j/mois.',
    };
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
