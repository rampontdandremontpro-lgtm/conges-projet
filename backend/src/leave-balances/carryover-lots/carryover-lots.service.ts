import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditLog } from '../../audit/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { Document } from '../../documents/document.entity';
import { SettingsService } from '../../settings/settings.service';
import { User, UserRole } from '../../users/user.entity';
import {
  CarryoverLot,
  CarryoverLotAbsenceStatus,
  CarryoverLotConfirmationStatus,
  CarryoverLotOrigin,
  CarryoverLotRegime,
  CarryoverLotStatus,
  CarryoverLotTargetCounter,
} from '../carryover-lot.entity';
import { computeCarryoverExpiry } from '../carryover-expiry/carryover-expiry.service';
import {
  AbsenceStatus,
  CarryoverDelayStatus,
  CarryoverExpiryResult,
} from '../carryover-expiry/carryover-expiry.types';
import {
  parseReferencePeriod,
  referencePeriodEndDate,
} from '../reference-period.util';
import { CreateCarryoverLotDto } from './dto/create-carryover-lot.dto';
import { ConfirmCarryoverLotDto } from './dto/confirm-carryover-lot.dto';
import { UpdateCarryoverLotDto } from './dto/update-carryover-lot.dto';

const RESOURCE_TYPE = 'CARRYOVER_LOT';
const TEST_DATABASE = 'gestion_conges_gmes_test';

/**
 * Protection d'environnement : la fonctionnalité L3 n'est accessible que si
 * le flag est activé ET que la connexion TypeORM cible bien la base de recette.
 */
export function isCarryoverLotsEnvironmentAllowed(
  flag: string | undefined,
  database: string | undefined,
): boolean {
  return flag === 'true' && database === TEST_DATABASE;
}

function mapEngineStatus(result: CarryoverExpiryResult): CarryoverLotStatus {
  if (result.status === CarryoverDelayStatus.SUSPENDU) {
    return CarryoverLotStatus.SUSPENDU;
  }
  if (result.status === CarryoverDelayStatus.EXPIRE) {
    return CarryoverLotStatus.EXPIRE;
  }
  if (result.status === CarryoverDelayStatus.A_VERIFIER) {
    return CarryoverLotStatus.A_VERIFIER;
  }
  return result.effectiveExpiresAt
    ? CarryoverLotStatus.ACTIF
    : CarryoverLotStatus.A_VERIFIER;
}

export interface LotExpiryFields {
  regime: 'GENERAL' | 'ARRET_LONG';
  referencePeriodEnd: string | null;
  absenceStatus: AbsenceStatus | null;
  repriseDate: string | null;
  informationDate: string | null;
  informationDateCertain: boolean | null;
  acquiredDuringL3141_5_5or7: boolean | null;
  suspensionAtLeastOneYearAtPeriodEnd: boolean | null;
}

export interface LotExpiryComputed {
  expiresAt: string | null;
  indicativeExpiresAt: string | null;
  expiryBasis: string;
  status: CarryoverLotStatus;
  engine: CarryoverExpiryResult;
}

/** Calcule l'échéance d'un lot via le moteur L2 (fonction pure). */
export function computeLotExpiry(fields: LotExpiryFields): LotExpiryComputed {
  const engine = computeCarryoverExpiry({
    regime: fields.regime,
    referencePeriodEnd: fields.referencePeriodEnd,
    absenceStatus: fields.absenceStatus,
    repriseDate: fields.repriseDate,
    informationDate: fields.informationDate,
    informationDateCertain: fields.informationDateCertain,
    acquiredDuringL3141_5_5or7: fields.acquiredDuringL3141_5_5or7,
    suspensionAtLeastOneYearAtPeriodEnd: fields.suspensionAtLeastOneYearAtPeriodEnd,
    carryoverMonths: null,
    today: null,
  });
  return {
    expiresAt: engine.effectiveExpiresAt,
    indicativeExpiresAt: engine.indicativeExpiresAt,
    expiryBasis: engine.legalBasis,
    status: mapEngineStatus(engine),
    engine,
  };
}

/** Validation chronologique d'une confirmation (aucune réception future). */
export function validateConfirmationChronology(
  fields: { informationDate: string | null; repriseDate: string | null },
  today: string,
): string[] {
  const errors: string[] = [];
  if (fields.informationDate && fields.informationDate > today) {
    errors.push('Date de réception future : impossible de confirmer une réception non encore établie.');
  }
  if (fields.repriseDate && fields.repriseDate > today) {
    errors.push('Date de reprise future : incohérente avec une réception déjà établie.');
  }
  if (
    fields.informationDate &&
    fields.repriseDate &&
    fields.informationDate < fields.repriseDate
  ) {
    errors.push('Date de réception antérieure à la date de reprise.');
  }
  return errors;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

@Injectable()
export class CarryoverLotsService {
  constructor(
    @InjectRepository(CarryoverLot)
    private readonly lotRepository: Repository<CarryoverLot>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private assertEnvironment(): void {
    const flag = this.configService.get<string>('CARRYOVER_LOTS_ENABLED');
    const database = this.dataSource.options.database;
    if (
      !isCarryoverLotsEnvironmentAllowed(
        flag,
        typeof database === 'string' ? database : undefined,
      )
    ) {
      throw new NotFoundException('Fonctionnalité indisponible.');
    }
  }

  private assertRh(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.RH) {
      throw new ForbiddenException(
        'Vous ne disposez pas des autorisations nécessaires.',
      );
    }
  }

  private async requireEmployee(employeeId: number): Promise<User> {
    const employee = await this.userRepository.findOne({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Salarié #${employeeId} introuvable.`);
    }
    return employee;
  }

  private assertPeriod(period: string, field: string): void {
    try {
      parseReferencePeriod(period);
    } catch (error) {
      throw new BadRequestException(
        `${field} invalide : ${(error as Error).message}`,
      );
    }
  }

  private async periodEndDate(period: string): Promise<string> {
    const startMonthDay = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    return referencePeriodEndDate(period, startMonthDay);
  }

  private async buildLotFields(lot: CarryoverLot): Promise<LotExpiryFields> {
    let referencePeriodEnd = lot.referencePeriodEndDate ?? null;
    if (lot.regime === CarryoverLotRegime.ARRET_LONG && !referencePeriodEnd) {
      referencePeriodEnd = await this.periodEndDate(lot.sourceReferencePeriod);
    }
    return {
      regime:
        lot.regime === CarryoverLotRegime.ARRET_LONG ? 'ARRET_LONG' : 'GENERAL',
      referencePeriodEnd,
      absenceStatus: (lot.absenceStatus as CarryoverLotAbsenceStatus | null) ?? null,
      repriseDate: lot.repriseDate ?? null,
      informationDate: lot.informationDate ?? null,
      informationDateCertain: lot.informationDateCertain ?? null,
      acquiredDuringL3141_5_5or7: lot.acquiredDuringL3141_5_5or7 ?? null,
      suspensionAtLeastOneYearAtPeriodEnd:
        lot.suspensionAtLeastOneYearAtPeriodEnd ?? null,
    };
  }

  private async applyEngine(lot: CarryoverLot): Promise<CarryoverExpiryResult> {
    const computed = computeLotExpiry(await this.buildLotFields(lot));
    lot.expiresAt = computed.expiresAt;
    lot.indicativeExpiresAt = computed.indicativeExpiresAt;
    lot.expiryBasis = computed.expiryBasis;
    lot.status = computed.status;
    return computed.engine;
  }

  private async detail(lot: CarryoverLot): Promise<unknown> {
    const engine = await this.applyEngine(lot);
    const history = await this.auditRepository.find({
      where: { resourceType: RESOURCE_TYPE, resourceId: lot.id },
      order: { createdAt: 'DESC' },
    });
    return {
      ...lot,
      employee: lot.employee ?? null,
      definitiveDisabled: lot.informationDateCertain !== true,
      engine: {
        status: engine.status,
        startDate: engine.startDate,
        deadline: engine.deadline,
        effectiveExpiresAt: engine.effectiveExpiresAt,
        indicativeExpiresAt: engine.indicativeExpiresAt,
        suspension: engine.suspension,
        events: engine.events,
        missingInformation: engine.missingInformation,
        warnings: engine.warnings,
        legalBasis: engine.legalBasis,
        monthsApplied: engine.monthsApplied,
      },
      history: history.map((log) => ({
        id: log.id,
        actorId: log.actorId,
        action: log.action,
        oldValue: log.oldValue,
        newValue: log.newValue,
        createdAt: log.createdAt,
      })),
    };
  }

  private isDuplicateError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  /**
   * Enregistre le lot par UPDATE conditionnel (`WHERE id AND version`) et
   * l'audit avant/après dans la même transaction. Si aucune ligne n'est
   * modifiée (version déjà incrémentée par un concurrent), renvoie 409.
   */
  private async saveWithAudit(
    lot: CarryoverLot,
    action: string,
    before: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<CarryoverLot> {
    const expectedVersion = lot.version;
    const setValues: Record<string, unknown> = {
      employeeId: lot.employeeId,
      sourceReferencePeriod: lot.sourceReferencePeriod,
      targetReferencePeriod: lot.targetReferencePeriod,
      targetCounterType: lot.targetCounterType,
      days: lot.days,
      remainingDays: lot.remainingDays,
      origin: lot.origin,
      regime: lot.regime,
      status: lot.status,
      absenceStatus: lot.absenceStatus,
      absenceStartDate: lot.absenceStartDate,
      absenceEndDate: lot.absenceEndDate,
      repriseDate: lot.repriseDate,
      informationDate: lot.informationDate,
      informationMode: lot.informationMode,
      informationDateCertain: lot.informationDateCertain,
      acquiredDuringL3141_5_5or7: lot.acquiredDuringL3141_5_5or7,
      suspensionAtLeastOneYearAtPeriodEnd:
        lot.suspensionAtLeastOneYearAtPeriodEnd,
      proofId: lot.proofId,
      confirmationStatus: lot.confirmationStatus,
      referencePeriodEndDate: lot.referencePeriodEndDate,
      expiresAt: lot.expiresAt,
      indicativeExpiresAt: lot.indicativeExpiresAt,
      expiryBasis: lot.expiryBasis,
      idempotencyKey: lot.idempotencyKey,
      sourceMovementId: lot.sourceMovementId,
      reason: lot.reason,
      createdById: lot.createdById,
    };

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(CarryoverLot)
        .set({ ...setValues, version: () => 'version + 1' })
        .where('id = :id AND version = :version', {
          id: lot.id,
          version: expectedVersion,
        })
        .execute();

      if (!result.affected || Number(result.affected) === 0) {
        throw new ConflictException(
          'Le lot a été modifié par un autre utilisateur. Rechargez et réessayez.',
        );
      }

      lot.version = expectedVersion + 1;
      await this.auditService.record(
        {
          actorId: actor.id,
          action,
          resourceType: RESOURCE_TYPE,
          resourceId: lot.id,
          oldValue: before,
          newValue: this.sanitizeLot(lot),
        },
        manager,
      );
    });

    return lot;
  }

  private payloadKey(lot: CarryoverLot): string {
    return JSON.stringify([
      lot.employeeId,
      lot.sourceReferencePeriod,
      lot.targetReferencePeriod,
      lot.targetCounterType,
      Number(lot.days),
      lot.remainingDays == null ? null : Number(lot.remainingDays),
      lot.origin,
      lot.regime,
      lot.absenceStatus ?? null,
      lot.absenceStartDate ?? null,
      lot.absenceEndDate ?? null,
      lot.repriseDate ?? null,
      lot.informationDate ?? null,
      lot.informationMode ?? null,
      lot.proofId ?? null,
      lot.reason ?? null,
    ]);
  }

  private dtoPayloadKey(dto: CreateCarryoverLotDto): string {
    return JSON.stringify([
      dto.employeeId,
      dto.sourceReferencePeriod,
      dto.targetReferencePeriod,
      dto.targetCounterType ?? CarryoverLotTargetCounter.N_MINUS_1,
      Number(dto.days),
      dto.remainingDays == null ? null : Number(dto.remainingDays),
      dto.origin ?? CarryoverLotOrigin.AUTRE,
      dto.regime ?? CarryoverLotRegime.GENERAL,
      dto.absenceStatus ?? null,
      dto.absenceStartDate ?? null,
      dto.absenceEndDate ?? null,
      dto.repriseDate ?? null,
      dto.informationDate ?? null,
      dto.informationMode ?? null,
      dto.proofId ?? null,
      dto.reason ?? null,
    ]);
  }

  async create(
    dto: CreateCarryoverLotDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    await this.requireEmployee(dto.employeeId);
    this.assertPeriod(dto.sourceReferencePeriod, 'sourceReferencePeriod');
    this.assertPeriod(dto.targetReferencePeriod, 'targetReferencePeriod');
    if (dto.targetReferencePeriod < dto.sourceReferencePeriod) {
      throw new BadRequestException(
        'La période de rattachement ne peut pas être antérieure à la période d’origine.',
      );
    }

    const days = Number(dto.days);
    if (dto.remainingDays != null && Number(dto.remainingDays) > days) {
      throw new BadRequestException(
        'Le reliquat (remainingDays) ne peut pas dépasser la quantité initiale (days).',
      );
    }

    const regime = dto.regime ?? CarryoverLotRegime.GENERAL;
    const referencePeriodEnd =
      regime === CarryoverLotRegime.ARRET_LONG
        ? await this.periodEndDate(dto.sourceReferencePeriod)
        : null;

    const existing = await this.lotRepository.findOneBy({
      idempotencyKey: dto.idempotencyKey,
    });
    if (existing) {
      if (this.payloadKey(existing) === this.dtoPayloadKey(dto)) {
        return this.detail(existing);
      }
      throw new ConflictException(
        'Clé d’idempotence déjà utilisée avec des données différentes.',
      );
    }

    const lot = this.lotRepository.create({
      employeeId: dto.employeeId,
      sourceReferencePeriod: dto.sourceReferencePeriod,
      targetReferencePeriod: dto.targetReferencePeriod,
      targetCounterType:
        dto.targetCounterType ?? CarryoverLotTargetCounter.N_MINUS_1,
      days,
      remainingDays:
        dto.remainingDays == null ? null : Number(dto.remainingDays),
      origin: dto.origin ?? CarryoverLotOrigin.AUTRE,
      regime,
      absenceStatus: dto.absenceStatus ?? null,
      absenceStartDate: dto.absenceStartDate ?? null,
      absenceEndDate: dto.absenceEndDate ?? null,
      repriseDate: dto.repriseDate ?? null,
      informationDate: dto.informationDate ?? null,
      informationMode: dto.informationMode ?? null,
      proofId: dto.proofId ?? null,
      confirmationStatus: null,
      referencePeriodEndDate: referencePeriodEnd,
      reason: dto.reason ?? null,
      idempotencyKey: dto.idempotencyKey,
      sourceMovementId: null,
      informationDateCertain: null,
      acquiredDuringL3141_5_5or7: null,
      suspensionAtLeastOneYearAtPeriodEnd: null,
      version: 0,
      createdById: actor.id,
    });

    await this.applyEngine(lot);

    let saved: CarryoverLot | null = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        saved = await manager.getRepository(CarryoverLot).save(lot);
        await this.auditService.record(
          {
            actorId: actor.id,
            action: 'CARRYOVER_LOT_CREATED',
            resourceType: RESOURCE_TYPE,
            resourceId: saved.id,
            newValue: this.sanitizeLot(saved),
          },
          manager,
        );
      });
    } catch (error) {
      if (this.isDuplicateError(error)) {
        const raced = await this.lotRepository.findOneBy({
          idempotencyKey: dto.idempotencyKey,
        });
        if (raced && this.payloadKey(raced) === this.dtoPayloadKey(dto)) {
          return this.detail(raced);
        }
        throw new ConflictException(
          'Clé d’idempotence déjà utilisée avec des données différentes.',
        );
      }
      throw error;
    }

    return this.detail(saved!);
  }

  async listByEmployee(employeeId: number, actor: AuthenticatedUser) {
    this.assertEnvironment();
    this.assertRh(actor);
    await this.requireEmployee(employeeId);
    const lots = await this.lotRepository.find({
      where: { employeeId },
      relations: { employee: true },
      order: { createdAt: 'DESC' },
    });
    const detailed: unknown[] = [];
    for (const lot of lots) {
      detailed.push(await this.detail(lot));
    }
    return detailed;
  }

  async findOne(id: number, actor: AuthenticatedUser) {
    this.assertEnvironment();
    this.assertRh(actor);
    const lot = await this.lotRepository.findOne({
      where: { id },
      relations: { employee: true, createdBy: true },
    });
    if (!lot) {
      throw new NotFoundException(`Lot #${id} introuvable.`);
    }
    return this.detail(lot);
  }

  async update(id: number, dto: UpdateCarryoverLotDto, actor: AuthenticatedUser) {
    this.assertEnvironment();
    this.assertRh(actor);
    const lot = await this.lotRepository.findOneBy({ id });
    if (!lot) {
      throw new NotFoundException(`Lot #${id} introuvable.`);
    }

    const before = this.sanitizeLot(lot);
    const sourceChanged = dto.sourceReferencePeriod !== undefined;
    const regimeChanged = dto.regime !== undefined;

    if (dto.sourceReferencePeriod !== undefined) {
      this.assertPeriod(dto.sourceReferencePeriod, 'sourceReferencePeriod');
      lot.sourceReferencePeriod = dto.sourceReferencePeriod;
    }
    if (dto.targetReferencePeriod !== undefined) {
      this.assertPeriod(dto.targetReferencePeriod, 'targetReferencePeriod');
      lot.targetReferencePeriod = dto.targetReferencePeriod;
    }
    if (lot.targetReferencePeriod < lot.sourceReferencePeriod) {
      throw new BadRequestException(
        'La période de rattachement ne peut pas être antérieure à la période d’origine.',
      );
    }
    if (dto.targetCounterType !== undefined) {
      lot.targetCounterType = dto.targetCounterType;
    }
    if (dto.days !== undefined) lot.days = Number(dto.days);
    if (dto.remainingDays !== undefined) {
      lot.remainingDays =
        dto.remainingDays == null ? null : Number(dto.remainingDays);
    }
    if (lot.remainingDays != null && lot.remainingDays > lot.days) {
      throw new BadRequestException(
        'Le reliquat (remainingDays) ne peut pas dépasser la quantité initiale (days).',
      );
    }
    if (dto.origin !== undefined) lot.origin = dto.origin;
    if (dto.regime !== undefined) lot.regime = dto.regime;
    if (dto.absenceStatus !== undefined) lot.absenceStatus = dto.absenceStatus;
    if (dto.absenceStartDate !== undefined) lot.absenceStartDate = dto.absenceStartDate;
    if (dto.absenceEndDate !== undefined) lot.absenceEndDate = dto.absenceEndDate;
    if (dto.repriseDate !== undefined) lot.repriseDate = dto.repriseDate;
    if (dto.informationDate !== undefined) lot.informationDate = dto.informationDate;
    if (dto.informationMode !== undefined) lot.informationMode = dto.informationMode;
    if (dto.proofId !== undefined) lot.proofId = dto.proofId;
    if (dto.reason !== undefined) lot.reason = dto.reason;

    // Fige la date de fin de période de référence utilisée pour ARRET_LONG :
    // un changement ultérieur de REFERENCE_PERIOD_START ne recalcule pas
    // silencieusement une échéance historique.
    if (
      lot.regime === CarryoverLotRegime.ARRET_LONG &&
      (sourceChanged || regimeChanged || !lot.referencePeriodEndDate)
    ) {
      lot.referencePeriodEndDate = await this.periodEndDate(
        lot.sourceReferencePeriod,
      );
    }

    await this.applyEngine(lot);
    const saved = await this.saveWithAudit(
      lot,
      'CARRYOVER_LOT_UPDATED',
      before,
      actor,
    );
    return this.detail(saved);
  }

  /** Vérifie que le justificatif concerne bien le salarié (contrôle best-effort). */
  private async checkProofOwnership(
    proof: Document,
    employeeId: number,
  ): Promise<string | null> {
    if (proof.uploadedById == null) return null;
    if (proof.uploadedById === employeeId) return null;
    const uploader = await this.userRepository.findOneBy({
      id: proof.uploadedById,
    });
    if (uploader && (uploader.role === UserRole.RH || uploader.role === UserRole.ADMIN)) {
      return null;
    }
    return 'Le justificatif est rattaché à un autre salarié.';
  }

  async confirm(id: number, dto: ConfirmCarryoverLotDto, actor: AuthenticatedUser) {
    this.assertEnvironment();
    this.assertRh(actor);
    const lot = await this.lotRepository.findOneBy({ id });
    if (!lot) {
      throw new NotFoundException(`Lot #${id} introuvable.`);
    }

    const proof = await this.documentRepository.findOneBy({ id: dto.proofId });
    if (!proof) {
      throw new BadRequestException(
        `Justificatif #${dto.proofId} introuvable : la preuve de réception est obligatoire.`,
      );
    }

    const ownershipError = await this.checkProofOwnership(proof, lot.employeeId);
    if (ownershipError) {
      throw new BadRequestException(ownershipError);
    }

    const chronoErrors = validateConfirmationChronology(
      { informationDate: lot.informationDate, repriseDate: lot.repriseDate },
      todayIso(),
    );
    if (chronoErrors.length > 0) {
      throw new BadRequestException(
        `Confirmation refusée : ${chronoErrors.join(' ')}`,
      );
    }

    if (lot.regime === CarryoverLotRegime.GENERAL && !lot.informationDate) {
      throw new BadRequestException(
        'Confirmation refusée : date de réception des informations obligatoires (L3141-19-3) absente.',
      );
    }
    if (
      lot.regime === CarryoverLotRegime.ARRET_LONG &&
      (lot.absenceStatus === CarryoverLotAbsenceStatus.REPRIS || lot.repriseDate) &&
      !lot.informationDate
    ) {
      throw new BadRequestException(
        'Confirmation refusée : date de réception des informations obligatoires absente pour lever la suspension.',
      );
    }

    if (
      lot.regime === CarryoverLotRegime.ARRET_LONG &&
      (dto.acquiredDuringL3141_5_5or7 !== true ||
        dto.suspensionAtLeastOneYearAtPeriodEnd !== true)
    ) {
      throw new BadRequestException(
        'Confirmation refusée : les deux conditions L3141-19-2 (congés acquis pendant les périodes L3141-5 5°/7° ET suspension ≥ 1 an à la fin de la période) doivent être validées.',
      );
    }

    const before = this.sanitizeLot(lot);

    // La présence d'un document ne confirme JAMAIS automatiquement une
    // réception à date certaine : la conversion en échéance définitive est
    // désactivée (lot conservé « confirmation en attente », sans expiresAt).
    lot.proofId = dto.proofId;
    lot.confirmationStatus = CarryoverLotConfirmationStatus.EN_ATTENTE;
    lot.reason = dto.reason;

    await this.applyEngine(lot);
    const saved = await this.saveWithAudit(
      lot,
      'CARRYOVER_LOT_CONFIRMATION_PENDING',
      before,
      actor,
    );
    return this.detail(saved);
  }

  private sanitizeLot(lot: CarryoverLot): Record<string, unknown> {
    return {
      id: lot.id,
      employeeId: lot.employeeId,
      sourceReferencePeriod: lot.sourceReferencePeriod,
      targetReferencePeriod: lot.targetReferencePeriod,
      targetCounterType: lot.targetCounterType,
      days: lot.days,
      remainingDays: lot.remainingDays,
      origin: lot.origin,
      regime: lot.regime,
      status: lot.status,
      absenceStatus: lot.absenceStatus,
      absenceStartDate: lot.absenceStartDate,
      absenceEndDate: lot.absenceEndDate,
      repriseDate: lot.repriseDate,
      informationDate: lot.informationDate,
      informationMode: lot.informationMode,
      informationDateCertain: lot.informationDateCertain,
      acquiredDuringL3141_5_5or7: lot.acquiredDuringL3141_5_5or7,
      suspensionAtLeastOneYearAtPeriodEnd:
        lot.suspensionAtLeastOneYearAtPeriodEnd,
      proofId: lot.proofId,
      confirmationStatus: lot.confirmationStatus,
      referencePeriodEndDate: lot.referencePeriodEndDate,
      expiresAt: lot.expiresAt,
      indicativeExpiresAt: lot.indicativeExpiresAt,
      expiryBasis: lot.expiryBasis,
      reason: lot.reason,
    };
  }
}
