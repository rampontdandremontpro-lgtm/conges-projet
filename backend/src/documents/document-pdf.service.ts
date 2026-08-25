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

  private readonly pdfTemplateWidthPx = 1055;
  private readonly pdfTemplateHeightPx = 1491;

  private readonly validationPdfDesignVersion = 'code-v7-trace-uniform';

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
      storedDocument?.storageKey?.includes(`/${this.validationPdfDesignVersion}/`) === true;
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
      filename: this.createEmployeeDownloadFilename(
        leaveRequest,
        referenceNumber,
      ),
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
      filename: this.createEmployeeDownloadFilename(
        leaveRequest,
        referenceNumber,
      ),
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
          `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`,
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
            ? `${leaveRequest.cancellationRequestedBy.nom} ${leaveRequest.cancellationRequestedBy.prenom}`
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
        this.drawExactPendingDesign(document);
        this.drawExactPdfLogo(document, {
          xPx: 91,
          yPx: 68,
          widthPx: 170,
          heightPx: 170,
        });

        this.drawExactPdfText(document, referenceNumber, {
          xPx: 777,
          yPx: 164,
          widthPx: 184,
          fontSizePx: 14,
          font: 'Helvetica-Bold',
          color: '#FFFFFF',
          align: 'center',
        });

        const employeeName =
          `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`;

        [
          [employeeName, 532],
          [leaveRequest.employee.email, 577],
          [leaveRequest.service.name, 622],
        ].forEach(([value, yPx]) => {
          this.drawExactPdfText(document, String(value), {
            xPx: 420,
            yPx: Number(yPx),
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        const requestRows: Array<[string, number]> = [
          [leaveRequest.leaveType.name, 787],
          [
            `${this.formatDateOnly(leaveRequest.startDate)} — ${this.formatDayPeriod(leaveRequest.startPeriod)}`,
            831,
          ],
          [
            `${this.formatDateOnly(leaveRequest.endDate)} — ${this.formatDayPeriod(leaveRequest.endPeriod)}`,
            875,
          ],
          [this.formatDays(leaveRequest.deductedDays), 919],
          [this.formatDateTime(leaveRequest.submittedAt), 963],
          [
            leaveRequest.modificationDeadline
              ? this.formatDateOnly(
                  String(leaveRequest.modificationDeadline).slice(0, 10),
                )
              : 'Non renseignée',
            1007,
          ],
        ];

        requestRows.forEach(([value, yPx]) => {
          this.drawExactPdfText(document, value, {
            xPx: 420,
            yPx,
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        this.drawExactPdfText(
          document,
          this.formatOptionalDays(leaveRequest.realBalanceBefore),
          {
            xPx: 420,
            yPx: 1164,
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          },
        );
        this.drawExactPdfText(
          document,
          this.formatOptionalDays(leaveRequest.potentialBalanceBefore),
          {
            xPx: 420,
            yPx: 1209,
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          },
        );

        this.drawExactPendingFooter(document, {
          referenceNumber,
          generatedAt,
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
      this.validationPdfDesignVersion,
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
      employeeName: `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`,
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
        ? `${leaveRequest.finalDecider.nom} ${leaveRequest.finalDecider.prenom}`
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

  private drawExactValidationDesign(
    document: PDFKit.PDFDocument,
  ): void {
    this.drawExactPageBackground(document);

    this.drawExactHeaderShell(document, {
      xPx: 40,
      yPx: 45,
      widthPx: 968,
      heightPx: 198,
      leftStripeWidthPx: 31,
      logoDividerXPx: 294,
      referenceDividerXPx: 731,
      orangeTopStartPx: 842,
    });

    this.drawExactPdfText(document, 'Demande de congé\nvalidée', {
      xPx: 328,
      yPx: 80,
      widthPx: 360,
      fontSizePx: 36,
      font: 'Helvetica-Bold',
      color: '#0B2347',
      multiline: true,
      lineGapPx: -1,
    });
    this.drawExactValidatedBadge(document, 328, 184);
    this.drawExactPdfText(document, 'RÉFÉRENCE', {
      xPx: 758,
      yPx: 102,
      widthPx: 215,
      fontSizePx: 16,
      font: 'Helvetica-Bold',
      color: '#154FA6',
      align: 'center',
    });
    this.drawExactReferencePill(document, {
      xPx: 758,
      yPx: 137,
      widthPx: 215,
      heightPx: 53,
    });

    this.drawExactSectionCard(document, {
      xPx: 70,
      yPx: 270,
      widthPx: 914,
      heightPx: 220,
      title: 'INFORMATIONS DU COLLABORATEUR',
      icon: 'user',
      labels: [
        ['Collaborateur', 344],
        ['Adresse e-mail', 382],
        ['Service', 420],
        ['Statut professionnel', 458],
      ],
      labelXPx: 110,
      valueXPx: 412,
      lineStartXPx: 108,
      lineEndXPx: 952,
      firstRowYPx: 344,
      rowHeightPx: 38,
    });

    this.drawExactSectionCard(document, {
      xPx: 70,
      yPx: 500,
      widthPx: 914,
      heightPx: 245,
      title: 'DÉTAILS DU CONGÉ',
      icon: 'calendar',
      labels: [
        ['Type de congé', 572],
        ['Date de début', 610],
        ['Date de fin', 648],
        ['Durée calendaire', 686],
        ['Jours ouvrables décomptés', 724],
      ],
      labelXPx: 110,
      valueXPx: 412,
      lineStartXPx: 108,
      lineEndXPx: 952,
      firstRowYPx: 572,
      rowHeightPx: 38,
    });

    this.drawExactSectionCard(document, {
      xPx: 70,
      yPx: 755,
      widthPx: 914,
      heightPx: 165,
      title: 'SITUATION DU SOLDE',
      icon: 'balance',
      labels: [
        ['Solde réel avant validation', 825],
        ['Solde potentiel avant validation', 863],
        ['Solde réel après validation', 901],
      ],
      labelXPx: 110,
      valueXPx: 412,
      lineStartXPx: 108,
      lineEndXPx: 952,
      firstRowYPx: 825,
      rowHeightPx: 38,
    });

    this.drawExactSectionCard(document, {
      xPx: 70,
      yPx: 930,
      widthPx: 914,
      heightPx: 220,
      title: 'TRAÇABILITÉ',
      icon: 'document',
      labels: [
        ['Soumise le', 1004],
        ['Décision enregistrée le', 1042],
        ['Décision prise par', 1080],
        ['Rôle du valideur', 1118],
      ],
      labelXPx: 110,
      valueXPx: 412,
      lineStartXPx: 108,
      lineEndXPx: 952,
      firstRowYPx: 1004,
      rowHeightPx: 38,
    });

    this.drawExactValidationSignatureShell(document);
    this.drawExactOfficialFooterDesign(document);
  }

  private drawExactPendingDesign(
    document: PDFKit.PDFDocument,
  ): void {
    this.drawExactPageBackground(document);

    this.drawExactHeaderShell(document, {
      xPx: 49,
      yPx: 48,
      widthPx: 957,
      heightPx: 207,
      leftStripeWidthPx: 37,
      logoDividerXPx: 313,
      referenceDividerXPx: 746,
      orangeTopStartPx: null,
    });

    this.drawExactPdfText(
      document,
      'Récapitulatif de\ndemande de congé',
      {
        xPx: 343,
        yPx: 101,
        widthPx: 378,
        fontSizePx: 36,
        font: 'Helvetica-Bold',
        color: '#0B2347',
        multiline: true,
        lineGapPx: -1,
      },
    );
    document
      .moveTo(this.pdfTemplateX(document, 343), this.pdfTemplateY(document, 211))
      .lineTo(this.pdfTemplateX(document, 386), this.pdfTemplateY(document, 211))
      .lineWidth(this.pdfTemplateY(document, 4))
      .strokeColor('#F97316')
      .stroke();

    this.drawExactPdfText(document, 'RÉFÉRENCE', {
      xPx: 796,
      yPx: 121,
      widthPx: 165,
      fontSizePx: 16,
      font: 'Helvetica-Bold',
      color: '#154FA6',
      align: 'center',
    });
    this.drawExactReferencePill(document, {
      xPx: 766,
      yPx: 145,
      widthPx: 220,
      heightPx: 54,
    });

    this.drawExactPendingWarning(document);

    this.drawExactSectionCard(document, {
      xPx: 49,
      yPx: 437,
      widthPx: 957,
      heightPx: 227,
      title: 'INFORMATIONS DU COLLABORATEUR',
      icon: 'user',
      labels: [
        ['Nom', 532],
        ['Adresse e-mail', 577],
        ['Service', 622],
      ],
      labelXPx: 94,
      valueXPx: 420,
      lineStartXPx: 94,
      lineEndXPx: 953,
      pendingCard: true,
    });

    this.drawExactSectionCard(document, {
      xPx: 49,
      yPx: 694,
      widthPx: 957,
      heightPx: 350,
      title: 'DEMANDE',
      icon: 'calendar',
      labels: [
        ['Type de congé', 787],
        ['Date de début', 831],
        ['Date de fin', 875],
        ['Jours ouvrables décomptés', 919],
        ['Soumise le', 963],
        ['Modification possible jusqu’au', 1007],
      ],
      labelXPx: 94,
      valueXPx: 420,
      lineStartXPx: 94,
      lineEndXPx: 953,
      pendingCard: true,
    });

    this.drawExactSectionCard(document, {
      xPx: 49,
      yPx: 1075,
      widthPx: 957,
      heightPx: 170,
      title: 'SOLDE AU MOMENT DE LA SOUMISSION',
      icon: 'balance',
      labels: [
        ['Solde réel', 1164],
        ['Solde potentiel avant réservation', 1209],
      ],
      labelXPx: 94,
      valueXPx: 420,
      lineStartXPx: 94,
      lineEndXPx: 953,
      pendingCard: true,
    });

    this.drawExactPendingFooterBase(document);
  }

  private drawExactPageBackground(
    document: PDFKit.PDFDocument,
  ): void {
    document
      .rect(0, 0, document.page.width, document.page.height)
      .fill('#FFFFFF');
  }

  private drawExactHeaderShell(
    document: PDFKit.PDFDocument,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
      leftStripeWidthPx: number;
      logoDividerXPx: number;
      referenceDividerXPx: number;
      orangeTopStartPx: number | null;
    },
  ): void {
    this.drawExactShadow(document, {
      xPx: input.xPx,
      yPx: input.yPx,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      radiusPx: 18,
      offsetYPx: 7,
    });

    const x = this.pdfTemplateX(document, input.xPx);
    const y = this.pdfTemplateY(document, input.yPx);
    const width = this.pdfTemplateX(document, input.widthPx);
    const height = this.pdfTemplateY(document, input.heightPx);
    const radius = this.pdfTemplateY(document, 18);

    document
      .roundedRect(x, y, width, height, radius)
      .fillAndStroke('#FFFFFF', '#CFDFF2');

    document.save();
    document.roundedRect(x, y, width, height, radius).clip();
    document
      .rect(
        x,
        y,
        this.pdfTemplateX(document, input.leftStripeWidthPx),
        height,
      )
      .fill('#2457C5');
    document.restore();

    document
      .moveTo(
        this.pdfTemplateX(document, input.logoDividerXPx),
        this.pdfTemplateY(document, input.yPx + 31),
      )
      .lineTo(
        this.pdfTemplateX(document, input.logoDividerXPx),
        this.pdfTemplateY(document, input.yPx + input.heightPx - 27),
      )
      .lineWidth(this.pdfTemplateY(document, 1.1))
      .strokeColor('#D9E5F3')
      .stroke();

    const dividerX = this.pdfTemplateX(document, input.referenceDividerXPx);
    for (
      let py = input.yPx + 35;
      py <= input.yPx + input.heightPx - 34;
      py += 9
    ) {
      document
        .moveTo(dividerX, this.pdfTemplateY(document, py))
        .lineTo(dividerX, this.pdfTemplateY(document, py + 3.5))
        .lineWidth(this.pdfTemplateY(document, 1.2))
        .strokeColor('#8FB4E3')
        .stroke();
    }

    if (input.orangeTopStartPx !== null) {
      document
        .moveTo(
          this.pdfTemplateX(document, input.orangeTopStartPx),
          this.pdfTemplateY(document, input.yPx),
        )
        .lineTo(
          this.pdfTemplateX(
            document,
            input.xPx + input.widthPx - 9,
          ),
          this.pdfTemplateY(document, input.yPx),
        )
        .lineWidth(this.pdfTemplateY(document, 3))
        .strokeColor('#F97316')
        .stroke();
    }
  }

  private drawExactReferencePill(
    document: PDFKit.PDFDocument,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
    },
  ): void {
    document
      .roundedRect(
        this.pdfTemplateX(document, input.xPx),
        this.pdfTemplateY(document, input.yPx),
        this.pdfTemplateX(document, input.widthPx),
        this.pdfTemplateY(document, input.heightPx),
        this.pdfTemplateY(document, 7),
      )
      .fill('#12367F');
  }

  private drawExactValidatedBadge(
    document: PDFKit.PDFDocument,
    xPx: number,
    yPx: number,
  ): void {
    const x = this.pdfTemplateX(document, xPx);
    const y = this.pdfTemplateY(document, yPx);
    const width = this.pdfTemplateX(document, 120);
    const height = this.pdfTemplateY(document, 39);

    document
      .roundedRect(x, y, width, height, this.pdfTemplateY(document, 8))
      .fillAndStroke('#EAF9EF', '#82D69E');
    document
      .circle(
        x + this.pdfTemplateX(document, 22),
        y + height / 2,
        this.pdfTemplateY(document, 10),
      )
      .fill('#2BB763');
    document
      .moveTo(
        x + this.pdfTemplateX(document, 16),
        y + this.pdfTemplateY(document, 20),
      )
      .lineTo(
        x + this.pdfTemplateX(document, 20.5),
        y + this.pdfTemplateY(document, 24.5),
      )
      .lineTo(
        x + this.pdfTemplateX(document, 28),
        y + this.pdfTemplateY(document, 15.5),
      )
      .lineWidth(this.pdfTemplateY(document, 2))
      .strokeColor('#FFFFFF')
      .stroke();
    this.drawExactPdfTextCenteredInBox(document, 'Validée', {
      xPx: xPx + 39,
      yPx,
      widthPx: 75,
      heightPx: 39,
      fontSizePx: 17,
      font: 'Helvetica-Bold',
      color: '#249D52',
      align: 'center',
      opticalOffsetYPx: 1.5,
    });
  }

  private drawExactSectionCard(
    document: PDFKit.PDFDocument,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
      title: string;
      icon: 'user' | 'calendar' | 'balance' | 'document';
      labels: Array<[string, number]>;
      labelXPx: number;
      valueXPx: number;
      lineStartXPx: number;
      lineEndXPx: number;
      compactRows?: boolean;
      pendingCard?: boolean;
      firstRowYPx?: number;
      rowHeightPx?: number;
    },
  ): void {
    this.drawExactShadow(document, {
      xPx: input.xPx,
      yPx: input.yPx,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      radiusPx: 18,
      offsetYPx: 5,
    });

    const x = this.pdfTemplateX(document, input.xPx);
    const y = this.pdfTemplateY(document, input.yPx);
    const width = this.pdfTemplateX(document, input.widthPx);
    const height = this.pdfTemplateY(document, input.heightPx);
    const radius = this.pdfTemplateY(document, 18);
    const headerHeightPx = input.pendingCard ? 72 : 58;
    const headerHeight = this.pdfTemplateY(document, headerHeightPx);

    document
      .roundedRect(x, y, width, height, radius)
      .fillAndStroke('#FFFFFF', '#CFDFF2');

    document.save();
    document.roundedRect(x, y, width, height, radius).clip();
    document.rect(x, y, width, headerHeight).fill('#F4F8FD');
    document.restore();

    document
      .moveTo(x, y + headerHeight)
      .lineTo(x + width, y + headerHeight)
      .lineWidth(this.pdfTemplateY(document, 1))
      .strokeColor('#D3E1F1')
      .stroke();

    if (!input.pendingCard) {
      document
        .rect(
          x,
          this.pdfTemplateY(document, input.yPx + 20),
          this.pdfTemplateX(document, 3),
          this.pdfTemplateY(document, 39),
        )
        .fill('#F97316');
    }

    const iconXPx = input.pendingCard ? input.xPx + 23 : input.xPx + 23;
    const iconYPx = input.pendingCard ? input.yPx + 9 : input.yPx + 8;
    this.drawExactSectionIcon(document, input.icon, iconXPx, iconYPx);

    this.drawExactPdfText(document, input.title, {
      xPx: input.pendingCard ? input.xPx + 111 : input.xPx + 91,
      yPx: input.pendingCard ? input.yPx + 28 : input.yPx + 25,
      widthPx: input.widthPx - 145,
      fontSizePx: input.pendingCard ? 19 : 18,
      font: 'Helvetica-Bold',
      color: '#154FA6',
    });

    const explicitRowHeightPx = input.rowHeightPx ?? null;
    const explicitFirstRowYPx = input.firstRowYPx ?? null;

    input.labels.forEach(([label, configuredYPx], index) => {
      const rowYPx =
        explicitRowHeightPx !== null && explicitFirstRowYPx !== null
          ? explicitFirstRowYPx + index * explicitRowHeightPx
          : configuredYPx;

      this.drawExactPdfText(document, label, {
        xPx: input.labelXPx,
        yPx: rowYPx,
        widthPx: input.valueXPx - input.labelXPx - 24,
        fontSizePx: input.pendingCard ? 14.5 : input.compactRows ? 13.3 : 14.2,
        font: 'Helvetica-Bold',
        color: '#173B70',
      });

      if (index < input.labels.length - 1) {
        const nextRowYPx =
          explicitRowHeightPx !== null && explicitFirstRowYPx !== null
            ? rowYPx + explicitRowHeightPx
            : input.labels[index + 1][1];
        const lineY = rowYPx + (nextRowYPx - rowYPx) * 0.72;
        document
          .moveTo(
            this.pdfTemplateX(document, input.lineStartXPx),
            this.pdfTemplateY(document, lineY),
          )
          .lineTo(
            this.pdfTemplateX(document, input.lineEndXPx),
            this.pdfTemplateY(document, lineY),
          )
          .lineWidth(
            this.pdfTemplateY(document, input.compactRows ? 1.4 : 1),
          )
          .strokeColor('#D6E3F2')
          .stroke();
      }
    });
  }

  private drawExactSectionIcon(
    document: PDFKit.PDFDocument,
    icon: 'user' | 'calendar' | 'balance' | 'document',
    xPx: number,
    yPx: number,
  ): void {
    const x = this.pdfTemplateX(document, xPx);
    const y = this.pdfTemplateY(document, yPx);
    const size = this.pdfTemplateX(document, 47);
    const unitX = (value: number) => this.pdfTemplateX(document, value);
    const unitY = (value: number) => this.pdfTemplateY(document, value);

    document
      .roundedRect(x, y, size, size, unitY(12))
      .fill('#17499C');
    document
      .lineWidth(unitY(1.5))
      .strokeColor('#FFFFFF');

    if (icon === 'user') {
      document.circle(x + unitX(23.5), y + unitY(14), unitY(7)).stroke();
      document
        .roundedRect(
          x + unitX(13),
          y + unitY(25),
          unitX(21),
          unitY(14),
          unitY(7),
        )
        .stroke();
      return;
    }

    if (icon === 'calendar') {
      document
        .roundedRect(
          x + unitX(11),
          y + unitY(13),
          unitX(26),
          unitY(24),
          unitY(4),
        )
        .stroke();
      document
        .moveTo(x + unitX(11), y + unitY(20))
        .lineTo(x + unitX(37), y + unitY(20))
        .stroke();
      document
        .moveTo(x + unitX(17), y + unitY(9))
        .lineTo(x + unitX(17), y + unitY(16))
        .stroke();
      document
        .moveTo(x + unitX(31), y + unitY(9))
        .lineTo(x + unitX(31), y + unitY(16))
        .stroke();
      return;
    }

    if (icon === 'balance') {
      document
        .moveTo(x + unitX(23.5), y + unitY(9))
        .lineTo(x + unitX(23.5), y + unitY(37))
        .stroke();
      document
        .moveTo(x + unitX(12), y + unitY(15))
        .lineTo(x + unitX(35), y + unitY(15))
        .stroke();
      document
        .moveTo(x + unitX(16), y + unitY(15))
        .lineTo(x + unitX(11), y + unitY(28))
        .stroke();
      document
        .moveTo(x + unitX(31), y + unitY(15))
        .lineTo(x + unitX(36), y + unitY(28))
        .stroke();
      document
        .moveTo(x + unitX(8), y + unitY(28))
        .bezierCurveTo(
          x + unitX(10),
          y + unitY(34),
          x + unitX(18),
          y + unitY(34),
          x + unitX(20),
          y + unitY(28),
        )
        .stroke();
      document
        .moveTo(x + unitX(28), y + unitY(28))
        .bezierCurveTo(
          x + unitX(30),
          y + unitY(34),
          x + unitX(38),
          y + unitY(34),
          x + unitX(40),
          y + unitY(28),
        )
        .stroke();
      document
        .moveTo(x + unitX(16), y + unitY(38))
        .lineTo(x + unitX(31), y + unitY(38))
        .stroke();
      return;
    }

    document
      .roundedRect(
        x + unitX(13),
        y + unitY(9),
        unitX(22),
        unitY(29),
        unitY(4),
      )
      .stroke();
    [17, 23, 29].forEach((lineY) => {
      document
        .moveTo(x + unitX(18), y + unitY(lineY))
        .lineTo(x + unitX(30), y + unitY(lineY))
        .stroke();
    });
  }

  private drawExactPendingWarning(
    document: PDFKit.PDFDocument,
  ): void {
    const xPx = 49;
    const yPx = 290;
    const widthPx = 957;
    const heightPx = 120;
    const x = this.pdfTemplateX(document, xPx);
    const y = this.pdfTemplateY(document, yPx);
    const width = this.pdfTemplateX(document, widthPx);
    const height = this.pdfTemplateY(document, heightPx);

    document
      .roundedRect(x, y, width, height, this.pdfTemplateY(document, 18))
      .fillAndStroke('#FEF2F2', '#DC2626');

    document
      .circle(
        this.pdfTemplateX(document, 112),
        this.pdfTemplateY(document, 350),
        this.pdfTemplateY(document, 31),
      )
      .fill('#DC2626');
    this.drawExactExclamationMark(document, {
      centerXPx: 112,
      centerYPx: 350,
      scale: 1,
      color: '#FFFFFF',
    });

    this.drawExactPdfText(
      document,
      'DEMANDE EN ATTENTE DE VALIDATION — DOCUMENT NON DÉFINITIF',
      {
        xPx: 168,
        yPx: 322,
        widthPx: 680,
        fontSizePx: 19,
        font: 'Helvetica-Bold',
        color: '#B91C1C',
      },
    );
    this.drawExactPdfText(
      document,
      'Ce document est un récapitulatif provisoire. Il ne constitue pas une autorisation d’absence.',
      {
        xPx: 168,
        yPx: 362,
        widthPx: 705,
        fontSizePx: 14,
        font: 'Helvetica',
        color: '#3A5577',
      },
    );

    document.save();
    document.fillOpacity(0.11).strokeOpacity(0.11);
    document
      .circle(
        this.pdfTemplateX(document, 949),
        this.pdfTemplateY(document, 351),
        this.pdfTemplateY(document, 48),
      )
      .lineWidth(this.pdfTemplateY(document, 7))
      .strokeColor('#DC2626')
      .stroke();
    this.drawExactExclamationMark(document, {
      centerXPx: 949,
      centerYPx: 351,
      scale: 48 / 31,
      color: '#DC2626',
    });
    document.restore();
  }

  private drawExactExclamationMark(
    document: PDFKit.PDFDocument,
    input: {
      centerXPx: number;
      centerYPx: number;
      scale: number;
      color: string;
    },
  ): void {
    const centerX = this.pdfTemplateX(document, input.centerXPx);
    const stemTopY = this.pdfTemplateY(
      document,
      input.centerYPx - 20 * input.scale,
    );
    const stemBottomY = this.pdfTemplateY(
      document,
      input.centerYPx + 5 * input.scale,
    );
    const dotCenterY = this.pdfTemplateY(
      document,
      input.centerYPx + 17 * input.scale,
    );
    const stemWidth = this.pdfTemplateY(document, 6 * input.scale);
    const dotRadius = this.pdfTemplateY(document, 4 * input.scale);

    document.save();
    document
      .lineCap('round')
      .lineWidth(stemWidth)
      .strokeColor(input.color)
      .moveTo(centerX, stemTopY)
      .lineTo(centerX, stemBottomY)
      .stroke();
    document.circle(centerX, dotCenterY, dotRadius).fill(input.color);
    document.restore();
  }

  private drawExactValidationSignatureShell(
    document: PDFKit.PDFDocument,
  ): void {
    const xPx = 70;
    const yPx = 1160;
    const widthPx = 914;
    const heightPx = 202;

    this.drawExactShadow(document, {
      xPx,
      yPx,
      widthPx,
      heightPx,
      radiusPx: 18,
      offsetYPx: 5,
    });

    document
      .roundedRect(
        this.pdfTemplateX(document, xPx),
        this.pdfTemplateY(document, yPx),
        this.pdfTemplateX(document, widthPx),
        this.pdfTemplateY(document, heightPx),
        this.pdfTemplateY(document, 18),
      )
      .fillAndStroke('#FFFFFF', '#CADCF0');

    this.drawExactPdfText(document, 'SIGNATURES', {
      xPx: 442,
      yPx: 1180,
      widthPx: 170,
      fontSizePx: 18,
      font: 'Helvetica-Bold',
      color: '#154FA6',
      align: 'center',
    });

    [403, 597].forEach((startXPx) => {
      document
        .moveTo(
          this.pdfTemplateX(document, startXPx),
          this.pdfTemplateY(document, 1190),
        )
        .lineTo(
          this.pdfTemplateX(document, startXPx + 45),
          this.pdfTemplateY(document, 1190),
        )
        .lineWidth(this.pdfTemplateY(document, 1.3))
        .strokeColor('#8FB4E3')
        .stroke();
    });
    [448, 642].forEach((dotXPx) => {
      document
        .circle(
          this.pdfTemplateX(document, dotXPx),
          this.pdfTemplateY(document, 1190),
          this.pdfTemplateY(document, 3),
        )
        .fillAndStroke('#FFFFFF', '#8FB4E3');
    });

    document
      .moveTo(this.pdfTemplateX(document, 140), this.pdfTemplateY(document, 1274))
      .lineTo(this.pdfTemplateX(document, 397), this.pdfTemplateY(document, 1274))
      .lineWidth(this.pdfTemplateY(document, 1))
      .strokeColor('#B5C8DE')
      .stroke();
    document
      .moveTo(this.pdfTemplateX(document, 642), this.pdfTemplateY(document, 1274))
      .lineTo(this.pdfTemplateX(document, 899), this.pdfTemplateY(document, 1274))
      .lineWidth(this.pdfTemplateY(document, 1))
      .strokeColor('#B5C8DE')
      .stroke();

    this.drawExactValidationSeal(document);
  }

  private drawExactValidationSeal(
    document: PDFKit.PDFDocument,
  ): void {
    const cx = this.pdfTemplateX(document, 527);
    const cy = this.pdfTemplateY(document, 1266);
    const outer = this.pdfTemplateY(document, 35);
    const inner = this.pdfTemplateY(document, 26);

    document.save();
    document
      .moveTo(cx - this.pdfTemplateX(document, 22), cy + this.pdfTemplateY(document, 24))
      .lineTo(cx - this.pdfTemplateX(document, 11), cy + this.pdfTemplateY(document, 51))
      .lineTo(cx, cy + this.pdfTemplateY(document, 35))
      .closePath()
      .fill('#17499C');
    document
      .moveTo(cx + this.pdfTemplateX(document, 22), cy + this.pdfTemplateY(document, 24))
      .lineTo(cx + this.pdfTemplateX(document, 11), cy + this.pdfTemplateY(document, 51))
      .lineTo(cx, cy + this.pdfTemplateY(document, 35))
      .closePath()
      .fill('#17499C');
    document.restore();

    document
      .circle(cx, cy, outer)
      .fillAndStroke('#FFFFFF', '#17499C');
    document
      .circle(cx, cy, inner)
      .fillAndStroke('#F7FAFF', '#8FB4E3');
    document
      .moveTo(cx - this.pdfTemplateX(document, 10), cy)
      .lineTo(cx - this.pdfTemplateX(document, 2), cy + this.pdfTemplateY(document, 8))
      .lineTo(cx + this.pdfTemplateX(document, 13), cy - this.pdfTemplateY(document, 10))
      .lineWidth(this.pdfTemplateY(document, 3))
      .strokeColor('#17499C')
      .stroke();
  }

  private drawExactOfficialFooterDesign(
    document: PDFKit.PDFDocument,
  ): void {
    this.drawExactFooterWaves(document);

    this.drawExactFooterShield(document, 198, 1373);
    this.drawExactPdfText(
      document,
      'Document officiel généré par l’application\nde gestion des congés GMES',
      {
        xPx: 232,
        yPx: 1381,
        widthPx: 270,
        fontSizePx: 12.5,
        font: 'Helvetica',
        color: '#3C64A0',
        multiline: true,
        lineGapPx: 1,
      },
    );

    document
      .moveTo(this.pdfTemplateX(document, 527), this.pdfTemplateY(document, 1382))
      .lineTo(this.pdfTemplateX(document, 527), this.pdfTemplateY(document, 1415))
      .lineWidth(this.pdfTemplateY(document, 1.1))
      .strokeColor('#7EA5DA')
      .stroke();
  }

  private drawExactPendingFooterBase(
    document: PDFKit.PDFDocument,
  ): void {
    this.drawExactFooterWaves(document);

    const lineY = this.pdfTemplateY(document, 1281);
    document
      .moveTo(this.pdfTemplateX(document, 49), lineY)
      .lineTo(this.pdfTemplateX(document, 1006), lineY)
      .lineWidth(this.pdfTemplateY(document, 1.5))
      .strokeColor('#154FA6')
      .stroke();

    const centerX = document.page.width / 2;
    const radius = this.pdfTemplateY(document, 20);
    document.circle(centerX, lineY, radius).fillAndStroke('#FFFFFF', '#7EA9E7');
    document
      .moveTo(centerX - this.pdfTemplateX(document, 7), lineY)
      .lineTo(centerX - this.pdfTemplateX(document, 2), lineY + this.pdfTemplateY(document, 5))
      .lineTo(centerX + this.pdfTemplateX(document, 8), lineY - this.pdfTemplateY(document, 7))
      .lineWidth(this.pdfTemplateY(document, 2))
      .strokeColor('#154FA6')
      .stroke();

    this.drawExactPendingFooterDocumentIcon(document);

    const referencePillWidthPx = 212;
    const referencePillXPx =
      (this.pdfTemplateWidthPx - referencePillWidthPx) / 2;

    document
      .moveTo(this.pdfTemplateX(document, 180), this.pdfTemplateY(document, 1378))
      .lineTo(
        this.pdfTemplateX(document, referencePillXPx),
        this.pdfTemplateY(document, 1378),
      )
      .lineWidth(this.pdfTemplateY(document, 1.4))
      .strokeColor('#154FA6')
      .stroke();
    document
      .moveTo(
        this.pdfTemplateX(
          document,
          referencePillXPx + referencePillWidthPx,
        ),
        this.pdfTemplateY(document, 1378),
      )
      .lineTo(this.pdfTemplateX(document, 875), this.pdfTemplateY(document, 1378))
      .lineWidth(this.pdfTemplateY(document, 1.4))
      .strokeColor('#154FA6')
      .stroke();

    document
      .roundedRect(
        this.pdfTemplateX(document, referencePillXPx),
        this.pdfTemplateY(document, 1357),
        this.pdfTemplateX(document, referencePillWidthPx),
        this.pdfTemplateY(document, 42),
        this.pdfTemplateY(document, 7),
      )
      .fill('#0B2C6F');

    this.drawExactPdfText(
      document,
      'DOCUMENT PROVISOIRE – NE CONSTITUE PAS UNE AUTORISATION D’ABSENCE',
      {
        xPx: 255,
        yPx: 1411,
        widthPx: 550,
        fontSizePx: 12.5,
        font: 'Helvetica-Bold',
        color: '#154FA6',
        align: 'center',
      },
    );
  }

  private drawExactFooterShield(
    document: PDFKit.PDFDocument,
    xPx: number,
    yPx: number,
  ): void {
    const x = this.pdfTemplateX(document, xPx);
    const y = this.pdfTemplateY(document, yPx);
    document
      .moveTo(x, y)
      .lineTo(x + this.pdfTemplateX(document, 24), y)
      .lineTo(x + this.pdfTemplateX(document, 27), y + this.pdfTemplateY(document, 14))
      .bezierCurveTo(
        x + this.pdfTemplateX(document, 26),
        y + this.pdfTemplateY(document, 27),
        x + this.pdfTemplateX(document, 17),
        y + this.pdfTemplateY(document, 32),
        x + this.pdfTemplateX(document, 12),
        y + this.pdfTemplateY(document, 36),
      )
      .bezierCurveTo(
        x + this.pdfTemplateX(document, 7),
        y + this.pdfTemplateY(document, 32),
        x + this.pdfTemplateX(document, -2),
        y + this.pdfTemplateY(document, 27),
        x + this.pdfTemplateX(document, -3),
        y + this.pdfTemplateY(document, 14),
      )
      .closePath()
      .lineWidth(this.pdfTemplateY(document, 1.5))
      .strokeColor('#154FA6')
      .stroke();

    document
      .roundedRect(
        x + this.pdfTemplateX(document, 6),
        y + this.pdfTemplateY(document, 14),
        this.pdfTemplateX(document, 12),
        this.pdfTemplateY(document, 10),
        this.pdfTemplateY(document, 2),
      )
      .stroke();
    document
      .moveTo(
        x + this.pdfTemplateX(document, 7),
        y + this.pdfTemplateY(document, 14),
      )
      .bezierCurveTo(
        x + this.pdfTemplateX(document, 7),
        y + this.pdfTemplateY(document, 8),
        x + this.pdfTemplateX(document, 17),
        y + this.pdfTemplateY(document, 8),
        x + this.pdfTemplateX(document, 17),
        y + this.pdfTemplateY(document, 14),
      )
      .stroke();
  }

  private drawExactFooterWaves(
    document: PDFKit.PDFDocument,
  ): void {
    const width = document.page.width;
    const height = document.page.height;

    document
      .moveTo(0, this.pdfTemplateY(document, 1388))
      .bezierCurveTo(
        width * 0.25,
        this.pdfTemplateY(document, 1420),
        width * 0.62,
        this.pdfTemplateY(document, 1440),
        width,
        this.pdfTemplateY(document, 1393),
      )
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .fill('#DCEBFA');

    document
      .moveTo(0, this.pdfTemplateY(document, 1417))
      .bezierCurveTo(
        width * 0.26,
        this.pdfTemplateY(document, 1453),
        width * 0.62,
        this.pdfTemplateY(document, 1458),
        width,
        this.pdfTemplateY(document, 1411),
      )
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .fill('#285CC2');

    document
      .moveTo(0, this.pdfTemplateY(document, 1443))
      .bezierCurveTo(
        width * 0.30,
        this.pdfTemplateY(document, 1470),
        width * 0.60,
        this.pdfTemplateY(document, 1478),
        width,
        this.pdfTemplateY(document, 1438),
      )
      .lineTo(width, height)
      .lineTo(0, height)
      .closePath()
      .fill('#0B347C');

    document
      .moveTo(width * 0.78, this.pdfTemplateY(document, 1427))
      .bezierCurveTo(
        width * 0.87,
        this.pdfTemplateY(document, 1421),
        width * 0.95,
        this.pdfTemplateY(document, 1409),
        width,
        this.pdfTemplateY(document, 1397),
      )
      .lineWidth(this.pdfTemplateY(document, 4))
      .strokeColor('#F97316')
      .stroke();
  }

  private drawExactShadow(
    document: PDFKit.PDFDocument,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
      radiusPx: number;
      offsetYPx: number;
    },
  ): void {
    document.save();
    document.fillOpacity(0.42);
    document
      .roundedRect(
        this.pdfTemplateX(document, input.xPx + 1),
        this.pdfTemplateY(document, input.yPx + input.offsetYPx),
        this.pdfTemplateX(document, input.widthPx),
        this.pdfTemplateY(document, input.heightPx),
        this.pdfTemplateY(document, input.radiusPx),
      )
      .fill('#DCE5F0');
    document.restore();
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
        this.drawExactValidationDesign(document);
        this.drawExactPdfLogo(document, {
          xPx: 92,
          yPx: 63,
          widthPx: 168,
          heightPx: 168,
        });

        this.drawExactPdfTextCenteredInBox(document, referenceNumber, {
          xPx: 758,
          yPx: 137,
          widthPx: 215,
          heightPx: 53,
          fontSizePx: 14,
          font: 'Helvetica-Bold',
          color: '#FFFFFF',
          align: 'center',
          opticalOffsetYPx: 1,
        });

        const employeeName =
          `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`;

        [
          [employeeName, 344],
          [leaveRequest.employee.email, 382],
          [leaveRequest.service.name, 420],
          [
            this.formatEmploymentType(
              leaveRequest.employee.employmentType,
            ),
            458,
          ],
        ].forEach(([value, yPx]) => {
          this.drawExactPdfText(document, String(value), {
            xPx: 412,
            yPx: Number(yPx),
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        [
          [leaveRequest.leaveType.name, 572],
          [
            `${this.formatDateOnly(leaveRequest.startDate)} — ${this.formatDayPeriod(leaveRequest.startPeriod)}`,
            610,
          ],
          [
            `${this.formatDateOnly(leaveRequest.endDate)} — ${this.formatDayPeriod(leaveRequest.endPeriod)}`,
            648,
          ],
          [`${leaveRequest.calendarDuration} jour(s)`, 686],
          [this.formatDays(leaveRequest.deductedDays), 724],
        ].forEach(([value, yPx]) => {
          this.drawExactPdfText(document, String(value), {
            xPx: 412,
            yPx: Number(yPx),
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        [
          [
            this.formatOptionalDays(leaveRequest.realBalanceBefore),
            825,
          ],
          [
            this.formatOptionalDays(
              leaveRequest.potentialBalanceBefore,
            ),
            863,
          ],
          [
            this.formatOptionalDays(leaveRequest.realBalanceAfter),
            901,
          ],
        ].forEach(([value, yPx]) => {
          this.drawExactPdfText(document, String(value), {
            xPx: 412,
            yPx: Number(yPx),
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        [
          [this.formatDateTime(leaveRequest.submittedAt), 1004],
          [this.formatDateTime(leaveRequest.decisionAt), 1042],
          [
            `${leaveRequest.finalDecider?.nom ?? ''} ${leaveRequest.finalDecider?.prenom ?? ''}`.trim(),
            1080,
          ],
          [this.formatRole(leaveRequest.finalDeciderRole), 1118],
        ].forEach(([value, yPx]) => {
          this.drawExactPdfText(document, String(value), {
            xPx: 412,
            yPx: Number(yPx),
            widthPx: 500,
            fontSizePx: 15,
            font: 'Helvetica',
            color: '#173B70',
          });
        });

        this.drawExactValidationSignatures(document, leaveRequest);

        this.drawExactPdfText(
          document,
          `Référence : ${referenceNumber}`,
          {
            xPx: 555,
            yPx: 1391,
            widthPx: 280,
            fontSizePx: 13,
            font: 'Helvetica-Bold',
            color: '#154FA6',
            align: 'center',
          },
        );

        document
          .font('Helvetica')
          .fontSize(1)
          .fillOpacity(0)
          .text(
            `Empreinte ${documentFingerprint.slice(0, 20).toUpperCase()}`,
            0,
            document.page.height - 2,
            { lineBreak: false },
          )
          .fillOpacity(1);

        document.end();
      } catch (error) {
        rejectPromise(error);
      }
    });
  }

  private drawExactPdfLogo(
    document: PDFKit.PDFDocument,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
    },
  ): void {
    if (!existsSync(this.logoPath)) {
      return;
    }

    document.image(
      this.logoPath,
      this.pdfTemplateX(document, input.xPx),
      this.pdfTemplateY(document, input.yPx),
      {
        fit: [
          this.pdfTemplateX(document, input.widthPx),
          this.pdfTemplateY(document, input.heightPx),
        ],
        align: 'center',
        valign: 'center',
      },
    );
  }

  private drawExactPdfTextCenteredInBox(
    document: PDFKit.PDFDocument,
    value: string,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
      fontSizePx: number;
      font: string;
      color: string;
      align?: 'left' | 'center' | 'right';
      opticalOffsetYPx?: number;
    },
  ): void {
    const x = this.pdfTemplateX(document, input.xPx);
    const y = this.pdfTemplateY(document, input.yPx);
    const width = this.pdfTemplateX(document, input.widthPx);
    const height = this.pdfTemplateY(document, input.heightPx);
    const fontSize = this.pdfTemplateY(document, input.fontSizePx);
    const source = value || 'Non renseigné';

    document.font(input.font).fontSize(fontSize);
    const safeValue = this.truncatePdfText(
      document,
      source,
      width,
      fontSize,
      input.font,
    );
    const textHeight = document.heightOfString(safeValue, {
      width,
      lineBreak: false,
    });
    const opticalOffset = this.pdfTemplateY(
      document,
      input.opticalOffsetYPx ?? 0,
    );
    const textY = y + (height - textHeight) / 2 + opticalOffset;

    document
      .font(input.font)
      .fontSize(fontSize)
      .fillColor(input.color)
      .text(safeValue, x, textY, {
        width,
        align: input.align ?? 'center',
        lineBreak: false,
      });
  }

  private drawExactPdfText(
    document: PDFKit.PDFDocument,
    value: string,
    input: {
      xPx: number;
      yPx: number;
      widthPx: number;
      fontSizePx: number;
      font: string;
      color: string;
      align?: 'left' | 'center' | 'right';
      multiline?: boolean;
      lineGapPx?: number;
    },
  ): void {
    const x = this.pdfTemplateX(document, input.xPx);
    const y = this.pdfTemplateY(document, input.yPx);
    const width = this.pdfTemplateX(document, input.widthPx);
    const fontSize = this.pdfTemplateY(document, input.fontSizePx);

    const source = value || 'Non renseigné';
    const safeValue = input.multiline
      ? source
      : this.truncatePdfText(
          document,
          source,
          width,
          fontSize,
          input.font,
        );

    document
      .font(input.font)
      .fontSize(fontSize)
      .fillColor(input.color)
      .text(safeValue, x, y, {
        width,
        align: input.align ?? 'left',
        lineBreak: input.multiline === true,
        lineGap: this.pdfTemplateY(document, input.lineGapPx ?? 0),
      });
  }

  private drawExactValidationSignatures(
    document: PDFKit.PDFDocument,
    leaveRequest: LeaveRequest,
  ): void {
    this.drawExactPdfText(document, 'Collaborateur', {
      xPx: 176,
      yPx: 1183,
      widthPx: 210,
      fontSizePx: 14,
      font: 'Helvetica-Bold',
      color: '#154FA6',
      align: 'center',
    });
    this.drawExactPdfText(document, 'Valideur', {
      xPx: 666,
      yPx: 1183,
      widthPx: 210,
      fontSizePx: 14,
      font: 'Helvetica-Bold',
      color: '#154FA6',
      align: 'center',
    });

    this.drawExactSignature(document, {
      signatureType: leaveRequest.employeeSignatureType!,
      signatureData: leaveRequest.employeeSignatureData!,
      xPx: 176,
      yPx: 1216,
      widthPx: 210,
      heightPx: 47,
    });
    this.drawExactSignature(document, {
      signatureType: leaveRequest.validatorSignatureType!,
      signatureData: leaveRequest.validatorSignatureData!,
      xPx: 666,
      yPx: 1216,
      widthPx: 210,
      heightPx: 47,
    });

    const leftName =
      `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`;
    const rightName =
      `${leaveRequest.finalDecider!.nom} ${leaveRequest.finalDecider!.prenom}`;

    this.drawExactPdfText(document, leftName, {
      xPx: 158,
      yPx: 1284,
      widthPx: 245,
      fontSizePx: 15,
      font: 'Helvetica-Bold',
      color: '#0B2347',
      align: 'center',
    });
    this.drawExactPdfText(document, rightName, {
      xPx: 648,
      yPx: 1284,
      widthPx: 245,
      fontSizePx: 15,
      font: 'Helvetica-Bold',
      color: '#0B2347',
      align: 'center',
    });

    this.drawExactPdfText(document, 'Collaborateur', {
      xPx: 158,
      yPx: 1314,
      widthPx: 245,
      fontSizePx: 13,
      font: 'Helvetica-Oblique',
      color: '#345B8A',
      align: 'center',
    });
    this.drawExactPdfText(
      document,
      this.formatRole(leaveRequest.finalDeciderRole),
      {
        xPx: 648,
        yPx: 1314,
        widthPx: 245,
        fontSizePx: 13,
        font: 'Helvetica-Oblique',
        color: '#345B8A',
        align: 'center',
      },
    );

    this.drawExactPdfText(
      document,
      this.formatDateTime(leaveRequest.employeeSignedAt),
      {
        xPx: 158,
        yPx: 1338,
        widthPx: 245,
        fontSizePx: 11.5,
        font: 'Helvetica-Oblique',
        color: '#4E78A7',
        align: 'center',
      },
    );
    this.drawExactPdfText(
      document,
      this.formatDateTime(leaveRequest.validatorSignedAt),
      {
        xPx: 648,
        yPx: 1338,
        widthPx: 245,
        fontSizePx: 11.5,
        font: 'Helvetica-Oblique',
        color: '#4E78A7',
        align: 'center',
      },
    );
  }

  private drawExactSignature(
    document: PDFKit.PDFDocument,
    input: {
      signatureType: SignatureType;
      signatureData: string;
      xPx: number;
      yPx: number;
      widthPx: number;
      heightPx: number;
    },
  ): void {
    const x = this.pdfTemplateX(document, input.xPx);
    const y = this.pdfTemplateY(document, input.yPx);
    const width = this.pdfTemplateX(document, input.widthPx);
    const height = this.pdfTemplateY(document, input.heightPx);

    if (input.signatureType === SignatureType.INITIALS) {
      document
        .font('Times-Italic')
        .fontSize(this.pdfTemplateY(document, 31))
        .fillColor('#0B5DBB')
        .text(input.signatureData, x, y + this.pdfTemplateY(document, 4), {
          width,
          align: 'center',
          lineBreak: false,
        });
      return;
    }

    const imageBuffer = this.decodePngSignature(input.signatureData);
    document.image(imageBuffer, x, y, {
      fit: [width, height],
      align: 'center',
      valign: 'center',
    });
  }

  private drawExactPendingFooter(
    document: PDFKit.PDFDocument,
    input: {
      referenceNumber: string;
      generatedAt: Date;
    },
  ): void {
    const centerX = document.page.width / 2;
    const prefix = 'Document provisoire généré le ';
    const dateText = this.formatDateTime(input.generatedAt);
    const fontSize = this.pdfTemplateY(document, 13);

    document.font('Helvetica').fontSize(fontSize);
    const prefixWidth = document.widthOfString(prefix);
    document.font('Helvetica-Bold').fontSize(fontSize);
    const dateWidth = document.widthOfString(dateText);
    const totalWidth = prefixWidth + dateWidth;
    const textX = centerX - totalWidth / 2 + this.pdfTemplateX(document, 18);
    const textY = this.pdfTemplateY(document, 1318);

    document
      .font('Helvetica')
      .fontSize(fontSize)
      .fillColor('#395A83')
      .text(prefix, textX, textY, {
        lineBreak: false,
      });
    document
      .font('Helvetica-Bold')
      .fontSize(fontSize)
      .fillColor('#173B70')
      .text(dateText, textX + prefixWidth, textY, {
        lineBreak: false,
      });

    const referencePillWidthPx = 212;
    const referencePillXPx =
      (this.pdfTemplateWidthPx - referencePillWidthPx) / 2;

    this.drawExactPdfTextCenteredInBox(document, input.referenceNumber, {
      xPx: referencePillXPx,
      yPx: 1357,
      widthPx: referencePillWidthPx,
      heightPx: 42,
      fontSizePx: 14,
      font: 'Helvetica-Bold',
      color: '#FFFFFF',
      align: 'center',
      opticalOffsetYPx: 0.5,
    });
  }

  private drawExactPendingFooterDocumentIcon(
    document: PDFKit.PDFDocument,
  ): void {
    const x = this.pdfTemplateX(document, 330);
    const y = this.pdfTemplateY(document, 1307);
    const width = this.pdfTemplateX(document, 23);
    const height = this.pdfTemplateY(document, 31);

    document
      .roundedRect(
        x,
        y,
        width,
        height,
        this.pdfTemplateY(document, 3),
      )
      .lineWidth(this.pdfTemplateY(document, 1.4))
      .strokeColor('#154FA6')
      .stroke();

    [1317, 1324, 1331].forEach((linePx) => {
      document
        .moveTo(this.pdfTemplateX(document, 336), this.pdfTemplateY(document, linePx))
        .lineTo(this.pdfTemplateX(document, 348), this.pdfTemplateY(document, linePx))
        .lineWidth(this.pdfTemplateY(document, 1))
        .strokeColor('#154FA6')
        .stroke();
    });
  }

  private pdfTemplateX(
    document: PDFKit.PDFDocument,
    px: number,
  ): number {
    return (px / this.pdfTemplateWidthPx) * document.page.width;
  }

  private pdfTemplateY(
    document: PDFKit.PDFDocument,
    px: number,
  ): number {
    return (px / this.pdfTemplateHeightPx) * document.page.height;
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
      signerName: `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`,
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
      signerName: `${leaveRequest.finalDecider!.nom} ${leaveRequest.finalDecider!.prenom}`,
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
      signerName: `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom}`,
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
      signerName: `${leaveRequest.finalDecider!.nom} ${leaveRequest.finalDecider!.prenom}`,
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

  private createEmployeeDownloadFilename(
    leaveRequest: LeaveRequest,
    referenceNumber: string,
  ): string {
    const lastName = this.sanitizeDownloadFilenamePart(
      leaveRequest.employee.nom,
    );
    const firstName = this.sanitizeDownloadFilenamePart(
      leaveRequest.employee.prenom,
    );

    return `${lastName}_${firstName}-${referenceNumber}.pdf`;
  }

  private sanitizeDownloadFilenamePart(value: string): string {
    const sanitized = String(value ?? '')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/[. ]+$/g, '');

    return sanitized || 'Utilisateur';
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
