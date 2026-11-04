import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { LeaveTypeAbsenceKind } from '../leave-types/leave-type.entity';
import {
  AccrualAnomaly,
  AccrualAnomalyResolutionMode,
  AccrualAnomalyStatus,
  AccrualAnomalyType,
} from './accrual-anomaly.entity';

export interface AccrualAnomalyReconcileInput {
  employeeId: number;
  type: AccrualAnomalyType;
  referencePeriod: string;
  accrualMonth: string;
  days: number;
  detail?: string | null;
  /** Identifiant du conflit précis (déclarations chevauchantes). */
  conflictKey?: string | null;
}

@Injectable()
export class AccrualAnomalyService {
  constructor(
    @InjectRepository(AccrualAnomaly)
    private readonly repository: Repository<AccrualAnomaly>,
    private readonly dataSource: DataSource,
  ) {}

  list(status?: AccrualAnomalyStatus): Promise<AccrualAnomaly[]> {
    return this.repository.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
      relations: { employee: true, resolvedBy: true },
    });
  }

  findById(id: number): Promise<AccrualAnomaly | null> {
    return this.repository.findOne({
      where: { id },
      relations: { employee: true, resolvedBy: true },
    });
  }

  /**
   * Réconcilie une anomalie de façon IDEMPOTENTE, sans jamais annuler une
   * décision RH valide ni conserver une fausse résolution :
   *  - jours = 0 (cause réellement disparue) → RESOLVED/VERIFIED (si OPEN ou
   *    RH_DECIDED) ;
   *  - jours > 0 : OPEN conserve OPEN ; RH_DECIDED CONSERVE sa décision
   *    (stabilité au recalcul) ; RESOLVED est RÉOUVERT en OPEN (la cause est
   *    réapparue, la résolution précédente était devenue fausse).
   */
  async reconcile(input: AccrualAnomalyReconcileInput): Promise<AccrualAnomaly | null> {
    const existing = await this.repository.findOne({
      where: {
        employeeId: input.employeeId,
        type: input.type,
        referencePeriod: input.referencePeriod,
        accrualMonth: input.accrualMonth,
        conflictKey: input.conflictKey ?? IsNull(),
      },
    });

    if (input.days <= 0) {
      if (
        existing &&
        existing.status !== AccrualAnomalyStatus.RESOLVED
      ) {
        existing.status = AccrualAnomalyStatus.RESOLVED;
        existing.days = 0;
        existing.resolutionMode = AccrualAnomalyResolutionMode.VERIFIED;
        existing.resolutionReason = null;
        existing.retainedKind = null;
        existing.resolvedAt = new Date();
        await this.repository.save(existing);
        return existing;
      }
      return existing ?? null;
    }

    if (existing) {
      existing.days = input.days;
      existing.detail = input.detail ?? existing.detail;
      if (existing.status === AccrualAnomalyStatus.RESOLVED) {
        // Résolution devenue fausse : réouverture, sans décision RH valide.
        existing.status = AccrualAnomalyStatus.OPEN;
        existing.resolutionMode = null;
        existing.resolutionReason = null;
        existing.retainedKind = null;
        existing.resolvedAt = null;
        existing.resolvedById = null;
      }
      // OPEN reste OPEN ; RH_DECIDED reste RH_DECIDED (décision conservée).
      return this.repository.save(existing);
    }

    return this.repository.save(
      this.repository.create({
        employeeId: input.employeeId,
        type: input.type,
        referencePeriod: input.referencePeriod,
        accrualMonth: input.accrualMonth,
        conflictKey: input.conflictKey ?? null,
        days: input.days,
        detail: input.detail ?? null,
        status: AccrualAnomalyStatus.OPEN,
      }),
    );
  }

  async resolve(
    id: number,
    actorId: number,
    input: {
      mode: AccrualAnomalyResolutionMode;
      decisionReason?: string;
      retainedKind?: string | null;
    },
  ): Promise<AccrualAnomaly> {
    const anomaly = await this.repository.findOneBy({ id });
    if (!anomaly) {
      throw new NotFoundException(`L’anomalie ${id} est introuvable.`);
    }
    if (input.mode === AccrualAnomalyResolutionMode.RH_DECISION) {
      const reason = input.decisionReason?.trim();
      if (!reason) {
        throw new BadRequestException(
          'La cause de l’anomalie existe toujours : une décision RH explicitement justifiée est requise.',
        );
      }
      let retainedKind: string | null = null;
      if (anomaly.type === AccrualAnomalyType.ABSENCE_OVERLAP_CONFLICT) {
        if (!input.retainedKind?.trim()) {
          throw new BadRequestException(
            'Un chevauchement contradictoire ne peut pas être clôturé par une simple justification : retenez la classification d’absence à appliquer (classification retenue).',
          );
        }
        retainedKind = await this.validateRetainedKind(
          anomaly,
          input.retainedKind.trim(),
        );
      }
      anomaly.resolutionReason = reason;
      anomaly.retainedKind = retainedKind;
      anomaly.status = AccrualAnomalyStatus.RH_DECIDED;
      anomaly.resolutionMode = AccrualAnomalyResolutionMode.RH_DECISION;
      anomaly.resolvedAt = new Date();
      anomaly.resolvedById = actorId;
    } else {
      anomaly.resolutionReason = null;
      anomaly.retainedKind = null;
      anomaly.status = AccrualAnomalyStatus.RESOLVED;
      anomaly.resolutionMode = AccrualAnomalyResolutionMode.VERIFIED;
      anomaly.resolvedAt = new Date();
      anomaly.resolvedById = actorId;
    }
    return this.repository.save(anomaly);
  }

  /**
   * JUR-025/037 — une classification retenue ne peut être ni arbitraire ni
   * « orientée » pour gonfler l'acquisition : elle doit être une nature
   * d'absence valide ET figurer parmi les déclarations réellement concernées
   * par ce conflit précis (identifiées par conflict_key).
   */
  private async validateRetainedKind(
    anomaly: AccrualAnomaly,
    requestedKind: string,
  ): Promise<string> {
    const validKinds = Object.values(LeaveTypeAbsenceKind) as string[];
    if (!validKinds.includes(requestedKind)) {
      throw new BadRequestException(
        `Classification retenue invalide (valeurs admises : ${validKinds.join(', ')}).`,
      );
    }

    const declarationIds = (anomaly.conflictKey ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (declarationIds.length === 0) {
      throw new BadRequestException(
        'Conflit sans déclarations identifiées : impossible de valider la classification retenue.',
      );
    }

    const placeholders = declarationIds.map(() => '?').join(',');
    const rows: Array<{ kind: string }> = await this.dataSource.query(
      `SELECT DISTINCT lt.absence_kind AS kind
         FROM absence_declarations a
         INNER JOIN leave_types lt ON lt.id = a.leave_type_id
        WHERE a.id IN (${placeholders})`,
      declarationIds,
    );
    const involvedKinds = rows.map((row) => row.kind);

    if (!involvedKinds.includes(requestedKind)) {
      throw new BadRequestException(
        'La classification retenue ne correspond à aucune des absences concernées par ce conflit.',
      );
    }

    return requestedKind;
  }
}
