import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { MonthlyAccrualService } from '../leave-balances/monthly-accrual.service';
import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from '../documents/documents.service';
import { UserRole } from '../users/user.entity';
import {
  IllnessMaintenanceBasis,
  IllnessMaintenanceBasisStatus,
  IllnessMaintenanceDecision,
} from './illness-maintenance-decision.entity';
import { CreateIllnessMaintenanceDecisionDto } from './dto/create-illness-maintenance-decision.dto';
import { UpdateIllnessMaintenanceDecisionDto } from './dto/update-illness-maintenance-decision.dto';

@Injectable()
export class IllnessMaintenanceService {
  private readonly logger = new Logger(IllnessMaintenanceService.name);

  constructor(
    @InjectRepository(IllnessMaintenanceDecision)
    private readonly repository: Repository<IllnessMaintenanceDecision>,
    private readonly auditService: AuditService,
    private readonly monthlyAccrualService: MonthlyAccrualService,
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
    private readonly dataSource: DataSource,
  ) {}

  findAll(employeeId?: number): Promise<IllnessMaintenanceDecision[]> {
    return this.repository.find({
      where: employeeId ? { employeeId, isActive: true } : { isActive: true },
      order: { startDate: 'DESC' },
    });
  }

  findById(id: number): Promise<IllnessMaintenanceDecision | null> {
    return this.repository.findOneBy({ id });
  }

  async create(
    dto: CreateIllnessMaintenanceDecisionDto,
    actorId: number,
  ): Promise<IllnessMaintenanceDecision> {
    return this.withEmployeeLock(dto.employeeId, () =>
      this.createInner(dto, actorId),
    );
  }

  private async createInner(
    dto: CreateIllnessMaintenanceDecisionDto,
    actorId: number,
  ): Promise<IllnessMaintenanceDecision> {
    this.validateDates(dto.startDate, dto.endDate);
    if (!dto.justification?.trim()) {
      throw new BadRequestException(
        'Une justification est obligatoire pour une décision de maintien de salaire.',
      );
    }

    const basis = dto.basis ?? IllnessMaintenanceBasis.SYNTEC_5_5;
    const evaluation = await this.evaluateBasis({
      employeeId: dto.employeeId,
      basis,
      startDate: dto.startDate,
      endDate: dto.endDate,
      validFrom: dto.basisValidFrom,
      validTo: dto.basisValidTo,
      documentId: dto.basisDocumentId,
    });
    await this.ensureNoOverlappingActiveDecision(
      dto.employeeId,
      dto.startDate,
      dto.endDate,
    );
    await this.ensureIllnessAbsenceOverlap(
      dto.employeeId,
      dto.startDate,
      dto.endDate,
    );

    const decision = await this.repository.save(
      this.repository.create({
        employeeId: dto.employeeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        basis,
        basisReference: dto.basisReference?.trim() || null,
        basisValidFrom: evaluation.validFrom,
        basisValidTo: evaluation.validTo,
        basisValidationStatus: evaluation.status,
        basisDocumentId: dto.basisDocumentId ?? null,
        justification: dto.justification.trim(),
        decidedById: actorId,
        decidedAt: new Date(),
        isActive: true,
      }),
    );

    await this.auditService.record({
      actorId,
      action: 'ILLNESS_MAINTENANCE_DECISION_CREATED',
      resourceType: 'ILLNESS_MAINTENANCE_DECISION',
      resourceId: decision.id,
      oldValue: null,
      newValue: {
        employeeId: decision.employeeId,
        startDate: decision.startDate,
        endDate: decision.endDate,
        basis: decision.basis,
        basisReference: decision.basisReference,
        basisValidFrom: decision.basisValidFrom,
        basisValidTo: decision.basisValidTo,
        basisValidationStatus: decision.basisValidationStatus,
        basisDocumentId: decision.basisDocumentId,
        justification: decision.justification,
        decidedById: decision.decidedById,
      },
    });

    await this.triggerRecalculation(
      decision.employeeId,
      decision.startDate,
      decision.endDate,
      actorId,
    );

    return decision;
  }

  async update(
    id: number,
    dto: UpdateIllnessMaintenanceDecisionDto,
    actorId: number,
  ): Promise<IllnessMaintenanceDecision> {
    const existing = await this.repository.findOneBy({ id });
    if (!existing) {
      throw new NotFoundException(
        `La décision de maintien ${id} est introuvable.`,
      );
    }
    return this.withEmployeeLock(existing.employeeId, () =>
      this.updateInner(id, dto, actorId),
    );
  }

  private async updateInner(
    id: number,
    dto: UpdateIllnessMaintenanceDecisionDto,
    actorId: number,
  ): Promise<IllnessMaintenanceDecision> {
    const decision = await this.repository.findOneBy({ id });
    if (!decision) {
      throw new NotFoundException(
        `La décision de maintien ${id} est introuvable.`,
      );
    }

    const previous = {
      startDate: decision.startDate,
      endDate: decision.endDate,
      basis: decision.basis,
      basisReference: decision.basisReference,
      basisValidFrom: decision.basisValidFrom,
      basisValidTo: decision.basisValidTo,
      basisValidationStatus: decision.basisValidationStatus,
      basisDocumentId: decision.basisDocumentId,
      justification: decision.justification,
    };

    const startDate = dto.startDate ?? decision.startDate;
    const endDate = dto.endDate ?? decision.endDate;
    this.validateDates(startDate, endDate);

    const basis = dto.basis ?? decision.basis;
    const validFrom = dto.basisValidFrom !== undefined
      ? this.toDate(dto.basisValidFrom)
      : decision.basisValidFrom;
    const validTo = dto.basisValidTo !== undefined
      ? this.toDate(dto.basisValidTo)
      : decision.basisValidTo;
    const documentId = dto.basisDocumentId !== undefined
      ? dto.basisDocumentId
      : decision.basisDocumentId;
    const evaluation = await this.evaluateBasis({
      employeeId: decision.employeeId,
      basis,
      startDate,
      endDate,
      validFrom,
      validTo,
      documentId,
    });
    await this.ensureNoOverlappingActiveDecision(
      decision.employeeId,
      startDate,
      endDate,
      decision.id,
    );
    if (
      startDate !== decision.startDate ||
      endDate !== decision.endDate
    ) {
      await this.ensureIllnessAbsenceOverlap(
        decision.employeeId,
        startDate,
        endDate,
      );
    }

    decision.startDate = startDate;
    decision.endDate = endDate;
    decision.basis = basis;
    decision.basisValidFrom = evaluation.validFrom;
    decision.basisValidTo = evaluation.validTo;
    decision.basisDocumentId = documentId;
    decision.basisValidationStatus = evaluation.status;
    if (dto.basisReference !== undefined) {
      decision.basisReference = dto.basisReference.trim() || null;
    }
    if (dto.justification !== undefined) {
      if (!dto.justification.trim()) {
        throw new BadRequestException(
          'La justification ne peut pas être vide.',
        );
      }
      decision.justification = dto.justification.trim();
    }
    decision.decidedById = actorId;
    decision.decidedAt = new Date();

    await this.repository.save(decision);

    await this.auditService.record({
      actorId,
      action: 'ILLNESS_MAINTENANCE_DECISION_UPDATED',
      resourceType: 'ILLNESS_MAINTENANCE_DECISION',
      resourceId: decision.id,
      oldValue: previous,
      newValue: {
        startDate: decision.startDate,
        endDate: decision.endDate,
        basis: decision.basis,
        basisReference: decision.basisReference,
        basisValidFrom: decision.basisValidFrom,
        basisValidTo: decision.basisValidTo,
        basisValidationStatus: decision.basisValidationStatus,
        basisDocumentId: decision.basisDocumentId,
        justification: decision.justification,
        decidedById: decision.decidedById,
      },
    });

    const regularizeStart =
      previous.startDate < decision.startDate
        ? previous.startDate
        : decision.startDate;
    const regularizeEnd =
      previous.endDate > decision.endDate ? previous.endDate : decision.endDate;
    await this.triggerRecalculation(
      decision.employeeId,
      regularizeStart,
      regularizeEnd,
      actorId,
    );

    return decision;
  }

  async cancel(id: number, actorId: number): Promise<IllnessMaintenanceDecision> {
    const decision = await this.repository.findOneBy({ id });
    if (!decision) {
      throw new NotFoundException(
        `La décision de maintien ${id} est introuvable.`,
      );
    }
    if (!decision.isActive) {
      throw new BadRequestException(
        'Cette décision de maintien est déjà annulée.',
      );
    }

    decision.isActive = false;
    decision.decidedById = actorId;
    decision.decidedAt = new Date();
    await this.repository.save(decision);

    await this.auditService.record({
      actorId,
      action: 'ILLNESS_MAINTENANCE_DECISION_CANCELLED',
      resourceType: 'ILLNESS_MAINTENANCE_DECISION',
      resourceId: decision.id,
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });

    await this.triggerRecalculation(
      decision.employeeId,
      decision.startDate,
      decision.endDate,
      actorId,
    );

    return decision;
  }

  async findActiveForEmployee(
    employeeId: number,
  ): Promise<IllnessMaintenanceDecision[]> {
    return this.repository.find({
      where: { employeeId, isActive: true },
      order: { startDate: 'ASC' },
    });
  }

  private validateDates(startDate: string, endDate: string): void {
    if (startDate > endDate) {
      throw new BadRequestException(
        'La date de début doit être antérieure ou égale à la date de fin.',
      );
    }
  }

  /**
   * JUR-025/037 — verrou MySQL/MariaDB (GET_LOCK) par salarié : deux décisions
   * concurrentes pour le même collaborateur se sérialisent, y compris entre
   * instances backend (aucun chevauchement incompatible non détecté).
   */
  private async withEmployeeLock<T>(
    employeeId: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const key = `illness-maintenance-${employeeId}`;
    try {
      const rows = await queryRunner.query('SELECT GET_LOCK(?, 10) AS acquired', [
        key,
      ]);
      if (Number(rows?.[0]?.acquired ?? 0) !== 1) {
        throw new ConflictException(
          'Une décision concurrente est en cours pour ce collaborateur. Réessayez dans un instant.',
        );
      }
      try {
        return await fn();
      } finally {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [key]);
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * JUR-025/037 — évalue si le fondement est RÉELLEMENT applicable et valide
   * sur la période de la décision, à partir d'informations STRUCTURÉES et
   * VÉRIFIABLES (convention/accord enregistrés, période de validité datée,
   * document validé), jamais d'un simple texte libre.
   *
   *  - SYNTEC_5_5 : applicable si l'entité relève de Syntec (convention établie).
   *  - ACCORD_ENTREPRISE : accord enregistré pour l'entité ET validité datée
   *    couvrant la décision. Sinon → PROPOSITION (non appliquée au calcul).
   *  - CONTRACTUEL / AUTRE : document effectivement enregistré et VALIDÉ
   *    (documents.status = ACCEPTE), éventuellement avec période de validité.
   *    Sinon → PROPOSITION (aucun droit automatique).
   *
   * Une PROPOSITION n'est jamais créditée : seule une décision VALIDATED est
   * appliquée par le moteur d'acquisition.
   */
  private async evaluateBasis(input: {
    employeeId: number;
    basis: IllnessMaintenanceBasis;
    startDate: string;
    endDate: string;
    validFrom: string | null | undefined;
    validTo: string | null | undefined;
    documentId: number | null | undefined;
  }): Promise<{
    status: IllnessMaintenanceBasisStatus;
    reason: string;
    validFrom: string | null;
    validTo: string | null;
  }> {
    const rows: Array<{
      convention_type: string;
      accord_type: string;
      accord_name: string | null;
      accord_valid_from: string | null;
      accord_valid_to: string | null;
      accord_document_id: number | null;
      legal_entity_id: number | null;
    }> = await this.dataSource.query(
      `SELECT le.convention_type, le.accord_type, le.accord_name,
              DATE_FORMAT(le.accord_valid_from, '%Y-%m-%d') AS accord_valid_from,
              DATE_FORMAT(le.accord_valid_to, '%Y-%m-%d') AS accord_valid_to,
              le.accord_document_id,
              le.id AS legal_entity_id
         FROM users u
         INNER JOIN legal_entities le ON le.id = u.legal_entity_id
        WHERE u.id = ?`,
      [input.employeeId],
    );
    const entity = rows[0];
    if (!entity) {
      throw new BadRequestException(
        'Le collaborateur n’est rattaché à aucune entité juridique : fondement de maintien non applicable.',
      );
    }

    if (input.basis === IllnessMaintenanceBasis.SYNTEC_5_5) {
      if (entity.convention_type !== LegalEntityConventionType.SYNTEC) {
        throw new BadRequestException(
          'Le fondement Syntec 5.5 n’est pas applicable : le collaborateur ne relève pas de la convention Syntec.',
        );
      }
      return {
        status: IllnessMaintenanceBasisStatus.VALIDATED,
        reason: 'Convention Syntec établie pour l’entité (IDCC 1486).',
        validFrom: this.toDate(input.validFrom),
        validTo: this.toDate(input.validTo),
      };
    }

    const requestedFrom = this.toDate(input.validFrom);
    const requestedTo = this.toDate(input.validTo);
    if (
      requestedFrom &&
      requestedTo &&
      requestedFrom > requestedTo
    ) {
      throw new BadRequestException(
        'La période de validité du fondement est incohérente (début après fin).',
      );
    }

    if (input.basis === IllnessMaintenanceBasis.ACCORD_ENTREPRISE) {
      if (
        entity.accord_type !== 'ACCORD_ENTREPRISE' ||
        !entity.accord_name?.trim()
      ) {
        throw new BadRequestException(
          'Le fondement « accord d’entreprise » n’est pas applicable : aucun accord d’entreprise enregistré pour l’entité.',
        );
      }

      // Source de vérité : période ENREGISTRÉE sur l'entité ET adossée à un
      // justificatif d'accord VÉRIFIÉ. Des dates seules ne font pas preuve.
      if (!entity.accord_document_id || !entity.legal_entity_id) {
        return {
          status: IllnessMaintenanceBasisStatus.PROPOSED,
          reason:
            'Accord sans justificatif vérifié : proposition RH à examiner (aucune application automatique sur simple déclaration).',
          validFrom: this.toDate(entity.accord_valid_from),
          validTo: this.toDate(entity.accord_valid_to),
        };
      }
      try {
        await this.documentsService.assertAccordProof(
          entity.accord_document_id,
          entity.legal_entity_id,
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          return {
            status: IllnessMaintenanceBasisStatus.PROPOSED,
            reason: `${error.message} — proposition RH à examiner.`,
            validFrom: this.toDate(entity.accord_valid_from),
            validTo: this.toDate(entity.accord_valid_to),
          };
        }
        throw error;
      }

      const accordFrom = this.toDate(entity.accord_valid_from);
      const accordTo = this.toDate(entity.accord_valid_to);
      const coversDecision = (): boolean => {
        if (accordFrom && input.endDate < accordFrom) return false;
        if (accordTo && input.startDate > accordTo) return false;
        return true;
      };

      if (!accordFrom || !accordTo || !coversDecision()) {
        return {
          status: IllnessMaintenanceBasisStatus.PROPOSED,
          reason:
            'Accord enregistré mais validité non établie ou ne couvrant pas la période : proposition RH à examiner (aucune application automatique).',
          validFrom: accordFrom,
          validTo: accordTo,
        };
      }

      // Si la RH fournit des dates, elles ne peuvent pas excéder la période
      // réellement enregistrée de l'accord.
      if (
        (requestedFrom && requestedFrom < accordFrom) ||
        (requestedTo && requestedTo > accordTo)
      ) {
        return {
          status: IllnessMaintenanceBasisStatus.PROPOSED,
          reason:
            'Dates de validité fournies au-delà de la période enregistrée de l’accord : proposition RH à examiner.',
          validFrom: accordFrom,
          validTo: accordTo,
        };
      }

      return {
        status: IllnessMaintenanceBasisStatus.VALIDATED,
        reason:
          'Accord d’entreprise enregistré et valide sur la période couverte.',
        validFrom: accordFrom,
        validTo: accordTo,
      };
    }

    if (
      input.basis === IllnessMaintenanceBasis.CONTRACTUEL ||
      input.basis === IllnessMaintenanceBasis.AUTRE
    ) {
      if (!input.documentId) {
        return {
          status: IllnessMaintenanceBasisStatus.PROPOSED,
          reason:
            'Fondement sans document vérifié : proposition RH à examiner (aucun droit automatique sur simple déclaration).',
          validFrom: requestedFrom,
          validTo: requestedTo,
        };
      }

      try {
        await this.documentsService.assertBasisProof(
          input.documentId,
          input.employeeId,
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          return {
            status: IllnessMaintenanceBasisStatus.PROPOSED,
            reason: `${error.message} — proposition RH à examiner.`,
            validFrom: requestedFrom,
            validTo: requestedTo,
          };
        }
        throw error;
      }

      if (
        (requestedFrom || requestedTo) &&
        ((requestedFrom && input.endDate < requestedFrom) ||
          (requestedTo && input.startDate > requestedTo))
      ) {
        return {
          status: IllnessMaintenanceBasisStatus.PROPOSED,
          reason:
            'Document validé mais période de validité ne couvrant pas la décision : proposition RH à examiner.',
          validFrom: requestedFrom,
          validTo: requestedTo,
        };
      }
      return {
        status: IllnessMaintenanceBasisStatus.VALIDATED,
        reason: 'Document du fondement validé et applicable à la période.',
        validFrom: requestedFrom,
        validTo: requestedTo,
      };
    }

    return {
      status: IllnessMaintenanceBasisStatus.PROPOSED,
      reason: 'Fondement non vérifiable : proposition RH à examiner.',
      validFrom: requestedFrom,
      validTo: requestedTo,
    };
  }

  private toDate(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.slice(0, 10);
  }

  private async ensureNoOverlappingActiveDecision(
    employeeId: number,
    startDate: string,
    endDate: string,
    ignoredId?: number,
  ): Promise<void> {
    const rows: Array<{ id: number }> = await this.dataSource.query(
      `SELECT id FROM illness_maintenance_decisions
        WHERE employee_id = ?
          AND is_active = 1
          AND id <> ?
          AND start_date <= ?
          AND end_date >= ?`,
      [employeeId, ignoredId ?? 0, endDate, startDate],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        'Une décision de maintien active couvre déjà tout ou partie de cette période.',
      );
    }
  }

  private async ensureIllnessAbsenceOverlap(
    employeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    const rows: Array<{ id: number }> = await this.dataSource.query(
      `SELECT a.id
         FROM absence_declarations a
         INNER JOIN leave_types lt ON lt.id = a.leave_type_id
        WHERE a.employee_id = ?
          AND a.status = 'ENREGISTREE'
          AND lt.absence_kind = 'ARRET_MALADIE'
          AND a.start_date <= ?
          AND a.end_date >= ?`,
      [employeeId, endDate, startDate],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        'Aucun arrêt maladie non professionnel enregistré ne correspond à cette période : le maintien de salaire ne peut pas être décidé sur une période sans arrêt.',
      );
    }
  }

  private async triggerRecalculation(
    employeeId: number,
    startDate: string,
    endDate: string,
    actorId: number,
  ): Promise<void> {
    try {
      await this.monthlyAccrualService.regularizeAbsenceImpact(
        employeeId,
        startDate,
        endDate,
        actorId,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Recalcul d'acquisition échoué après décision de maintien (salarié ${employeeId}) : ${message}`,
      );
      // Anomalie persistante et visible pour la RH, relançable via l'endpoint.
      await this.notificationsService.createForActiveRoles([UserRole.RH], {
        type: 'ACCRUAL_REGULARIZATION_FAILED',
        title: 'Recalcul d’acquisition à relancer',
        message: `Le recalcul des congés du salarié #${employeeId} (période ${startDate} → ${endDate}) a échoué après une décision de maintien de salaire. Relancez la régularisation d’acquisition. Détail : ${message}`,
      });
    }
  }
}
