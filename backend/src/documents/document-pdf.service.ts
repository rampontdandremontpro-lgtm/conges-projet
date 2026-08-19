import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  Document,
  DocumentKind,
  DocumentStatus,
} from './document.entity';
import {
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
  SignatureType,
} from '../leave-requests/leave-request.entity';
import { UserRole } from '../users/user.entity';

export interface ValidationPdfFile {
  buffer: Buffer;
  filename: string;
  referenceNumber: string;
  checksum: string;
}

@Injectable()
export class DocumentPdfService {
  private readonly privateStorageRoot = resolve(
    process.cwd(),
    'storage',
    'private',
  );

  private readonly logoPath = resolve(
    process.cwd(),
    'asset',
    'gmes-logo.png',
  );

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,

    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,
  ) {}

  async ensureValidationPdf(
    leaveRequestId: number,
    generatedByUserId: number | null,
  ): Promise<Document> {
    const leaveRequest =
      await this.findValidatedRequestWithSignatures(leaveRequestId);

    let storedDocument = await this.documentRepository.findOne({
      where: {
        leaveRequestId,
        documentKind: DocumentKind.PDF_VALIDATION,
      },
      order: {
        uploadedAt: 'DESC',
      },
    });

    const isNewDocument = storedDocument === null;
    const generatedAt = storedDocument?.uploadedAt ?? new Date();
    const referenceNumber = storedDocument?.originalName
      ? storedDocument.originalName.replace(/\.pdf$/i, '')
      : this.createValidationReference(leaveRequest, generatedAt);
    const usesCurrentPdfDesign =
      storedDocument?.storageKey?.includes('/premium-v1/') === true;
    const storageKey = usesCurrentPdfDesign
      ? storedDocument!.storageKey
      : this.createValidationStorageKey(referenceNumber, generatedAt);
    const absolutePath = this.resolvePrivateStoragePath(storageKey);

    if (
      storedDocument &&
      usesCurrentPdfDesign &&
      (await this.fileExists(absolutePath))
    ) {
      return storedDocument;
    }

    const documentFingerprint = this.createDocumentFingerprint(
      leaveRequest,
      referenceNumber,
      generatedAt,
    );

    const pdfBuffer = await this.buildValidationPdf({
      leaveRequest,
      referenceNumber,
      generatedAt,
      documentFingerprint,
    });

    await this.writeFileAtomically(absolutePath, pdfBuffer);

    try {
      const uploaderId =
        generatedByUserId ??
        leaveRequest.finalDeciderId ??
        leaveRequest.employeeId;

      if (storedDocument) {
        storedDocument.originalName = `${referenceNumber}.pdf`;
        storedDocument.storageKey = storageKey;
        storedDocument.mimeType = 'application/pdf';
        storedDocument.fileSize = pdfBuffer.length;
        storedDocument.status = DocumentStatus.ACCEPTE;
        storedDocument.uploadedById = uploaderId;
      } else {
        storedDocument = this.documentRepository.create({
          leaveRequestId: leaveRequest.id,
          leaveRequest,
          absenceDeclarationId: null,
          absenceDeclaration: null,
          documentKind: DocumentKind.PDF_VALIDATION,
          originalName: `${referenceNumber}.pdf`,
          storageKey,
          mimeType: 'application/pdf',
          fileSize: pdfBuffer.length,
          status: DocumentStatus.ACCEPTE,
          uploadedById: uploaderId,
          verifiedByRhId: null,
          rejectionReason: null,
          retentionUntil: null,
          verifiedAt: null,
          deletedAt: null,
        });
      }

      return await this.documentRepository.save(storedDocument);
    } catch (error) {
      if (isNewDocument) {
        await rm(absolutePath, { force: true });
      }

      throw new InternalServerErrorException(
        'Le PDF a été produit, mais son enregistrement a échoué.',
        { cause: error },
      );
    }
  }

  async getValidationPdf(
    leaveRequestId: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<ValidationPdfFile> {
    const leaveRequest =
      await this.findValidatedRequestWithSignatures(leaveRequestId);

    this.ensureUserCanAccessValidationPdf(
      leaveRequest,
      authenticatedUser,
    );

    const storedDocument = await this.ensureValidationPdf(
      leaveRequest.id,
      leaveRequest.finalDeciderId,
    );

    const absolutePath = this.resolvePrivateStoragePath(
      storedDocument.storageKey,
    );

    let buffer: Buffer;

    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      throw new InternalServerErrorException(
        'Le fichier PDF officiel est introuvable dans le stockage privé.',
        { cause: error },
      );
    }

    const checksum = createHash('sha256')
      .update(buffer)
      .digest('hex');
    const referenceNumber =
      storedDocument.originalName?.replace(/\.pdf$/i, '') ??
      this.createValidationReference(leaveRequest, storedDocument.uploadedAt);

    return {
      buffer,
      filename: `${referenceNumber}.pdf`,
      referenceNumber,
      checksum,
    };
  }

  async getPendingSummaryPdf(
    leaveRequestId: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<ValidationPdfFile> {
    const leaveRequest = await this.findPendingRequestForSummary(
      leaveRequestId,
    );

    this.ensureUserCanAccessValidationPdf(
      leaveRequest,
      authenticatedUser,
    );

    const generatedAt = new Date();
    const referenceNumber = `RECAP-${generatedAt.getFullYear()}-${String(
      leaveRequest.id,
    ).padStart(6, '0')}`;
    const buffer = await this.buildPendingSummaryPdf({
      leaveRequest,
      referenceNumber,
      generatedAt,
    });

    return {
      buffer,
      filename: `${referenceNumber}.pdf`,
      referenceNumber,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async ensureCancellationPdf(
    leaveRequestId: number,
    generatedByUserId: number,
  ): Promise<Document> {
    const leaveRequest =
      await this.findCancelledRequestForPdf(leaveRequestId);

    let storedDocument = await this.documentRepository.findOne({
      where: {
        leaveRequestId,
        documentKind: DocumentKind.PDF_ANNULATION,
      },
      order: { uploadedAt: 'DESC' },
    });

    const generatedAt = storedDocument?.uploadedAt ?? new Date();
    const referenceNumber =
      storedDocument?.originalName?.replace(/\.pdf$/i, '') ??
      `ANNULATION-${generatedAt.getFullYear()}-${String(
        leaveRequest.id,
      ).padStart(6, '0')}`;
    const storageKey =
      storedDocument?.storageKey ??
      [
        'official-pdfs',
        'cancellation',
        String(generatedAt.getFullYear()),
        `${referenceNumber}.pdf`,
      ].join('/');
    const absolutePath = this.resolvePrivateStoragePath(storageKey);

    if (storedDocument && (await this.fileExists(absolutePath))) {
      return storedDocument;
    }

    const pdfBuffer = await this.buildCancellationPdf({
      leaveRequest,
      referenceNumber,
      generatedAt,
    });

    await this.writeFileAtomically(absolutePath, pdfBuffer);

    try {
      if (storedDocument) {
        storedDocument.originalName = `${referenceNumber}.pdf`;
        storedDocument.mimeType = 'application/pdf';
        storedDocument.fileSize = pdfBuffer.length;
        storedDocument.status = DocumentStatus.ACCEPTE;
        storedDocument.uploadedById = generatedByUserId;
      } else {
        storedDocument = this.documentRepository.create({
          leaveRequestId: leaveRequest.id,
          leaveRequest,
          absenceDeclarationId: null,
          absenceDeclaration: null,
          documentKind: DocumentKind.PDF_ANNULATION,
          originalName: `${referenceNumber}.pdf`,
          storageKey,
          mimeType: 'application/pdf',
          fileSize: pdfBuffer.length,
          status: DocumentStatus.ACCEPTE,
          uploadedById: generatedByUserId,
          verifiedByRhId: null,
          rejectionReason: null,
          retentionUntil: null,
          verifiedAt: null,
          deletedAt: null,
        });
      }

      return await this.documentRepository.save(storedDocument);
    } catch (error) {
      await rm(absolutePath, { force: true });
      throw new InternalServerErrorException(
        'Le PDF d’annulation a été produit, mais son enregistrement a échoué.',
        { cause: error },
      );
    }
  }

  async getCancellationPdf(
    leaveRequestId: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<ValidationPdfFile> {
    const leaveRequest =
      await this.findCancelledRequestForPdf(leaveRequestId);

    this.ensureUserCanAccessValidationPdf(
      leaveRequest,
      authenticatedUser,
    );

    const storedDocument = await this.ensureCancellationPdf(
      leaveRequestId,
      leaveRequest.cancellationRequestedById ??
        leaveRequest.employeeId,
    );
    const absolutePath = this.resolvePrivateStoragePath(
      storedDocument.storageKey,
    );
    const buffer = await readFile(absolutePath);
    const referenceNumber =
      storedDocument.originalName?.replace(/\.pdf$/i, '') ??
      `ANNULATION-${new Date().getFullYear()}-${String(
        leaveRequest.id,
      ).padStart(6, '0')}`;

    return {
      buffer,
      filename: `${referenceNumber}.pdf`,
      referenceNumber,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  private async findCancelledRequestForPdf(
    leaveRequestId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id: leaveRequestId },
      relations: {
        employee: true,
        createdBy: true,
        leaveType: true,
        service: true,
        finalDecider: true,
        cancellationRequestedBy: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${leaveRequestId} est introuvable.`,
      );
    }

    if (
      leaveRequest.status !==
        LeaveRequestStatus.ANNULEE_APRES_VALIDATION ||
      leaveRequest.cancelledAt === null
    ) {
      throw new BadRequestException(
        'Le PDF d’annulation est disponible uniquement après la finalisation de l’annulation.',
      );
    }

    return leaveRequest;
  }

  private async buildCancellationPdf(input: {
    leaveRequest: LeaveRequest;
    referenceNumber: string;
    generatedAt: Date;
  }): Promise<Buffer> {
    const { leaveRequest, referenceNumber, generatedAt } = input;

    return new Promise<Buffer>((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      const document = new PDFDocument({
        size: 'A4',
        margins: { top: 48, right: 48, bottom: 48, left: 48 },
        info: {
          Title: 'Annulation d’une demande de congé validée',
          Author: 'GMES',
          Subject: referenceNumber,
        },
      });

      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () =>
        resolvePromise(Buffer.concat(chunks)),
      );
      document.on('error', rejectPromise);

      document
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('GMES', { align: 'center' })
        .moveDown(0.4)
        .fontSize(15)
        .text('Annulation d’une demande de congé validée', {
          align: 'center',
        })
        .moveDown(0.3)
        .font('Helvetica')
        .fontSize(9)
        .text(`Référence : ${referenceNumber}`, { align: 'center' })
        .moveDown(2);

      const rows: Array<[string, string]> = [
        [
          'Collaborateur',
          `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
        ],
        ['Service', leaveRequest.service.name],
        ['Type de congé', leaveRequest.leaveType.name],
        [
          'Période annulée',
          `${this.formatDateOnly(leaveRequest.startDate)} au ${this.formatDateOnly(leaveRequest.endDate)}`,
        ],
        ['Jours recrédités', this.formatDays(leaveRequest.deductedDays)],
        [
          'Motif',
          leaveRequest.cancellationReason ?? 'Non renseigné',
        ],
        [
          'Demande d’annulation initiée par',
          leaveRequest.cancellationRequestedBy
            ? `${leaveRequest.cancellationRequestedBy.prenom} ${leaveRequest.cancellationRequestedBy.nom}`
            : 'Utilisateur non disponible',
        ],
        [
          'Accord du collaborateur',
          leaveRequest.employeeCancellationConsent === true
            ? `Oui, le ${this.formatDateTime(leaveRequest.employeeCancellationResponseAt)}`
            : 'Non renseigné',
        ],
        [
          'Annulation finalisée le',
          this.formatDateTime(leaveRequest.cancelledAt),
        ],
        [
          'Solde après recrédit',
          this.formatOptionalDays(leaveRequest.realBalanceAfter),
        ],
      ];

      for (const [label, value] of rows) {
        document
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(label);
        document
          .font('Helvetica')
          .fontSize(10)
          .text(value)
          .moveDown(0.7);
      }

      document
        .moveDown(1.5)
        .fontSize(8)
        .fillColor('#555555')
        .text(
          `Document confidentiel — Généré le ${this.formatDateTime(generatedAt)} — ${referenceNumber}`,
          { align: 'center' },
        );

      document.end();
    });
  }

  private async findPendingRequestForSummary(
    leaveRequestId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository
      .createQueryBuilder('leaveRequest')
      .leftJoinAndSelect('leaveRequest.employee', 'employee')
      .leftJoinAndSelect('leaveRequest.createdBy', 'createdBy')
      .leftJoinAndSelect('leaveRequest.leaveType', 'leaveType')
      .leftJoinAndSelect('leaveRequest.service', 'service')
      .where('leaveRequest.id = :leaveRequestId', { leaveRequestId })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${leaveRequestId} est introuvable.`,
      );
    }

    if (
      leaveRequest.status !==
      LeaveRequestStatus.EN_ATTENTE_VALIDATION
    ) {
      throw new BadRequestException(
        'Le récapitulatif provisoire est disponible uniquement pour une demande en attente de validation.',
      );
    }

    return leaveRequest;
  }

  private async buildPendingSummaryPdf(input: {
    leaveRequest: LeaveRequest;
    referenceNumber: string;
    generatedAt: Date;
  }): Promise<Buffer> {
    const { leaveRequest, referenceNumber, generatedAt } = input;

    return new Promise<Buffer>((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      const document = new PDFDocument({
        size: 'A4',
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        info: {
          Title: `Récapitulatif provisoire ${referenceNumber}`,
          Author: 'GMES',
          Subject: 'Demande de congé en attente de validation',
          Keywords: 'GMES, congé, en attente, récapitulatif provisoire',
          CreationDate: generatedAt,
        },
      });

      document.on('data', (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
      });
      document.on('error', rejectPromise);
      document.on('end', () => {
        resolvePromise(Buffer.concat(chunks));
      });

      try {
        const pageWidth = document.page.width;
        const contentX = 30;
        const contentWidth = pageWidth - contentX * 2;

        this.drawPremiumPdfHeader(document, {
          title: 'Récapitulatif de\ndemande de congé',
          referenceNumber,
          statusLabel: null,
        });

        this.drawPremiumWarningBanner(
          document,
          138,
          contentX,
          contentWidth,
          'DEMANDE EN ATTENTE DE VALIDATION — DOCUMENT NON DÉFINITIF',
          'Ce document est un récapitulatif provisoire. Il ne constitue pas une autorisation d’absence.',
        );

        this.drawPremiumCard(document, {
          x: contentX,
          y: 221,
          width: contentWidth,
          title: 'Collaborateur',
          icon: 'user',
          rows: [
            [
              'Nom',
              `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
            ],
            ['Adresse e-mail', leaveRequest.employee.email],
            ['Service', leaveRequest.service.name],
          ],
          height: 146,
          rowHeight: 30,
        });

        const requestRows: Array<[string, string]> = [
          ['Type de congé', leaveRequest.leaveType.name],
          [
            'Date de début',
            `${this.formatDateOnly(leaveRequest.startDate)} — ${this.formatDayPeriod(leaveRequest.startPeriod)}`,
          ],
          [
            'Date de fin',
            `${this.formatDateOnly(leaveRequest.endDate)} — ${this.formatDayPeriod(leaveRequest.endPeriod)}`,
          ],
          [
            'Jours ouvrables décomptés',
            this.formatDays(leaveRequest.deductedDays),
          ],
          ['Soumise le', this.formatDateTime(leaveRequest.submittedAt)],
          [
            'Modification possible jusqu’au',
            leaveRequest.modificationDeadline
              ? this.formatDateOnly(
                  String(leaveRequest.modificationDeadline).slice(0, 10),
                )
              : 'Non renseignée',
          ],
        ];

        if (leaveRequest.comment) {
          requestRows.push(['Commentaire', leaveRequest.comment]);
        }

        this.drawPremiumCard(document, {
          x: contentX,
          y: 383,
          width: contentWidth,
          title: 'Demande',
          icon: 'calendar',
          rows: requestRows,
          height: leaveRequest.comment ? 259 : 230,
          rowHeight: 29,
        });

        if (leaveRequest.realBalanceBefore !== null) {
          this.drawPremiumCard(document, {
            x: contentX,
            y: leaveRequest.comment ? 658 : 628,
            width: contentWidth,
            title: 'Solde au moment de la soumission',
            icon: 'balance',
            rows: [
              [
                'Solde réel',
                this.formatOptionalDays(leaveRequest.realBalanceBefore),
              ],
              [
                'Solde potentiel avant réservation',
                this.formatOptionalDays(leaveRequest.potentialBalanceBefore),
              ],
            ],
            height: 100,
            rowHeight: 29,
          });
        }

        this.drawPremiumPdfFooter(document, {
          referenceNumber,
          generatedAt,
          official: false,
        });

        document.end();
      } catch (error) {
        rejectPromise(error);
      }
    });
  }

  private async findValidatedRequestWithSignatures(
    leaveRequestId: number,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository
      .createQueryBuilder('leaveRequest')
      .addSelect('leaveRequest.employeeSignatureData')
      .addSelect('leaveRequest.validatorSignatureData')
      .leftJoinAndSelect('leaveRequest.employee', 'employee')
      .leftJoinAndSelect('leaveRequest.createdBy', 'createdBy')
      .leftJoinAndSelect('leaveRequest.leaveType', 'leaveType')
      .leftJoinAndSelect('leaveRequest.service', 'service')
      .leftJoinAndSelect(
        'leaveRequest.finalDecider',
        'finalDecider',
      )
      .where('leaveRequest.id = :leaveRequestId', {
        leaveRequestId,
      })
      .getOne();

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${leaveRequestId} est introuvable.`,
      );
    }

    if (
      ![
        LeaveRequestStatus.VALIDEE,
        LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
        LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
      ].includes(leaveRequest.status)
    ) {
      throw new BadRequestException(
        'Un PDF officiel est disponible uniquement pour une demande validée ou annulée après validation.',
      );
    }

    if (
      leaveRequest.finalDeciderId === null ||
      leaveRequest.finalDecider === null ||
      leaveRequest.decisionAt === null ||
      leaveRequest.employeeSignatureType === null ||
      leaveRequest.employeeSignatureData === null ||
      leaveRequest.employeeSignedAt === null ||
      leaveRequest.validatorSignatureType === null ||
      leaveRequest.validatorSignatureData === null ||
      leaveRequest.validatorSignedAt === null
    ) {
      throw new ConflictException(
        'Le PDF officiel n’est pas disponible pour cette ancienne demande, car les signatures figées nécessaires au document ne sont pas présentes.',
      );
    }

    return leaveRequest;
  }

  private ensureUserCanAccessValidationPdf(
    leaveRequest: LeaveRequest,
    authenticatedUser: AuthenticatedUser,
  ): void {
    if (leaveRequest.employeeId === authenticatedUser.id) {
      return;
    }

    if (
      authenticatedUser.role === UserRole.RH ||
      authenticatedUser.role === UserRole.DIRECTEUR
    ) {
      return;
    }

    if (
      authenticatedUser.role ===
        UserRole.RESPONSABLE_SERVICE &&
      authenticatedUser.serviceId === leaveRequest.serviceId
    ) {
      return;
    }

    throw new ForbiddenException(
      'Vous ne pouvez pas télécharger ce document métier.',
    );
  }

  private createValidationReference(
    leaveRequest: LeaveRequest,
    generatedAt: Date,
  ): string {
    const year =
      leaveRequest.decisionAt?.getFullYear() ??
      generatedAt.getFullYear();

    return `CONGE-${year}-${String(leaveRequest.id).padStart(6, '0')}`;
  }

  private createValidationStorageKey(
    referenceNumber: string,
    generatedAt: Date,
  ): string {
    return [
      'official-pdfs',
      'validation',
      'premium-v1',
      String(generatedAt.getFullYear()),
      `${referenceNumber}.pdf`,
    ].join('/');
  }

  private resolvePrivateStoragePath(storageKey: string): string {
    const absolutePath = resolve(
      this.privateStorageRoot,
      ...storageKey.split('/'),
    );
    const expectedPrefix = `${this.privateStorageRoot}${sep}`;

    if (!absolutePath.startsWith(expectedPrefix)) {
      throw new InternalServerErrorException(
        'La clé de stockage du document est invalide.',
      );
    }

    return absolutePath;
  }

  private async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  private async writeFileAtomically(
    absolutePath: string,
    buffer: Buffer,
  ): Promise<void> {
    await mkdir(dirname(absolutePath), {
      recursive: true,
    });

    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, buffer, {
        flag: 'wx',
      });
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });

      throw new InternalServerErrorException(
        'L’enregistrement du PDF dans le stockage privé a échoué.',
        {
          cause: error,
        },
      );
    }
  }

  private createDocumentFingerprint(
    leaveRequest: LeaveRequest,
    referenceNumber: string,
    generatedAt: Date,
  ): string {
    const canonicalDocumentData = JSON.stringify({
      referenceNumber,
      generatedAt: generatedAt.toISOString(),
      leaveRequestId: leaveRequest.id,
      employeeId: leaveRequest.employeeId,
      employeeName: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
      serviceId: leaveRequest.serviceId,
      serviceName: leaveRequest.service.name,
      leaveTypeId: leaveRequest.leaveTypeId,
      leaveTypeName: leaveRequest.leaveType.name,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      startPeriod: leaveRequest.startPeriod,
      endPeriod: leaveRequest.endPeriod,
      deductedDays: leaveRequest.deductedDays,
      realBalanceBefore: leaveRequest.realBalanceBefore,
      potentialBalanceBefore:
        leaveRequest.potentialBalanceBefore,
      realBalanceAfter: leaveRequest.realBalanceAfter,
      submittedAt: leaveRequest.submittedAt?.toISOString(),
      employeeSignatureType:
        leaveRequest.employeeSignatureType,
      employeeSignatureData:
        leaveRequest.employeeSignatureData,
      employeeSignedAt:
        leaveRequest.employeeSignedAt?.toISOString(),
      finalDeciderId: leaveRequest.finalDeciderId,
      finalDeciderRole: leaveRequest.finalDeciderRole,
      finalDeciderName: leaveRequest.finalDecider
        ? `${leaveRequest.finalDecider.prenom} ${leaveRequest.finalDecider.nom}`
        : null,
      decisionAt: leaveRequest.decisionAt?.toISOString(),
      validatorSignatureType:
        leaveRequest.validatorSignatureType,
      validatorSignatureData:
        leaveRequest.validatorSignatureData,
      validatorSignedAt:
        leaveRequest.validatorSignedAt?.toISOString(),
      rhConfirmedDirectorAgreement:
        leaveRequest.rhConfirmedDirectorAgreement,
      rhDirectorAgreementConfirmedAt:
        leaveRequest.rhDirectorAgreementConfirmedAt?.toISOString(),
      version: leaveRequest.version,
    });

    return createHash('sha256')
      .update(canonicalDocumentData)
      .digest('hex');
  }

  private async buildValidationPdf(input: {
    leaveRequest: LeaveRequest;
    referenceNumber: string;
    generatedAt: Date;
    documentFingerprint: string;
  }): Promise<Buffer> {
    const {
      leaveRequest,
      referenceNumber,
      generatedAt,
      documentFingerprint,
    } = input;

    return new Promise<Buffer>((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      const document = new PDFDocument({
        size: 'A4',
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        info: {
          Title: `Demande de congé validée ${referenceNumber}`,
          Author: 'GMES',
          Subject: 'Demande de congé validée',
          Keywords: 'GMES, congé, validation, document officiel',
          CreationDate: generatedAt,
        },
      });

      document.on('data', (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
      });
      document.on('error', rejectPromise);
      document.on('end', () => {
        resolvePromise(Buffer.concat(chunks));
      });

      try {
        const pageWidth = document.page.width;
        const contentX = 36;
        const contentWidth = pageWidth - contentX * 2;

        this.drawPremiumPdfHeader(document, {
          title: 'Demande de congé\nvalidée',
          referenceNumber,
          statusLabel: 'Validée',
        });

        this.drawPremiumCard(document, {
          x: contentX,
          y: 138,
          width: contentWidth,
          title: 'Informations du collaborateur',
          icon: 'user',
          rows: [
            [
              'Collaborateur',
              `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
            ],
            ['Adresse e-mail', leaveRequest.employee.email],
            ['Service', leaveRequest.service.name],
            [
              'Statut professionnel',
              this.formatEmploymentType(
                leaveRequest.employee.employmentType,
              ),
            ],
          ],
          height: 119,
          rowHeight: 21,
        });

        this.drawPremiumCard(document, {
          x: contentX,
          y: 269,
          width: contentWidth,
          title: 'Détails du congé',
          icon: 'calendar',
          rows: [
            ['Type de congé', leaveRequest.leaveType.name],
            [
              'Date de début',
              `${this.formatDateOnly(leaveRequest.startDate)} — ${this.formatDayPeriod(leaveRequest.startPeriod)}`,
            ],
            [
              'Date de fin',
              `${this.formatDateOnly(leaveRequest.endDate)} — ${this.formatDayPeriod(leaveRequest.endPeriod)}`,
            ],
            [
              'Durée calendaire',
              `${leaveRequest.calendarDuration} jour(s)`,
            ],
            [
              'Jours ouvrables décomptés',
              this.formatDays(leaveRequest.deductedDays),
            ],
          ],
          height: 137,
          rowHeight: 21,
        });

        this.drawPremiumCard(document, {
          x: contentX,
          y: 418,
          width: contentWidth,
          title: 'Situation du solde',
          icon: 'balance',
          rows: [
            [
              'Solde réel avant validation',
              this.formatOptionalDays(leaveRequest.realBalanceBefore),
            ],
            [
              'Solde potentiel avant validation',
              this.formatOptionalDays(leaveRequest.potentialBalanceBefore),
            ],
            [
              'Solde réel après validation',
              this.formatOptionalDays(leaveRequest.realBalanceAfter),
            ],
          ],
          height: 97,
          rowHeight: 21,
        });

        const traceabilityRows: Array<[string, string]> = [
          ['Soumise le', this.formatDateTime(leaveRequest.submittedAt)],
          [
            'Décision enregistrée le',
            this.formatDateTime(leaveRequest.decisionAt),
          ],
          [
            'Décision prise par',
            `${leaveRequest.finalDecider?.prenom ?? ''} ${leaveRequest.finalDecider?.nom ?? ''}`.trim(),
          ],
          [
            'Rôle du valideur',
            this.formatRole(leaveRequest.finalDeciderRole),
          ],
        ];

        const traceHeight = 111;
        this.drawPremiumCard(document, {
          x: contentX,
          y: 527,
          width: contentWidth,
          title: 'Traçabilité',
          icon: 'document',
          rows: traceabilityRows,
          height: traceHeight,
          rowHeight: 19,
        });

        const signaturesY = 650;
        this.drawPremiumSignatures(document, leaveRequest, signaturesY);

        this.drawPremiumPdfFooter(document, {
          referenceNumber,
          generatedAt,
          official: true,
          fingerprint: documentFingerprint,
        });

        document.end();
      } catch (error) {
        rejectPromise(error);
      }
    });
  }

  private drawPremiumPdfHeader(
    document: PDFKit.PDFDocument,
    input: {
      title: string;
      referenceNumber: string;
      statusLabel: string | null;
    },
  ): void {
    const x = 24;
    const y = 23;
    const width = document.page.width - 48;
    const height = 99;

    this.drawPremiumShadow(document, x, y, width, height, 12);
    document
      .roundedRect(x, y, width, height, 12)
      .fillAndStroke('#FFFFFF', '#D8E6F6');

    document
      .roundedRect(x, y, 12, height, 12)
      .fill('#0B5DBB');
    document.rect(x + 6, y, 12, height).fill('#0B5DBB');

    const logoBoxWidth = 134;
    document
      .moveTo(x + logoBoxWidth, y)
      .lineTo(x + logoBoxWidth, y + height)
      .lineWidth(0.7)
      .strokeColor('#DCE7F4')
      .stroke();

    if (existsSync(this.logoPath)) {
      document.image(this.logoPath, x + 28, y + 9, {
        fit: [76, 76],
        align: 'center',
        valign: 'center',
      });
    } else {
      document
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#0B5DBB')
        .text('GMES', x + 39, y + 38, { lineBreak: false });
    }

    const titleX = x + logoBoxWidth + 26;
    const refAreaWidth = 164;
    const titleWidth = width - logoBoxWidth - refAreaWidth - 48;

    document
      .font('Helvetica-Bold')
      .fontSize(21)
      .fillColor('#0B2347')
      .text(input.title, titleX, y + 20, {
        width: titleWidth,
        lineGap: 0,
      });

    if (input.statusLabel) {
      const badgeX = titleX;
      const badgeY = y + 70;
      document
        .roundedRect(badgeX, badgeY, 68, 19, 5)
        .fillAndStroke('#E6F8EC', '#86D5A0');
      document.circle(badgeX + 12, badgeY + 9.5, 5.5).fill('#20A957');
      document
        .moveTo(badgeX + 8.7, badgeY + 9.5)
        .lineTo(badgeX + 11.2, badgeY + 12)
        .lineTo(badgeX + 15.6, badgeY + 7.2)
        .lineWidth(1.2)
        .strokeColor('#FFFFFF')
        .stroke();
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#178A45')
        .text(input.statusLabel, badgeX + 23, badgeY + 5.2, {
          lineBreak: false,
        });
    }

    const dividerX = x + width - refAreaWidth - 18;
    document
      .moveTo(dividerX, y + 18)
      .lineTo(dividerX, y + height - 18)
      .lineWidth(0.8)
      .strokeColor('#CFE0F3')
      .stroke();

    const refX = dividerX + 24;
    document
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#0B5DBB')
      .text('RÉFÉRENCE', refX, y + 31, {
        width: refAreaWidth - 40,
        align: 'center',
        lineBreak: false,
      });

    document
      .roundedRect(refX + 2, y + 53, refAreaWidth - 44, 22, 4)
      .fill('#064A98');
    document
      .font('Helvetica-Bold')
      .fontSize(9.2)
      .fillColor('#FFFFFF')
      .text(input.referenceNumber, refX + 4, y + 59, {
        width: refAreaWidth - 48,
        align: 'center',
        lineBreak: false,
      });
  }

  private drawPremiumWarningBanner(
    document: PDFKit.PDFDocument,
    y: number,
    x: number,
    width: number,
    title: string,
    body: string,
  ): void {
    const height = 66;
    document
      .roundedRect(x, y, width, height, 10)
      .fillAndStroke('#FFF8F1', '#F97316');

    document
      .circle(x + 38, y + height / 2, 18)
      .lineWidth(1.5)
      .strokeColor('#F97316')
      .stroke();
    document
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#F97316')
      .text('!', x + 34.2, y + 21, { lineBreak: false });

    document
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .fillColor('#E86112')
      .text(title, x + 70, y + 17, {
        width: width - 90,
        lineBreak: false,
      });

    document
      .font('Helvetica')
      .fontSize(8.7)
      .fillColor('#64748B')
      .text(body, x + 70, y + 38, {
        width: width - 90,
        lineBreak: false,
      });
  }

  private drawPremiumCard(
    document: PDFKit.PDFDocument,
    input: {
      x: number;
      y: number;
      width: number;
      height: number;
      title: string;
      icon: 'user' | 'calendar' | 'balance' | 'document';
      rows: Array<[string, string]>;
      rowHeight: number;
    },
  ): void {
    const headerHeight = 32;
    this.drawPremiumShadow(
      document,
      input.x,
      input.y,
      input.width,
      input.height,
      9,
    );

    document
      .roundedRect(
        input.x,
        input.y,
        input.width,
        input.height,
        9,
      )
      .fillAndStroke('#FFFFFF', '#D7E4F3');

    document
      .roundedRect(
        input.x,
        input.y,
        input.width,
        headerHeight,
        9,
      )
      .fill('#F5F9FE');
    document
      .rect(
        input.x,
        input.y + headerHeight - 9,
        input.width,
        9,
      )
      .fill('#F5F9FE');

    this.drawPremiumSectionIcon(
      document,
      input.icon,
      input.x + 17,
      input.y + 3,
    );

    document
      .font('Helvetica-Bold')
      .fontSize(12.4)
      .fillColor('#0B4F9C')
      .text(input.title, input.x + 55, input.y + 10, {
        width: input.width - 70,
        lineBreak: false,
      });

    document
      .moveTo(input.x, input.y + headerHeight)
      .lineTo(input.x + input.width, input.y + headerHeight)
      .lineWidth(0.6)
      .strokeColor('#D8E6F5')
      .stroke();

    const startY = input.y + headerHeight + 5;
    const labelX = input.x + 18;
    const labelWidth = Math.min(176, input.width * 0.37);
    const valueX = input.x + labelWidth + 24;
    const valueWidth = input.width - (valueX - input.x) - 18;

    input.rows.forEach(([label, value], index) => {
      const rowY = startY + index * input.rowHeight;
      const safeLabel = this.truncatePdfText(
        document,
        label,
        labelWidth,
        8.7,
        'Helvetica-Bold',
      );
      const safeValue = this.truncatePdfText(
        document,
        value || 'Non renseigné',
        valueWidth,
        8.9,
        'Helvetica',
      );

      document
        .font('Helvetica-Bold')
        .fontSize(8.7)
        .fillColor('#334155')
        .text(safeLabel, labelX, rowY + 6, {
          width: labelWidth,
          lineBreak: false,
        });

      document
        .font('Helvetica')
        .fontSize(8.9)
        .fillColor('#334A67')
        .text(safeValue, valueX, rowY + 6, {
          width: valueWidth,
          lineBreak: false,
        });

      if (index < input.rows.length - 1) {
        document
          .moveTo(input.x + 16, rowY + input.rowHeight)
          .lineTo(input.x + input.width - 16, rowY + input.rowHeight)
          .lineWidth(0.45)
          .strokeColor('#D9E4F0')
          .stroke();
      }
    });
  }

  private drawPremiumSectionIcon(
    document: PDFKit.PDFDocument,
    icon: 'user' | 'calendar' | 'balance' | 'document',
    x: number,
    y: number,
  ): void {
    document.roundedRect(x, y, 26, 26, 6).fill('#064F9E');
    document.lineWidth(1.05).strokeColor('#FFFFFF');

    if (icon === 'user') {
      document.circle(x + 13, y + 8, 3.8).stroke();
      document
        .roundedRect(x + 7.6, y + 14, 10.8, 7, 3.5)
        .stroke();
      return;
    }

    if (icon === 'calendar') {
      document.roundedRect(x + 6.5, y + 7, 13, 13, 2).stroke();
      document.moveTo(x + 6.5, y + 11).lineTo(x + 19.5, y + 11).stroke();
      document.moveTo(x + 10, y + 5.5).lineTo(x + 10, y + 9).stroke();
      document.moveTo(x + 16, y + 5.5).lineTo(x + 16, y + 9).stroke();
      return;
    }

    if (icon === 'balance') {
      document.moveTo(x + 13, y + 5).lineTo(x + 13, y + 20.5).stroke();
      document.moveTo(x + 7.5, y + 9).lineTo(x + 18.5, y + 9).stroke();
      document.moveTo(x + 9, y + 9).lineTo(x + 6.8, y + 15).stroke();
      document.moveTo(x + 17, y + 9).lineTo(x + 19.2, y + 15).stroke();
      document.moveTo(x + 5.5, y + 15).lineTo(x + 8.3, y + 15).stroke();
      document.moveTo(x + 17.7, y + 15).lineTo(x + 20.5, y + 15).stroke();
      document.moveTo(x + 9, y + 21).lineTo(x + 17, y + 21).stroke();
      return;
    }

    document.roundedRect(x + 7.2, y + 5.5, 11.5, 15.5, 2).stroke();
    document.moveTo(x + 9.5, y + 10).lineTo(x + 16.5, y + 10).stroke();
    document.moveTo(x + 9.5, y + 13.5).lineTo(x + 16.5, y + 13.5).stroke();
    document.moveTo(x + 9.5, y + 17).lineTo(x + 15, y + 17).stroke();
  }

  private drawPremiumSignatures(
    document: PDFKit.PDFDocument,
    leaveRequest: LeaveRequest,
    y: number,
  ): void {
    const x = 36;
    const width = document.page.width - x * 2;
    const gap = 22;
    const boxWidth = (width - gap) / 2;
    const boxHeight = 116;

    this.drawPremiumSignatureCard(document, {
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      title: 'Signature du collaborateur',
      signatureType: leaveRequest.employeeSignatureType!,
      signatureData: leaveRequest.employeeSignatureData!,
      signerName: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
      signerRole: 'Collaborateur',
      signedAt: leaveRequest.employeeSignedAt!,
    });

    this.drawPremiumSignatureCard(document, {
      x: x + boxWidth + gap,
      y,
      width: boxWidth,
      height: boxHeight,
      title: 'Signature du valideur',
      signatureType: leaveRequest.validatorSignatureType!,
      signatureData: leaveRequest.validatorSignatureData!,
      signerName: `${leaveRequest.finalDecider!.prenom} ${leaveRequest.finalDecider!.nom}`,
      signerRole: this.formatRole(leaveRequest.finalDeciderRole),
      signedAt: leaveRequest.validatorSignedAt!,
    });
  }

  private drawPremiumSignatureCard(
    document: PDFKit.PDFDocument,
    input: {
      x: number;
      y: number;
      width: number;
      height: number;
      title: string;
      signatureType: SignatureType;
      signatureData: string;
      signerName: string;
      signerRole: string;
      signedAt: Date;
    },
  ): void {
    this.drawPremiumShadow(
      document,
      input.x,
      input.y,
      input.width,
      input.height,
      8,
    );
    document
      .roundedRect(
        input.x,
        input.y,
        input.width,
        input.height,
        8,
      )
      .fillAndStroke('#FFFFFF', '#CFE0F3');
    document
      .roundedRect(input.x, input.y, input.width, 25, 8)
      .fill('#F4F8FD');
    document
      .rect(input.x, input.y + 17, input.width, 8)
      .fill('#F4F8FD');

    document
      .font('Helvetica-Bold')
      .fontSize(9.2)
      .fillColor('#0B4F9C')
      .text(input.title, input.x + 8, input.y + 8, {
        width: input.width - 16,
        align: 'center',
        lineBreak: false,
      });

    const signatureY = input.y + 31;
    const signatureHeight = 31;

    if (input.signatureType === SignatureType.INITIALS) {
      document
        .font('Times-Italic')
        .fontSize(27)
        .fillColor('#0B5DBB')
        .text(input.signatureData, input.x + 12, signatureY + 3, {
          width: input.width - 24,
          align: 'center',
          lineBreak: false,
        });
    } else {
      const imageBuffer = this.decodePngSignature(input.signatureData);
      document.image(imageBuffer, input.x + 20, signatureY, {
        fit: [input.width - 40, signatureHeight],
        align: 'center',
        valign: 'center',
      });
    }

    document
      .moveTo(input.x + 16, input.y + 67)
      .lineTo(input.x + input.width - 16, input.y + 67)
      .lineWidth(0.5)
      .strokeColor('#CCD9E8')
      .stroke();

    document
      .font('Helvetica-Bold')
      .fontSize(8.8)
      .fillColor('#0B2347')
      .text(input.signerName, input.x + 10, input.y + 74, {
        width: input.width - 20,
        align: 'center',
        lineBreak: false,
      });
    document
      .font('Helvetica')
      .fontSize(7.8)
      .fillColor('#345B8A')
      .text(input.signerRole, input.x + 10, input.y + 89, {
        width: input.width - 20,
        align: 'center',
        lineBreak: false,
      });
    document
      .font('Helvetica')
      .fontSize(7.0)
      .fillColor('#4E78A7')
      .text(this.formatDateTime(input.signedAt), input.x + 10, input.y + 102, {
        width: input.width - 20,
        align: 'center',
        lineBreak: false,
      });
  }

  private drawPremiumPdfFooter(
    document: PDFKit.PDFDocument,
    input: {
      referenceNumber: string;
      generatedAt: Date;
      official: boolean;
      fingerprint?: string;
    },
  ): void {
    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    const lineY = pageHeight - 67;

    this.drawPremiumFooterWaves(document);

    document
      .moveTo(32, lineY)
      .lineTo(pageWidth - 32, lineY)
      .lineWidth(0.8)
      .strokeColor('#0B5DBB')
      .stroke();

    document.circle(pageWidth / 2, lineY, 13).fillAndStroke('#FFFFFF', '#8DBBEA');
    document
      .moveTo(pageWidth / 2 - 5, lineY)
      .lineTo(pageWidth / 2 - 1.5, lineY + 3.5)
      .lineTo(pageWidth / 2 + 5.5, lineY - 4)
      .lineWidth(1.4)
      .strokeColor('#0B5DBB')
      .stroke();

    document
      .font('Helvetica')
      .fontSize(7.7)
      .fillColor('#7186A1')
      .text(
        input.official
          ? 'Document officiel généré par l’application de gestion des congés'
          : `Document provisoire généré le ${this.formatDateTime(input.generatedAt)}`,
        70,
        lineY + 22,
        {
          width: pageWidth - 140,
          align: 'center',
          lineBreak: false,
        },
      );

    document
      .font('Helvetica-Bold')
      .fontSize(8.8)
      .fillColor('#0B4F9C')
      .text(input.referenceNumber, 70, lineY + 39, {
        width: pageWidth - 140,
        align: 'center',
        lineBreak: false,
      });

    if (input.official && input.fingerprint) {
      document
        .font('Helvetica')
        .fontSize(4.8)
        .fillColor('#B1C1D4')
        .text(
          `Empreinte ${input.fingerprint.slice(0, 20).toUpperCase()}`,
          38,
          pageHeight - 17,
          {
            width: 150,
            lineBreak: false,
          },
        );
    }
  }

  private drawPremiumFooterWaves(document: PDFKit.PDFDocument): void {
    const width = document.page.width;
    const height = document.page.height;

    document
      .moveTo(0, height - 28)
      .bezierCurveTo(width * 0.28, height - 12, width * 0.6, height - 8, width, height - 38)
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .fill('#D7E9FA');

    document
      .moveTo(0, height - 18)
      .bezierCurveTo(width * 0.26, height - 3, width * 0.58, height + 1, width, height - 25)
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .fill('#0B5DBB');

    document
      .moveTo(0, height - 9)
      .bezierCurveTo(width * 0.22, height + 1, width * 0.46, height + 1, width * 0.72, height - 5)
      .lineTo(0, height)
      .closePath()
      .fill('#06386E');
  }

  private drawPremiumShadow(
    document: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    document
      .roundedRect(x + 1.5, y + 2.2, width, height, radius)
      .fill('#EDF2F7');
  }

  private truncatePdfText(
    document: PDFKit.PDFDocument,
    value: string,
    maxWidth: number,
    fontSize: number,
    fontName: string,
  ): string {
    const source = String(value ?? 'Non renseigné');
    document.font(fontName).fontSize(fontSize);

    if (document.widthOfString(source) <= maxWidth) {
      return source;
    }

    let low = 0;
    let high = source.length;
    let result = '…';

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${source.slice(0, middle).trimEnd()}…`;
      if (document.widthOfString(candidate) <= maxWidth) {
        result = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return result;
  }

  private drawMainHeader(
    document: PDFKit.PDFDocument,
    referenceNumber: string,
  ): void {
    const contentWidth =
      document.page.width -
      document.page.margins.left -
      document.page.margins.right;
    const headerY = 34;

    document
      .roundedRect(
        document.page.margins.left,
        headerY,
        contentWidth,
        82,
        8,
      )
      .fill('#015A9B');

    document
      .roundedRect(
        document.page.margins.left + contentWidth - 156,
        headerY,
        156,
        82,
        8,
      )
      .fill('#0078B8');

    if (existsSync(this.logoPath)) {
      document.image(
        this.logoPath,
        document.page.margins.left + 14,
        headerY + 14,
        {
          fit: [82, 54],
          align: 'center',
          valign: 'center',
        },
      );
    } else {
      document
        .font('Helvetica-Bold')
        .fontSize(24)
        .fillColor('#FFFFFF')
        .text(
          'GMES',
          document.page.margins.left + 18,
          headerY + 17,
          {
            width: 100,
          },
        );
    }

    document
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#FFFFFF')
      .text(
        'Demande de congé validée',
        document.page.margins.left + 110,
        headerY + 17,
        {
          width: contentWidth - 280,
          align: 'center',
        },
      );

    document
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#E6F4FB')
      .text(
        'Document officiel généré par l’application de gestion des congés',
        document.page.margins.left + 110,
        headerY + 47,
        {
          width: contentWidth - 280,
          align: 'center',
        },
      );

    document
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#FFFFFF')
      .text(
        'RÉFÉRENCE',
        document.page.margins.left + contentWidth - 143,
        headerY + 19,
        {
          width: 130,
          align: 'center',
        },
      );

    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text(
        referenceNumber,
        document.page.margins.left + contentWidth - 143,
        headerY + 42,
        {
          width: 130,
          align: 'center',
        },
      );

    document.y = headerY + 98;
  }

  private drawContinuationHeader(
    document: PDFKit.PDFDocument,
    referenceNumber: string,
  ): void {
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#013069')
      .text(
        `GMES — Demande de congé validée — ${referenceNumber}`,
        document.page.margins.left,
        34,
        {
          align: 'left',
        },
      );

    document
      .moveTo(document.page.margins.left, 52)
      .lineTo(
        document.page.width - document.page.margins.right,
        52,
      )
      .lineWidth(0.8)
      .strokeColor('#8ABAD4')
      .stroke();

    document.y = 64;
  }

  private drawSectionTitle(
    document: PDFKit.PDFDocument,
    title: string,
  ): void {
    this.ensureSpace(document, 34);

    const contentWidth =
      document.page.width -
      document.page.margins.left -
      document.page.margins.right;
    const titleY = document.y;

    document
      .roundedRect(
        document.page.margins.left,
        titleY,
        contentWidth,
        22,
        4,
      )
      .fill('#E8F4FB');

    document
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#013069')
      .text(
        title,
        document.page.margins.left + 9,
        titleY + 6,
        {
          width: contentWidth - 18,
        },
      );

    document.y = titleY + 30;
  }

  private drawKeyValueRows(
    document: PDFKit.PDFDocument,
    rows: Array<[string, string]>,
  ): void {
    const labelWidth = 176;
    const contentWidth =
      document.page.width -
      document.page.margins.left -
      document.page.margins.right;

    for (const [label, value] of rows) {
      this.ensureSpace(document, 25);
      const rowY = document.y;

      document
        .font('Helvetica-Bold')
        .fontSize(8.7)
        .fillColor('#475569')
        .text(label, document.page.margins.left + 4, rowY, {
          width: labelWidth - 8,
        });

      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#111827')
        .text(
          value || 'Non renseigné',
          document.page.margins.left + labelWidth,
          rowY,
          {
            width: contentWidth - labelWidth - 4,
          },
        );

      const rowHeight = Math.max(
        document.heightOfString(label, {
          width: labelWidth - 8,
        }),
        document.heightOfString(value || 'Non renseigné', {
          width: contentWidth - labelWidth - 4,
        }),
      );

      document.y = rowY + rowHeight + 7;
      document
        .moveTo(document.page.margins.left, document.y - 3)
        .lineTo(
          document.page.width - document.page.margins.right,
          document.y - 3,
        )
        .lineWidth(0.35)
        .strokeColor('#DCE5EA')
        .stroke();
    }

    document.moveDown(0.35);
  }

  private drawSignatures(
    document: PDFKit.PDFDocument,
    leaveRequest: LeaveRequest,
  ): void {
    const contentWidth =
      document.page.width -
      document.page.margins.left -
      document.page.margins.right;
    const gap = 18;
    const boxWidth = (contentWidth - gap) / 2;
    const boxHeight = 124;
    const leftX = document.page.margins.left;
    const rightX = leftX + boxWidth + gap;
    const topY = document.y;

    this.drawSignatureBox(document, {
      x: leftX,
      y: topY,
      width: boxWidth,
      height: boxHeight,
      title: 'Signature du collaborateur',
      signatureType: leaveRequest.employeeSignatureType!,
      signatureData: leaveRequest.employeeSignatureData!,
      signerName: `${leaveRequest.employee.prenom} ${leaveRequest.employee.nom}`,
      signerRole: 'Collaborateur',
      signedAt: leaveRequest.employeeSignedAt!,
    });

    this.drawSignatureBox(document, {
      x: rightX,
      y: topY,
      width: boxWidth,
      height: boxHeight,
      title: 'Signature du valideur',
      signatureType: leaveRequest.validatorSignatureType!,
      signatureData: leaveRequest.validatorSignatureData!,
      signerName: `${leaveRequest.finalDecider!.prenom} ${leaveRequest.finalDecider!.nom}`,
      signerRole: this.formatRole(
        leaveRequest.finalDeciderRole,
      ),
      signedAt: leaveRequest.validatorSignedAt!,
    });

    document.y = topY + boxHeight + 14;
  }

  private drawSignatureBox(
    document: PDFKit.PDFDocument,
    input: {
      x: number;
      y: number;
      width: number;
      height: number;
      title: string;
      signatureType: SignatureType;
      signatureData: string;
      signerName: string;
      signerRole: string;
      signedAt: Date;
    },
  ): void {
    document
      .roundedRect(
        input.x,
        input.y,
        input.width,
        input.height,
        5,
      )
      .lineWidth(0.8)
      .strokeColor('#8ABAD4')
      .stroke();

    document
      .rect(input.x, input.y, input.width, 25)
      .fill('#F1F7FA');

    document
      .font('Helvetica-Bold')
      .fontSize(8.8)
      .fillColor('#013069')
      .text(input.title, input.x + 8, input.y + 8, {
        width: input.width - 16,
        align: 'center',
      });

    const signatureY = input.y + 34;
    const signatureHeight = 43;

    if (input.signatureType === SignatureType.INITIALS) {
      document
        .font('Times-Italic')
        .fontSize(28)
        .fillColor('#111827')
        .text(input.signatureData, input.x + 10, signatureY + 5, {
          width: input.width - 20,
          align: 'center',
        });
    } else {
      const imageBuffer = this.decodePngSignature(
        input.signatureData,
      );

      document.image(imageBuffer, input.x + 12, signatureY, {
        fit: [input.width - 24, signatureHeight],
        align: 'center',
        valign: 'center',
      });
    }

    document
      .moveTo(input.x + 14, input.y + 82)
      .lineTo(input.x + input.width - 14, input.y + 82)
      .lineWidth(0.4)
      .strokeColor('#CBD5E1')
      .stroke();

    document
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#111827')
      .text(input.signerName, input.x + 8, input.y + 89, {
        width: input.width - 16,
        align: 'center',
      });

    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#475569')
      .text(input.signerRole, input.x + 8, input.y + 101, {
        width: input.width - 16,
        align: 'center',
      });

    document
      .font('Helvetica')
      .fontSize(6.8)
      .fillColor('#64748B')
      .text(
        this.formatDateTime(input.signedAt),
        input.x + 8,
        input.y + 112,
        {
          width: input.width - 16,
          align: 'center',
        },
      );
  }

  private decodePngSignature(signatureData: string): Buffer {
    const prefix = 'data:image/png;base64,';

    if (!signatureData.startsWith(prefix)) {
      throw new InternalServerErrorException(
        'Une signature dessinée enregistrée n’est pas au format PNG attendu.',
      );
    }

    const buffer = Buffer.from(
      signatureData.slice(prefix.length),
      'base64',
    );
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    if (
      buffer.length < pngHeader.length ||
      !buffer.subarray(0, pngHeader.length).equals(pngHeader)
    ) {
      throw new InternalServerErrorException(
        'Les données d’une signature dessinée ne correspondent pas à une image PNG valide.',
      );
    }

    return buffer;
  }

  private addFooters(
    document: PDFKit.PDFDocument,
    referenceNumber: string,
    generatedAt: Date,
    documentFingerprint: string,
  ): void {
    const range = document.bufferedPageRange();
    const pageCount = range.count;

    for (let index = 0; index < pageCount; index += 1) {
      document.switchToPage(range.start + index);

      const footerY = document.page.height - 56;
      const left = document.page.margins.left;
      const right = document.page.width - document.page.margins.right;

      document
        .moveTo(left, footerY - 8)
        .lineTo(right, footerY - 8)
        .lineWidth(0.6)
        .strokeColor('#8ABAD4')
        .stroke();

      document
        .font('Helvetica-Bold')
        .fontSize(6.8)
        .fillColor('#013069')
        .text('Document confidentiel', left, footerY, {
          width: 120,
        });

      document
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor('#475569')
        .text(
          `Généré le ${this.formatDateTime(generatedAt)}`,
          left + 122,
          footerY,
          {
            width: 170,
            align: 'center',
          },
        );

      document
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor('#475569')
        .text(
          `Page ${index + 1}/${pageCount}`,
          right - 72,
          footerY,
          {
            width: 72,
            align: 'right',
          },
        );

      document
        .font('Helvetica')
        .fontSize(5.8)
        .fillColor('#64748B')
        .text(
          `Référence : ${referenceNumber} — Empreinte documentaire : ${documentFingerprint.slice(0, 24).toUpperCase()}`,
          left,
          footerY + 12,
          {
            width: right - left,
            align: 'center',
          },
        );
    }
  }

  private ensureSpace(
    document: PDFKit.PDFDocument,
    requiredHeight: number,
  ): void {
    const contentBottom = document.page.height - 82;

    if (document.y + requiredHeight > contentBottom) {
      document.addPage();
    }
  }

  private formatDateOnly(dateValue: string): string {
    const [year, month, day] = dateValue
      .split('-')
      .map((value) => Number(value));

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
    }).format(new Date(year, month - 1, day));
  }

  private formatDateTime(dateValue: Date | null): string {
    if (!dateValue) {
      return 'Non renseigné';
    }

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(dateValue);
  }

  private formatDayPeriod(period: DayPeriod): string {
    return period === DayPeriod.MATIN
      ? 'matin'
      : 'après-midi';
  }

  private formatDays(days: number): string {
    return `${new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: Number.isInteger(days) ? 0 : 1,
      maximumFractionDigits: 2,
    }).format(days)} jour(s)`;
  }

  private formatOptionalDays(days: number | null): string {
    return days === null
      ? 'Non concerné'
      : this.formatDays(days);
  }

  private formatRole(role: UserRole | null): string {
    switch (role) {
      case UserRole.COLLABORATEUR:
        return 'Collaborateur';
      case UserRole.RESPONSABLE_SERVICE:
        return 'Responsable de service';
      case UserRole.RH:
        return 'Ressources humaines';
      case UserRole.DIRECTEUR:
        return 'Directeur';
      case UserRole.ADMIN:
        return 'Administrateur';
      default:
        return 'Non renseigné';
    }
  }

  private formatEmploymentType(
    employmentType: string,
  ): string {
    return employmentType === 'EXTERNE'
      ? 'Collaborateur externe'
      : 'Collaborateur interne';
  }
}
