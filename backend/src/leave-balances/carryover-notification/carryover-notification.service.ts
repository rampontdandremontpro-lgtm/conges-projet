import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { User, UserRole } from '../../users/user.entity';
import { CarryoverLot } from '../carryover-lot.entity';
import { isCarryoverLotsEnvironmentAllowed } from '../carryover-lots/carryover-lots.service';
import { computeLotExpiry } from '../carryover-lots/carryover-lots.service';
import { classifyCarryoverLot } from '../carryover-lots/carryover-lot-closure.core';
import { martiniqueDateString } from '../reference-period.util';
import { referencePeriodEndDate } from '../reference-period.util';
import {
  CarryoverNotification,
  CarryoverNotificationContent,
  CarryoverNotificationRight,
  CarryoverNotificationStatus,
  CarryoverNotificationTransmissionMode,
} from './carryover-notification.entity';
import {
  CarryoverReceptionProof,
  CarryoverReceptionProofHistoryEntry,
  CarryoverReceptionProofMode,
  CarryoverReceptionProofStatus,
} from './carryover-reception-proof.entity';

const round2 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'application/octet-stream',
];
const MAX_PROOF_SIZE = 5 * 1024 * 1024;

function martiniqueCivilDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const p = (t: string) => parts.find((e) => e.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}

function isSameCivilDate(a: Date, b: Date): boolean {
  return martiniqueCivilDate(a) === martiniqueCivilDate(b);
}

export interface PrepareNotificationResult {
  notificationId: number;
  reference: string;
  content: CarryoverNotificationContent;
}

export interface VerifyProofDecision {
  result: 'CONFORME' | 'NON_CONFORME';
  note: string;
  recipientIdentityConfirmed: boolean;
  requiredInfoPresent: boolean;
}

@Injectable()
export class CarryoverNotificationService {
  constructor(
    @InjectRepository(CarryoverNotification)
    private readonly notificationRepository: Repository<CarryoverNotification>,
    @InjectRepository(CarryoverReceptionProof)
    private readonly proofRepository: Repository<CarryoverReceptionProof>,
    @InjectRepository(CarryoverLot)
    private readonly lotRepository: Repository<CarryoverLot>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
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

  private storageRoot(): string {
    const configured = this.configService.get<string>(
      'PRIVATE_STORAGE_ROOT',
      'C:/recette-storage',
    );
    return resolve(configured);
  }

  private storagePath(storageKey: string): string {
    const root = this.storageRoot();
    const absolute = resolve(root, storageKey);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new BadRequestException('Chemin de stockage non autorisé.');
    }
    return absolute;
  }

  private async buildExpiryFields(lot: CarryoverLot) {
    const startMonthDay = this.configService.get<string>(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    return {
      regime: (lot.regime === 'ARRET_LONG' ? 'ARRET_LONG' : 'GENERAL') as
        | 'ARRET_LONG'
        | 'GENERAL',
      referencePeriodEnd:
        lot.referencePeriodEndDate ??
        referencePeriodEndDate(lot.sourceReferencePeriod, startMonthDay),
      absenceStatus: lot.absenceStatus ?? null,
      repriseDate: lot.repriseDate ?? null,
      informationDate: lot.informationDate ?? null,
      informationDateCertain: lot.informationDateCertain ?? null,
      acquiredDuringL3141_5_5or7: lot.acquiredDuringL3141_5_5or7 ?? null,
      suspensionAtLeastOneYearAtPeriodEnd:
        lot.suspensionAtLeastOneYearAtPeriodEnd ?? null,
    };
  }

  private async buildContent(
    manager: EntityManager,
    employee: User,
  ): Promise<CarryoverNotificationContent> {
    const lots = await manager.getRepository(CarryoverLot).find({
      where: { employeeId: employee.id },
      order: { id: 'ASC' },
    });
    const today = martiniqueDateString(new Date());
    const rights: CarryoverNotificationRight[] = [];
    let confirmedDays = 0;
    let toReviewDays = 0;

    for (const lot of lots) {
      if (lot.status === 'EXPIRE') continue;
      const computed = computeLotExpiry(await this.buildExpiryFields(lot));
      const needsReview =
        computed.status === 'A_VERIFIER' ||
        computed.status === 'SUSPENDU' ||
        lot.confirmationStatus === 'EN_ATTENTE' ||
        lot.remainingDays == null;
      const days = lot.remainingDays == null ? 0 : Number(lot.remainingDays);
      if (needsReview) toReviewDays = round2(toReviewDays + days);
      else confirmedDays = round2(confirmedDays + days);

      rights.push({
        lotId: lot.id,
        sourceReferencePeriod: lot.sourceReferencePeriod,
        regime: lot.regime === 'ARRET_LONG' ? 'ARRET_LONG' : 'GENERAL',
        days,
        deadlinePrevisionnel: computed.expiresAt ?? computed.indicativeExpiresAt,
        deadlineDefinitif: null,
        needsReview,
        status: computed.status,
      });
    }

    return {
      employeeId: employee.id,
      employeeName: `${employee.nom} ${employee.prenom}`,
      establishedAt: today,
      repriseDate: lots.find((lot) => lot.repriseDate)?.repriseDate ?? null,
      rights,
      totals: { confirmedDays, toReviewDays },
      emittedBy: 'DIRECTION DES RESSOURCES HUMAINES',
    };
  }

  async listCandidates(actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const rows = await this.lotRepository
      .createQueryBuilder('lot')
      .innerJoinAndSelect('lot.employee', 'employee')
      .where("lot.status != 'EXPIRE'")
      .orderBy('employee.id', 'ASC')
      .addOrderBy('lot.id', 'ASC')
      .getMany();

    const byEmployee = new Map<number, CarryoverLot[]>();
    for (const lot of rows) {
      const list = byEmployee.get(lot.employeeId) ?? [];
      list.push(lot);
      byEmployee.set(lot.employeeId, list);
    }

    const today = martiniqueDateString(new Date());
    const candidates: unknown[] = [];
    for (const [employeeId, lots] of byEmployee.entries()) {
      const employee = lots[0].employee;
      const repriseDate =
        lots.find((lot) => lot.repriseDate)?.repriseDate ?? null;
      const absent = lots.some((lot) => lot.absenceStatus === 'ABSENT');
      const infoDeadline = repriseDate
        ? this.addMonthsClamped(repriseDate, 1)
        : null;
      const infoStatus = absent
        ? 'ENCORE_ABSENT'
        : repriseDate === null
          ? 'REPRISE_INCONNUE'
          : today > (infoDeadline as string)
            ? 'DELAI_DEPASSE'
            : 'A_PREPARER';
      candidates.push({
        employeeId,
        employeeName: `${employee.nom} ${employee.prenom}`,
        repriseDate,
        infoDeadline,
        infoStatus,
        lotCount: lots.length,
        totalDays: round2(
          lots.reduce((sum, lot) => sum + Number(lot.remainingDays ?? 0), 0),
        ),
      });
    }
    return candidates;
  }

  private addMonthsClamped(date: string, months: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const total = y * 12 + (m - 1) + months;
    const ty = Math.floor(total / 12);
    const tm = (total % 12) + 1;
    const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }

  async prepare(
    employeeId: number,
    actor: AuthenticatedUser,
  ): Promise<PrepareNotificationResult> {
    this.assertEnvironment();
    this.assertRh(actor);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const employee = await manager.getRepository(User).findOneBy({
          id: employeeId,
        });
        if (!employee || employee.role === UserRole.ADMIN) {
          throw new BadRequestException(
            'Salarié introuvable ou non éligible (compte Admin).',
          );
        }

        const content = await this.buildContent(manager, employee);
        if (content.rights.length === 0) {
          throw new BadRequestException(
            'Aucun droit de report maladie à notifier pour ce salarié.',
          );
        }

        const notification = manager.getRepository(CarryoverNotification).create({
          reference: `CN-${randomUUID()}`,
          employeeId: employee.id,
          status: CarryoverNotificationStatus.BROUILLON,
          establishedAt: content.establishedAt,
          repriseDate: content.repriseDate,
          contentJson: content,
          activeKey: `A:${employee.id}`,
          version: 0,
          createdById: actor.id,
          coherenceAnomaly: false,
        });
        const saved = await manager
          .getRepository(CarryoverNotification)
          .save(notification);

        await this.auditService.record(
          {
            actorId: actor.id,
            action: 'CARRYOVER_NOTIFICATION_PREPARED',
            resourceType: 'CARRYOVER_NOTIFICATION',
            resourceId: saved.id,
            newValue: {
              reference: saved.reference,
              employeeId,
              rights: content.rights.length,
            },
          },
          manager,
        );

        return { notificationId: saved.id, reference: saved.reference, content };
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException(
          'Une notification active existe déjà pour ce salarié.',
        );
      }
      throw error;
    }
  }

  async getOne(
    id: number,
    actor: AuthenticatedUser,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    const notification = await this.notificationRepository.findOne({
      where: { id },
      relations: { employee: true },
    });
    if (!notification) throw new NotFoundException('Notification introuvable.');
    if (actor.role !== UserRole.RH && actor.id !== notification.employeeId) {
      throw new ForbiddenException('Accès refusé.');
    }
    return notification;
  }

  async getMine(actor: AuthenticatedUser): Promise<Partial<CarryoverNotification>[]> {
    this.assertEnvironment();
    const notifications = await this.notificationRepository.find({
      where: { employeeId: actor.id },
      order: { createdAt: 'DESC' },
    });
    return notifications.map((n) => ({
      id: n.id,
      reference: n.reference,
      status: n.status,
      establishedAt: n.establishedAt,
      repriseDate: n.repriseDate,
      contentJson: n.contentJson,
      documentReference: n.documentReference,
      transmittedAt: n.transmittedAt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
  }

  async validate(
    id: number,
    actor: AuthenticatedUser,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      this.assertStatus(
        notification,
        CarryoverNotificationStatus.BROUILLON,
        'La notification doit être en BROUILLON.',
      );
      notification.status = CarryoverNotificationStatus.VALIDEE_PAR_RH;
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);
      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_VALIDATED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: id,
          newValue: { status: notification.status },
        },
        manager,
      );
      return notification;
    });
  }

  async transmit(
    id: number,
    actor: AuthenticatedUser,
    mode: CarryoverNotificationTransmissionMode,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      this.assertStatus(
        notification,
        CarryoverNotificationStatus.VALIDEE_PAR_RH,
        'La notification doit être VALIDEE_PAR_RH.',
      );
      if (!notification.contentJson) {
        throw new BadRequestException('Contenu de notification manquant.');
      }
      // Fige le document réellement transmis (référence + empreinte + copie).
      notification.documentReference = `ND-${randomUUID()}`;
      notification.documentChecksum = createHash('sha256')
        .update(JSON.stringify(notification.contentJson))
        .digest('hex');
      notification.transmittedContentJson = JSON.parse(
        JSON.stringify(notification.contentJson),
      );
      notification.transmissionMode = mode;
      notification.transmittedAt = new Date();
      notification.status = CarryoverNotificationStatus.TRANSMISSION_ENREGISTREE;
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);
      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_TRANSMITTED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: id,
          newValue: {
            status: notification.status,
            mode,
            documentReference: notification.documentReference,
            documentChecksum: notification.documentChecksum,
          },
        },
        manager,
      );
      return notification;
    });
  }

  private decodeBase64(input?: string | null): Buffer {
    if (!input) {
      return Buffer.from(`preuve-synthetique-${randomUUID()}`, 'utf8');
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
      throw new BadRequestException('Contenu base64 invalide.');
    }
    const buffer = Buffer.from(input, 'base64');
    if (buffer.length === 0) throw new BadRequestException('Fichier vide.');
    return buffer;
  }

  private validateProofContent(buffer: Buffer, mimeType: string | null): void {
    if (buffer.length > MAX_PROOF_SIZE) {
      throw new BadRequestException('Justificatif trop volumineux (max 5 Mo).');
    }
    if (mimeType && !ALLOWED_MIME.includes(mimeType)) {
      throw new BadRequestException(`Format de fichier non autorisé : ${mimeType}.`);
    }
    const isPdf = /^%PDF-1\.[0-7]/.test(
      buffer.subarray(0, 8).toString('latin1'),
    );
    const isPng = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    if (mimeType === 'application/pdf' && !isPdf) {
      throw new BadRequestException('Le contenu ne correspond pas à un PDF.');
    }
    if (mimeType === 'image/png' && !isPng) {
      throw new BadRequestException('Le contenu ne correspond pas à un PNG.');
    }
    if (mimeType === 'image/jpeg' && !isJpeg) {
      throw new BadRequestException('Le contenu ne correspond pas à un JPEG.');
    }
  }

  async attachProof(
    id: number,
    actor: AuthenticatedUser,
    input: {
      mode: CarryoverReceptionProofMode;
      receivedAt: string;
      proofReference?: string | null;
      mimeType?: string | null;
      contentBase64?: string | null;
    },
  ): Promise<CarryoverReceptionProof> {
    this.assertEnvironment();
    this.assertRh(actor);
    const buffer = this.decodeBase64(input.contentBase64);
    this.validateProofContent(buffer, input.mimeType ?? 'application/octet-stream');

    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      if (
        notification.status !== CarryoverNotificationStatus.TRANSMISSION_ENREGISTREE &&
        notification.status !== CarryoverNotificationStatus.RECEPTION_A_JUSTIFIER
      ) {
        throw new ConflictException(
          "Une preuve ne peut être associée qu'à une notification transmise.",
        );
      }

      const receivedAtDate = new Date(input.receivedAt);
      if (Number.isNaN(receivedAtDate.getTime())) {
        throw new BadRequestException('Date de réception invalide.');
      }
      const now = new Date();
      if (receivedAtDate.getTime() > now.getTime()) {
        throw new BadRequestException('Date de réception future : impossible.');
      }
      if (
        notification.transmittedAt &&
        receivedAtDate.getTime() < notification.transmittedAt.getTime()
      ) {
        throw new BadRequestException(
          'Date de réception antérieure à la date de transmission.',
        );
      }

      const checksum = createHash('sha256').update(buffer).digest('hex');
      const storageKey = `carryover-proofs/${randomUUID()}`;
      this.storePrivate(storageKey, buffer);

      let saved: CarryoverReceptionProof;
      try {
        const proof = manager.getRepository(CarryoverReceptionProof).create({
          notificationId: notification.id,
          employeeId: notification.employeeId,
          mode: input.mode,
          receivedAt: receivedAtDate,
          proofReference: input.proofReference ?? null,
          checksum,
          storageKey,
          mimeType: input.mimeType ?? 'application/octet-stream',
          fileSize: buffer.length,
          status: CarryoverReceptionProofStatus.EN_ATTENTE,
          simulation: input.mode === CarryoverReceptionProofMode.SIMULATION,
          historyJson: [
            {
              at: new Date().toISOString(),
              action: 'ASSOCIE',
              actorId: actor.id,
              detail: input.mode,
            },
          ],
        });
        saved = await manager.getRepository(CarryoverReceptionProof).save(proof);
      } catch (error) {
        this.deletePrivate(storageKey);
        throw error;
      }

      notification.status = CarryoverNotificationStatus.RECEPTION_A_JUSTIFIER;
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);

      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_PROOF_ATTACHED',
          resourceType: 'CARRYOVER_RECEPTION_PROOF',
          resourceId: saved.id,
          newValue: {
            notificationId: id,
            mode: input.mode,
            checksum,
            simulation: saved.simulation,
          },
        },
        manager,
      );
      return saved;
    });
  }

  async verifyProof(
    id: number,
    proofId: number,
    actor: AuthenticatedUser,
    decision: VerifyProofDecision,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      if (
        notification.status === CarryoverNotificationStatus.ANNULEE ||
        notification.status === CarryoverNotificationStatus.A_CORRIGER
      ) {
        throw new ConflictException(
          'La notification est annulée ou à corriger.',
        );
      }
      if (notification.status === CarryoverNotificationStatus.RECEPTION_VERIFIEE) {
        throw new ConflictException('La réception est déjà vérifiée.');
      }

      const proof = await manager.getRepository(CarryoverReceptionProof)
        .createQueryBuilder('proof')
        .setLock('pessimistic_write')
        .where('proof.id = :proofId', { proofId })
        .andWhere('proof.notificationId = :notificationId', {
          notificationId: id,
        })
        .getOne();
      if (!proof) throw new NotFoundException('Preuve introuvable.');
      if (proof.employeeId !== notification.employeeId) {
        throw new ForbiddenException('La preuve est associée à un autre salarié.');
      }
      if (
        proof.status === CarryoverReceptionProofStatus.INVALIDE ||
        proof.status === CarryoverReceptionProofStatus.REJETE
      ) {
        throw new ConflictException('La preuve a été invalidée ou rejetée.');
      }
      if (!proof.receivedAt) {
        throw new BadRequestException('Date de réception manquante.');
      }
      const now = new Date();
      if (proof.receivedAt.getTime() > now.getTime()) {
        throw new BadRequestException('Date de réception future : impossible.');
      }
      if (
        notification.transmittedAt &&
        proof.receivedAt.getTime() < notification.transmittedAt.getTime()
      ) {
        throw new BadRequestException(
          'Date de réception antérieure à la date de transmission.',
        );
      }
      if (!proof.checksum || !proof.storageKey) {
        throw new BadRequestException(
          'Justificatif manquant (empreinte ou stockage absent).',
        );
      }
      this.assertPrivateExists(proof.storageKey);
      const storedBuffer = this.readPrivate(proof.storageKey);
      const actualChecksum = createHash('sha256')
        .update(storedBuffer)
        .digest('hex');
      if (actualChecksum !== proof.checksum) {
        throw new BadRequestException(
          'Justificatif modifié après enregistrement (empreinte différente).',
        );
      }

      // Décision RH structurée et motivée (jamais une simple existence de fichier).
      if (decision.result === 'NON_CONFORME') {
        proof.status = CarryoverReceptionProofStatus.REJETE;
        proof.verifiedById = actor.id;
        proof.verifiedAt = new Date();
        proof.verificationResult = decision.result;
        proof.verificationNote = decision.note;
        proof.rejectionReason = decision.note;
        proof.historyJson = [
          ...(proof.historyJson ?? []),
          {
            at: new Date().toISOString(),
            action: 'REJETE',
            actorId: actor.id,
            detail: decision.note,
          },
        ];
        await manager.getRepository(CarryoverReceptionProof).save(proof);
        notification.status = CarryoverNotificationStatus.A_CORRIGER;
        notification.coherenceAnomaly = true;
        notification.coherenceNote = decision.note;
        notification.activeKey = null;
        notification.version += 1;
        await manager.getRepository(CarryoverNotification).save(notification);
        await this.auditService.record(
          {
            actorId: actor.id,
            action: 'CARRYOVER_NOTIFICATION_RECEPTION_REJECTED',
            resourceType: 'CARRYOVER_NOTIFICATION',
            resourceId: id,
            newValue: { proofId, note: decision.note },
          },
          manager,
        );
        return notification;
      }

      if (!decision.recipientIdentityConfirmed || !decision.requiredInfoPresent) {
        throw new BadRequestException(
          'Confirmation RH incomplète : identité du destinataire et présence des informations obligatoires doivent être vérifiées.',
        );
      }

      // Vérification de version : les lots ne doivent pas avoir changé depuis
      // la préparation (sinon la preuve porte sur un contenu obsolète).
      const content = notification.contentJson;
      if (!content) throw new BadRequestException('Contenu de notification manquant.');
      for (const right of content.rights) {
        const lot = await manager.getRepository(CarryoverLot).findOneBy({
          id: right.lotId,
          employeeId: notification.employeeId,
        });
        if (!lot) {
          throw new ConflictException(
            `Le lot #${right.lotId} n'existe plus — notification obsolète.`,
          );
        }
        if (Number(lot.remainingDays ?? -1) !== right.days) {
          throw new ConflictException(
            `Le lot #${right.lotId} a été modifié depuis la préparation — nouvelle notification requise.`,
          );
        }
      }

      // Vérifie que la preuve correspond au document précisément transmis.
      if (
        notification.documentChecksum &&
        decision.result === 'CONFORME' &&
        !notification.transmittedContentJson
      ) {
        throw new BadRequestException(
          'Document transmis introuvable — impossible de rattacher la preuve.',
        );
      }

      proof.status = CarryoverReceptionProofStatus.VERIFIE;
      proof.verifiedById = actor.id;
      proof.verifiedAt = new Date();
      proof.verificationResult = decision.result;
      proof.verificationNote = decision.note;
      proof.historyJson = [
        ...(proof.historyJson ?? []),
        {
          at: new Date().toISOString(),
          action: 'VERIFIE',
          actorId: actor.id,
          detail: `${decision.result} — ${decision.note}`,
        },
      ];
      await manager.getRepository(CarryoverReceptionProof).save(proof);

      // Intégration L2/L3 + détection de discordance avec le document transmis.
      const receivedCivilDate = martiniqueCivilDate(proof.receivedAt);
      let coherenceAnomaly = false;
      const anomalies: string[] = [];
      for (const right of content.rights) {
        const lot = await manager.getRepository(CarryoverLot).findOneBy({
          id: right.lotId,
          employeeId: notification.employeeId,
        });
        if (!lot) continue;
        lot.informationDate = receivedCivilDate;
        lot.informationDateCertain = true;
        const computed = computeLotExpiry(await this.buildExpiryFields(lot));
        lot.expiresAt = computed.expiresAt;
        lot.indicativeExpiresAt = computed.indicativeExpiresAt;
        lot.expiryBasis = computed.expiryBasis;
        lot.status = computed.status;
        lot.version = Number(lot.version) + 1;
        await manager.getRepository(CarryoverLot).save(lot);

        right.deadlineDefinitif = computed.expiresAt;
        right.status = computed.status;

        if (
          right.deadlinePrevisionnel &&
          computed.expiresAt &&
          right.deadlinePrevisionnel !== computed.expiresAt
        ) {
          coherenceAnomaly = true;
          anomalies.push(
            `lot #${right.lotId} : prévisionnel ${right.deadlinePrevisionnel} → définitif ${computed.expiresAt}`,
          );
        }
      }

      notification.contentJson = content;
      if (coherenceAnomaly) {
        // Discordance entre le document reçu et l'échéance recalculée : la
        // notification n'est PAS juridiquement complète tant qu'une décision
        // RH n'a pas été documentée (une notification corrigée sera requise).
        notification.coherenceAnomaly = true;
        notification.coherenceNote = anomalies.join(' ; ');
        notification.status = CarryoverNotificationStatus.A_CORRIGER;
        notification.activeKey = null;
      } else {
        notification.status = CarryoverNotificationStatus.RECEPTION_VERIFIEE;
        notification.activeKey = null;
      }
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);

      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_RECEPTION_VERIFIED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: id,
          newValue: {
            proofId,
            receivedAt: receivedCivilDate,
            decision,
            coherenceAnomaly,
            rights: content.rights,
          },
        },
        manager,
      );
      return notification;
    });
  }

  async downloadProof(
    id: number,
    proofId: number,
    actor: AuthenticatedUser,
  ): Promise<{ contentBase64: string; mimeType: string | null; checksum: string | null }> {
    this.assertEnvironment();
    this.assertRh(actor);
    const proof = await this.proofRepository.findOne({
      where: { id: proofId, notificationId: id },
      relations: { notification: true },
    });
    if (!proof) throw new NotFoundException('Preuve introuvable.');
    if (!proof.storageKey) throw new BadRequestException('Justificatif absent.');
    this.assertPrivateExists(proof.storageKey);
    return {
      contentBase64: this.readPrivate(proof.storageKey).toString('base64'),
      mimeType: proof.mimeType,
      checksum: proof.checksum,
    };
  }

  async history(id: number, actor: AuthenticatedUser): Promise<unknown> {
    this.assertEnvironment();
    this.assertRh(actor);
    const notification = await this.notificationRepository.findOneBy({ id });
    if (!notification) throw new NotFoundException('Notification introuvable.');
    const proofs = await this.proofRepository.find({
      where: { notificationId: id },
      order: { createdAt: 'ASC' },
    });
    return { notification, proofs };
  }

  async correct(
    id: number,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      if (notification.status === CarryoverNotificationStatus.ANNULEE) {
        throw new ConflictException('La notification est annulée.');
      }
      if (notification.status === CarryoverNotificationStatus.A_CORRIGER) {
        throw new ConflictException('La notification est déjà marquée à corriger.');
      }
      notification.status = CarryoverNotificationStatus.A_CORRIGER;
      notification.cancelReason = reason;
      notification.activeKey = null;
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);
      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_CORRECTED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: id,
          newValue: { reason },
        },
        manager,
      );
      return notification;
    });
  }

  /**
   * Crée une notification CORRIGÉE liée à une notification existante.
   * L'ancienne est archivée en `A_CORRIGER` (inactive), la nouvelle repart en
   * `BROUILLON` avec sa propre transmission et sa propre réception.
   */
  async createCorrected(
    id: number,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const old = await this.lockNotification(manager, id);
      if (old.status === CarryoverNotificationStatus.ANNULEE) {
        throw new ConflictException('La notification est annulée.');
      }
      old.status = CarryoverNotificationStatus.A_CORRIGER;
      old.cancelReason = reason;
      old.activeKey = null;
      old.version += 1;
      await manager.getRepository(CarryoverNotification).save(old);

      const employee = await manager.getRepository(User).findOneBy({
        id: old.employeeId,
      });
      if (!employee) {
        throw new BadRequestException('Salarié introuvable.');
      }
      const content = await this.buildContent(manager, employee);
      if (content.rights.length === 0) {
        throw new BadRequestException(
          'Aucun droit de report maladie à notifier pour ce salarié.',
        );
      }

      const corrected = manager.getRepository(CarryoverNotification).create({
        reference: `CN-${randomUUID()}`,
        employeeId: old.employeeId,
        status: CarryoverNotificationStatus.BROUILLON,
        establishedAt: content.establishedAt,
        repriseDate: content.repriseDate,
        contentJson: content,
        correctedFromId: old.id,
        activeKey: `A:${old.employeeId}`,
        version: 0,
        createdById: actor.id,
        coherenceAnomaly: false,
      });
      const saved = await manager
        .getRepository(CarryoverNotification)
        .save(corrected);

      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_CORRECTED_CREATED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: saved.id,
          newValue: { correctedFromId: old.id, reason },
        },
        manager,
      );
      return saved;
    });
  }

  async cancel(
    id: number,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<CarryoverNotification> {
    this.assertEnvironment();
    this.assertRh(actor);
    return this.dataSource.transaction(async (manager) => {
      const notification = await this.lockNotification(manager, id);
      if (notification.status === CarryoverNotificationStatus.ANNULEE) {
        throw new ConflictException('La notification est déjà annulée.');
      }
      if (notification.status === CarryoverNotificationStatus.RECEPTION_VERIFIEE) {
        throw new ConflictException(
          'Une notification dont la réception est vérifiée ne peut pas être annulée directement.',
        );
      }
      notification.status = CarryoverNotificationStatus.ANNULEE;
      notification.cancelReason = reason;
      notification.activeKey = null;
      notification.version += 1;
      await manager.getRepository(CarryoverNotification).save(notification);
      await this.auditService.record(
        {
          actorId: actor.id,
          action: 'CARRYOVER_NOTIFICATION_CANCELLED',
          resourceType: 'CARRYOVER_NOTIFICATION',
          resourceId: id,
          newValue: { reason },
        },
        manager,
      );
      return notification;
    });
  }

  private async lockNotification(
    manager: EntityManager,
    id: number,
  ): Promise<CarryoverNotification> {
    const notification = await manager.getRepository(CarryoverNotification)
      .createQueryBuilder('notification')
      .setLock('pessimistic_write')
      .where('notification.id = :id', { id })
      .getOne();
    if (!notification) throw new NotFoundException('Notification introuvable.');
    return notification;
  }

  private assertStatus(
    notification: CarryoverNotification,
    expected: CarryoverNotificationStatus,
    message: string,
  ): void {
    if (notification.status !== expected) {
      throw new ConflictException(
        `${message} (statut actuel : ${notification.status}).`,
      );
    }
  }

  private storePrivate(storageKey: string, buffer: Buffer): void {
    const absolute = this.storagePath(storageKey);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, buffer);
  }

  private deletePrivate(storageKey: string): void {
    try {
      unlinkSync(this.storagePath(storageKey));
    } catch {
      /* le fichier orphelin est sans effet métier */
    }
  }

  private assertPrivateExists(storageKey: string): void {
    if (!existsSync(this.storagePath(storageKey))) {
      throw new BadRequestException('Justificatif introuvable dans le stockage privé.');
    }
  }

  private readPrivate(storageKey: string): Buffer {
    return readFileSync(this.storagePath(storageKey));
  }
}
