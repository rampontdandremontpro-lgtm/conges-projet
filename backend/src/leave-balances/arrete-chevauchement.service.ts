import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { AbsenceDeclarationStatus } from '../absence-declarations/absence-declaration.entity';
import { AuditService } from '../audit/audit.service';
import { HolidaysService } from '../holidays/holidays.service';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import {
  LeaveType,
  LeaveTypeAbsenceKind,
} from '../leave-types/leave-type.entity';
import { SettingsService } from '../settings/settings.service';
import {
  calculateDeductedLeaveDayList,
  DatedLeaveDay,
  sumDatedDays,
} from './carryover-allocation.core';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import { LeaveBalance } from './leave-balance.entity';
import { LeaveArreteRestoration } from './leave-arrete-restoration.entity';

export interface ArreteOverlapItem {
  leaveRequestId: number;
  startDate: string;
  endDate: string;
  overlapDays: number;
  dates: DatedLeaveDay[];
  balanceId: number | null;
  alreadyRestored: boolean;
  uncertain: boolean;
  reason: string | null;
}

export interface ArreteChevauchementResult {
  absenceDeclarationId: number;
  enabled: boolean;
  maladieType: boolean;
  skippedReason: string | null;
  overlaps: ArreteOverlapItem[];
  restoredDays: number;
  /** Chevauchement non régularisé (désactivé ou incertain) → action RH requise. */
  manualActionNeeded: boolean;
}

@Injectable()
export class ArreteChevauchementService {
  private readonly logger = new Logger(ArreteChevauchementService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly holidaysService: HolidaysService,
    private readonly auditService: AuditService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const value = await this.settingsService.getString(
      'ARRET_CHEVAUCHEMENT_ENABLED',
      'false',
    );
    return value === 'true';
  }

  async getMaladieTypeIds(): Promise<number[]> {
    const raw = await this.settingsService.getString(
      'ARRET_MALADIE_TYPE_IDS',
      '',
    );
    return raw
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  /**
   * Un type d'absence est un « arrêt maladie » uniquement s'il a été
   * explicitement classé comme tel par la RH :
   *  - `absence_kind = ARRET_MALADIE` (classification persistante) → OUI ;
   *  - `absence_kind` explicitement autre (ENFANT_MALADE, AT_MP, NON_MEDICAL)
   *    → NON, même si un ancien identifiant figure dans ARRET_MALADIE_TYPE_IDS ;
   *  - `absence_kind = NON_CLASSIFIE` → compatibilité historique uniquement
   *    via ARRET_MALADIE_TYPE_IDS (aucune correspondance de mots).
   */
  async isMaladieType(leaveType: LeaveType): Promise<boolean> {
    if (leaveType.absenceKind === LeaveTypeAbsenceKind.ARRET_MALADIE) {
      return true;
    }
    if (leaveType.absenceKind !== LeaveTypeAbsenceKind.NON_CLASSIFIE) {
      return false;
    }
    const configured = await this.getMaladieTypeIds();
    return configured.includes(Number(leaveType.id));
  }

  /**
   * JUR-028 — un arrêt maladie (type reconnu) peut chevaucher un congé déjà
   * validé : la déclaration reste possible, indépendamment de l'activation de
   * la restitution automatique.
   */
  async shouldRelaxLeaveOverlap(leaveType: LeaveType): Promise<boolean> {
    return this.isMaladieType(leaveType);
  }

  async preview(absenceDeclarationId: number): Promise<ArreteChevauchementResult> {
    const declaration = await this.dataSource
      .getRepository(AbsenceDeclaration)
      .findOne({ where: { id: absenceDeclarationId }, relations: { leaveType: true } });
    if (!declaration) {
      throw new NotFoundException(
        `La déclaration d’absence ${absenceDeclarationId} est introuvable.`,
      );
    }

    const { enabled, maladieType } = await this.readConfig(declaration.leaveType);
    if (!maladieType) {
      return {
        absenceDeclarationId,
        enabled,
        maladieType,
        skippedReason: 'Type d’absence non configuré comme arrêt maladie.',
        overlaps: [],
        restoredDays: 0,
        manualActionNeeded: false,
      };
    }

    const overlaps = await this.computeOverlaps(
      declaration.id,
      declaration.employeeId,
      declaration.startDate,
      declaration.endDate,
    );
    const restoredDays = this.round(
      overlaps.reduce(
        (sum, item) => sum + (item.alreadyRestored || item.uncertain ? 0 : item.overlapDays),
        0,
      ),
    );
    const manualActionNeeded = overlaps.some(
      (item) => item.overlapDays > 0 && !item.alreadyRestored && (item.uncertain || !enabled),
    );
    return { absenceDeclarationId, enabled, maladieType, skippedReason: null, overlaps, restoredDays, manualActionNeeded };
  }

  async restoreForAbsence(
    absenceDeclarationId: number,
    actorId: number,
    manager?: EntityManager,
  ): Promise<ArreteChevauchementResult> {
    const run = async (m: EntityManager): Promise<ArreteChevauchementResult> => {
      const declaration = await m
        .getRepository(AbsenceDeclaration)
        .findOne({ where: { id: absenceDeclarationId }, relations: { leaveType: true } });
      if (!declaration) {
        throw new NotFoundException(
          `La déclaration d’absence ${absenceDeclarationId} est introuvable.`,
        );
      }
      if (declaration.status !== AbsenceDeclarationStatus.ENREGISTREE) {
        throw new BadRequestException(
          'La restitution n’est possible que pour une déclaration d’absence enregistrée (ENREGISTREE).',
        );
      }

      const { enabled, maladieType } = await this.readConfig(declaration.leaveType);
      if (!maladieType) {
        return {
          absenceDeclarationId,
          enabled,
          maladieType,
          skippedReason: 'Type d’absence non configuré comme arrêt maladie.',
          overlaps: [],
          restoredDays: 0,
          manualActionNeeded: false,
        };
      }

      const overlaps = await this.computeOverlaps(
        declaration.id,
        declaration.employeeId,
        declaration.startDate,
        declaration.endDate,
        m,
      );

      let restoredDays = 0;
      if (enabled) {
        for (const item of overlaps) {
          if (
            item.alreadyRestored ||
            item.uncertain ||
            item.overlapDays <= 0 ||
            item.balanceId === null
          ) {
            continue;
          }
          await this.applyRestoration(
            absenceDeclarationId,
            item,
            actorId,
            m,
          );
          restoredDays = this.round(restoredDays + item.overlapDays);
        }
      }

      const manualActionNeeded = overlaps.some(
        (item) => item.overlapDays > 0 && !item.alreadyRestored && (item.uncertain || !enabled),
      );

      return { absenceDeclarationId, enabled, maladieType, skippedReason: null, overlaps, restoredDays, manualActionNeeded };
    };

    if (manager) {
      return run(manager);
    }
    return this.dataSource.transaction(run);
  }

  async reverseForAbsence(
    absenceDeclarationId: number,
    actorId: number,
    manager?: EntityManager,
  ): Promise<{ reversed: number }> {
    const run = async (m: EntityManager): Promise<{ reversed: number }> => {
      const declaration = await m
        .getRepository(AbsenceDeclaration)
        .findOne({ where: { id: absenceDeclarationId } });
      if (!declaration) {
        throw new NotFoundException(
          `La déclaration d’absence ${absenceDeclarationId} est introuvable.`,
        );
      }
      if (declaration.status !== AbsenceDeclarationStatus.ANNULEE) {
        throw new BadRequestException(
          'L’inversion de la restitution n’est possible que pour une déclaration d’absence annulée (ANNULEE).',
        );
      }

      const rows = await m.getRepository(LeaveArreteRestoration).find({
        where: { absenceDeclarationId, reversedAt: IsNull() },
      });

      let reversed = 0;
      for (const row of rows) {
        await this.applyReversal(row, actorId, m);
        reversed = this.round(reversed + Number(row.days));
      }
      return { reversed };
    };

    if (manager) {
      return run(manager);
    }
    return this.dataSource.transaction(run);
  }

  private async readConfig(leaveType: LeaveType): Promise<{
    enabled: boolean;
    maladieType: boolean;
  }> {
    const enabled = await this.isEnabled();
    const maladieType = await this.isMaladieType(leaveType);
    return { enabled, maladieType };
  }

  /** Détermine les chevauchements entre un arrêt et les congés validés. */
  private async computeOverlaps(
    absenceDeclarationId: number,
    employeeId: number,
    absenceStart: string,
    absenceEnd: string,
    manager?: EntityManager,
  ): Promise<ArreteOverlapItem[]> {
    const m = manager ?? this.dataSource.manager;
    const requestRepository = m.getRepository(LeaveRequest);
    const restorationRepository = m.getRepository(LeaveArreteRestoration);

    const leaves = await requestRepository.find({
      where: {
        employeeId,
        status: In([LeaveRequestStatus.VALIDEE]),
      },
    });
    const overlapping = leaves.filter(
      (leave) => leave.startDate <= absenceEnd && leave.endDate >= absenceStart,
    );

    const existing = await restorationRepository.find({
      where: { absenceDeclarationId },
    });
    const existingByLeave = new Map(
      existing.map((row) => [Number(row.leaveRequestId), row]),
    );

    const items: ArreteOverlapItem[] = [];
    for (const leave of overlapping) {
      const already = existingByLeave.get(Number(leave.id));
      if (already) {
        items.push({
          leaveRequestId: Number(leave.id),
          startDate: leave.startDate,
          endDate: leave.endDate,
          overlapDays: this.round(Number(already.days)),
          dates: [],
          balanceId: Number(already.leaveBalanceId),
          alreadyRestored: true,
          uncertain: false,
          reason: 'Déjà restitué (idempotent).',
        });
        continue;
      }

      try {
        const holidays = await this.holidaysService.findNonDeductibleBetween(
          leave.startDate,
          leave.endDate,
        );
        const allDays = calculateDeductedLeaveDayList(
          leave.startDate,
          leave.endDate,
          leave.startPeriod,
          leave.endPeriod,
          new Set(holidays.map((holiday) => holiday.date)),
        );
        const totalApp = sumDatedDays(allDays);
        const expected = this.round(Number(leave.deductedDays));

        if (Math.abs(totalApp - expected) > 0.001) {
          items.push({
            leaveRequestId: Number(leave.id),
            startDate: leave.startDate,
            endDate: leave.endDate,
            overlapDays: 0,
            dates: [],
            balanceId: null,
            alreadyRestored: false,
            uncertain: true,
            reason: 'Demande non reconstituable (jours fériés modifiés) — vérification RH requise.',
          });
          continue;
        }

        // Jours déjà restitués pour ce congé (autres arrêts) : aucune double
        // restitution, aucune somme supérieure au total décompté.
        const otherRestorations = await restorationRepository.find({
          where: { leaveRequestId: Number(leave.id), reversedAt: IsNull() },
        });
        const restoredDates = new Set<string>();
        for (const row of otherRestorations) {
          const parsed = this.parseDates(row.datesJson);
          for (const day of parsed) {
            restoredDates.add(day.date);
          }
        }

        const overlapDates = allDays.filter(
          (day) =>
            day.date >= absenceStart &&
            day.date <= absenceEnd &&
            !restoredDates.has(day.date),
        );
        const overlapDays = this.round(sumDatedDays(overlapDates));
        if (overlapDays <= 0) {
          items.push({
            leaveRequestId: Number(leave.id),
            startDate: leave.startDate,
            endDate: leave.endDate,
            overlapDays: 0,
            dates: [],
            balanceId: null,
            alreadyRestored: false,
            uncertain: false,
            reason: 'Aucun jour déductible restant dans la plage de l’arrêt.',
          });
          continue;
        }

        const balanceId = await this.resolveSingleDeductionBalance(
          Number(leave.id),
          m,
        );
        items.push({
          leaveRequestId: Number(leave.id),
          startDate: leave.startDate,
          endDate: leave.endDate,
          overlapDays,
          dates: overlapDates,
          balanceId,
          alreadyRestored: false,
          uncertain: balanceId === null,
          reason:
            balanceId === null
              ? 'Imputation multiple/absente non résolue — vérification RH requise.'
              : null,
        });
      } catch (error) {
        this.logger.warn(
          `Chevauchement non résolu (congé ${leave.id}) : ${String(error)}`,
        );
        items.push({
          leaveRequestId: Number(leave.id),
          startDate: leave.startDate,
          endDate: leave.endDate,
          overlapDays: 0,
          dates: [],
          balanceId: null,
          alreadyRestored: false,
          uncertain: true,
          reason: 'Erreur de reconstruction — vérification RH requise.',
        });
      }
    }

    return items;
  }

  private parseDates(datesJson: string): DatedLeaveDay[] {
    try {
      const parsed = JSON.parse(datesJson);
      return Array.isArray(parsed)
        ? parsed
            .filter((d) => d && typeof d.date === 'string')
            .map((d) => ({ date: d.date, value: Number(d.value) }))
        : [];
    } catch {
      return [];
    }
  }

  private async resolveSingleDeductionBalance(
    leaveRequestId: number,
    manager: EntityManager,
  ): Promise<number | null> {
    const movements = await manager.getRepository(BalanceMovement).find({
      where: {
        leaveRequestId,
        movementType: BalanceMovementType.DEDUCTION,
      },
    });
    if (movements.length === 0) return null;

    const balances = new Set<number>();
    for (const movement of movements) {
      balances.add(Number(movement.leaveBalanceId));
    }
    if (balances.size !== 1) return null;
    return balances.values().next().value as number;
  }

  private async applyRestoration(
    absenceDeclarationId: number,
    item: ArreteOverlapItem,
    actorId: number,
    manager: EntityManager,
  ): Promise<void> {
    // Idempotence/concurrence : la ligne de trace est insérée en premier ; la
    // contrainte unique (absence, congé) annule toute double écriture.
    try {
      await manager.getRepository(LeaveArreteRestoration).insert({
        absenceDeclarationId,
        leaveRequestId: item.leaveRequestId,
        leaveBalanceId: item.balanceId as number,
        days: item.overlapDays,
        datesJson: JSON.stringify(item.dates),
        reversedAt: null,
      });
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        return; // déjà restitué par un traitement concurrent
      }
      throw error;
    }

    const balance = await manager.getRepository(LeaveBalance).findOne({
      where: { id: item.balanceId as number },
    });
    if (!balance) {
      throw new BadRequestException(
        `Le compteur ${item.balanceId} est introuvable.`,
      );
    }

    // Seule la disponibilité est restaurée ; les jours ACQUIS ne bougent pas
    // (une restitution n'est pas une nouvelle acquisition).
    const balanceBefore = this.round(Number(balance.availableDays));
    const balanceAfter = this.round(balanceBefore + item.overlapDays);
    balance.availableDays = balanceAfter;
    await manager.getRepository(LeaveBalance).save(balance);

    await manager.getRepository(BalanceMovement).save(
      manager.getRepository(BalanceMovement).create({
        employeeId: Number(balance.employeeId),
        employee: { id: Number(balance.employeeId) } as never,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: item.leaveRequestId,
        leaveRequest: { id: item.leaveRequestId } as never,
        actorId,
        actor: { id: actorId } as never,
        movementType: BalanceMovementType.ARRET_RESTITUTION,
        days: item.overlapDays,
        balanceBefore,
        balanceAfter,
        reason: `JUR-028 : restitution de ${item.overlapDays} jour(s) de congé couvert(s) par un arrêt maladie.`,
      }),
    );

    await this.auditService.record(
      {
        actorId,
        action: 'ARRET_RESTITUTION_APPLIED',
        resourceType: 'LEAVE_BALANCE',
        resourceId: balance.id,
        oldValue: { available: balanceBefore, acquired: Number(balance.acquiredDays) },
        newValue: {
          available: balanceAfter,
          acquired: Number(balance.acquiredDays),
          restoredDays: item.overlapDays,
          leaveRequestId: item.leaveRequestId,
          absenceDeclarationId,
        },
      },
      manager,
    );
  }

  private async applyReversal(
    row: LeaveArreteRestoration,
    actorId: number,
    manager: EntityManager,
  ): Promise<void> {
    const balance = await manager.getRepository(LeaveBalance).findOne({
      where: { id: row.leaveBalanceId },
    });
    if (!balance) return;

    // Seule la disponibilité est ajustée (les jours acquis restent inchangés).
    const balanceBefore = this.round(Number(balance.availableDays));
    const balanceAfter = this.round(balanceBefore - Number(row.days));
    balance.availableDays = balanceAfter;
    await manager.getRepository(LeaveBalance).save(balance);

    await manager.getRepository(BalanceMovement).save(
      manager.getRepository(BalanceMovement).create({
        employeeId: Number(balance.employeeId),
        employee: { id: Number(balance.employeeId) } as never,
        leaveBalanceId: balance.id,
        leaveBalance: balance,
        leaveRequestId: Number(row.leaveRequestId),
        leaveRequest: { id: Number(row.leaveRequestId) } as never,
        actorId,
        actor: { id: actorId } as never,
        movementType: BalanceMovementType.ARRET_RESTITUTION,
        days: -Number(row.days),
        balanceBefore,
        balanceAfter,
        reason: 'JUR-028 : annulation de l’arrêt — restitution de congé reversée.',
      }),
    );

    row.reversedAt = new Date();
    await manager.getRepository(LeaveArreteRestoration).save(row);

    await this.auditService.record(
      {
        actorId,
        action: 'ARRET_RESTITUTION_REVERSED',
        resourceType: 'LEAVE_BALANCE',
        resourceId: balance.id,
        oldValue: { available: balanceBefore, acquired: Number(balance.acquiredDays) },
        newValue: {
          available: balanceAfter,
          acquired: Number(balance.acquiredDays),
          reversedDays: Number(row.days),
          leaveRequestId: Number(row.leaveRequestId),
        },
      },
      manager,
    );
  }

  private isDuplicateKey(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    return code === 'ER_DUP_ENTRY';
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
