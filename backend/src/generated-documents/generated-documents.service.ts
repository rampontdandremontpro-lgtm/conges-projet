import {
  BadRequestException,
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
  DayPeriod,
  LeaveRequest,
  LeaveRequestStatus,
  SignatureType,
} from '../leave-requests/leave-request.entity';
import { UserRole } from '../users/user.entity';
import {
  GeneratedDocument,
  GeneratedDocumentType,
} from './generated-document.entity';

export interface ValidationPdfFile {
  buffer: Buffer;
  filename: string;
  referenceNumber: string;
  checksum: string;
}

@Injectable()
export class GeneratedDocumentsService {
  private readonly privateStorageRoot = resolve(
    process.cwd(),
    'storage',
    'private',
  );

  private readonly logoPath = resolve(
    process.cwd(),
    'assets',
    'gmes-logo.png',
  );

  constructor(
    @InjectRepository(GeneratedDocument)
    private readonly generatedDocumentRepository: Repository<GeneratedDocument>,

    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,
  ) {}

  async ensureValidationPdf(
    leaveRequestId: number,
    generatedByUserId: number | null,
  ): Promise<GeneratedDocument> {
    const leaveRequest =
      await this.findValidatedRequestWithSignatures(leaveRequestId);

    let generatedDocument =
      await this.generatedDocumentRepository.findOne({
        where: {
          leaveRequestId,
          documentType: GeneratedDocumentType.VALIDATION_PDF,
        },
        order: {
          generatedAt: 'DESC',
        },
      });

    const isNewDocument = generatedDocument === null;
    const generatedAt =
      generatedDocument?.generatedAt ?? new Date();
    const referenceNumber =
      generatedDocument?.referenceNumber ??
      this.createValidationReference(leaveRequest, generatedAt);
    const storageKey =
      generatedDocument?.storageKey ??
      this.createValidationStorageKey(
        referenceNumber,
        generatedAt,
      );
    const absolutePath = this.resolvePrivateStoragePath(storageKey);

    if (generatedDocument && (await this.fileExists(absolutePath))) {
      return generatedDocument;
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

    const checksum = createHash('sha256')
      .update(pdfBuffer)
      .digest('hex');

    await this.writeFileAtomically(absolutePath, pdfBuffer);

    try {
      if (generatedDocument) {
        generatedDocument.checksum = checksum;
        generatedDocument.generatedByUserId ??=
          generatedByUserId;
      } else {
        generatedDocument =
          this.generatedDocumentRepository.create({
            leaveRequestId: leaveRequest.id,
            leaveRequest,
            leaveCancellationId: null,
            documentType:
              GeneratedDocumentType.VALIDATION_PDF,
            referenceNumber,
            storageKey,
            checksum,
            generatedAt,
            generatedByUserId,
          });
      }

      return await this.generatedDocumentRepository.save(
        generatedDocument,
      );
    } catch (error) {
      if (isNewDocument) {
        await rm(absolutePath, { force: true });
      }

      throw new InternalServerErrorException(
        'Le PDF a été produit, mais son enregistrement a échoué.',
        {
          cause: error,
        },
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

    const generatedDocument = await this.ensureValidationPdf(
      leaveRequest.id,
      leaveRequest.finalDeciderId,
    );

    const absolutePath = this.resolvePrivateStoragePath(
      generatedDocument.storageKey,
    );

    let buffer: Buffer;

    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      throw new InternalServerErrorException(
        'Le fichier PDF officiel est introuvable dans le stockage privé.',
        {
          cause: error,
        },
      );
    }

    const checksum = createHash('sha256')
      .update(buffer)
      .digest('hex');

    if (
      generatedDocument.checksum !== null &&
      generatedDocument.checksum !== checksum
    ) {
      throw new InternalServerErrorException(
        'Le contrôle d’intégrité du PDF a échoué.',
      );
    }

    return {
      buffer,
      filename: `${generatedDocument.referenceNumber}.pdf`,
      referenceNumber: generatedDocument.referenceNumber,
      checksum,
    };
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

    if (leaveRequest.status !== LeaveRequestStatus.VALIDEE) {
      throw new BadRequestException(
        'Un PDF officiel est généré uniquement pour une demande validée.',
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
      throw new InternalServerErrorException(
        'La demande validée ne contient pas toutes les informations nécessaires à la génération du PDF.',
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
      'generated-documents',
      'validation',
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
        margins: {
          top: 42,
          right: 48,
          bottom: 76,
          left: 48,
        },
        bufferPages: true,
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
        this.drawMainHeader(
          document,
          referenceNumber,
        );

        document.on('pageAdded', () => {
          this.drawContinuationHeader(
            document,
            referenceNumber,
          );
        });

        this.drawSectionTitle(
          document,
          'Informations du collaborateur',
        );
        this.drawKeyValueRows(document, [
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
        ]);

        this.drawSectionTitle(document, 'Détails du congé');
        this.drawKeyValueRows(document, [
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
        ]);

        this.drawSectionTitle(document, 'Situation du solde');
        this.drawKeyValueRows(document, [
          [
            'Solde réel avant validation',
            this.formatOptionalDays(
              leaveRequest.realBalanceBefore,
            ),
          ],
          [
            'Solde potentiel avant validation',
            this.formatOptionalDays(
              leaveRequest.potentialBalanceBefore,
            ),
          ],
          [
            'Solde réel après validation',
            this.formatOptionalDays(
              leaveRequest.realBalanceAfter,
            ),
          ],
        ]);

        this.drawSectionTitle(document, 'Traçabilité');
        this.drawKeyValueRows(document, [
          [
            'Soumise le',
            this.formatDateTime(leaveRequest.submittedAt),
          ],
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
        ]);

        if (leaveRequest.comment) {
          this.ensureSpace(document, 90);
          this.drawSectionTitle(document, 'Commentaire');
          document
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#1F2937')
            .text(leaveRequest.comment, {
              align: 'justify',
              lineGap: 2,
            });
          document.moveDown(0.8);
        }

        if (leaveRequest.rhConfirmedDirectorAgreement) {
          this.ensureSpace(document, 58);
          const confirmationY = document.y;
          const confirmationWidth =
            document.page.width -
            document.page.margins.left -
            document.page.margins.right;

          document
            .roundedRect(
              document.page.margins.left,
              confirmationY,
              confirmationWidth,
              44,
              5,
            )
            .fillAndStroke('#E8F4FB', '#0078B8');
          document
            .font('Helvetica-Bold')
            .fontSize(9)
            .fillColor('#013069')
            .text(
              'Validation RH avec confirmation de l’accord du Directeur',
              document.page.margins.left + 12,
              confirmationY + 8,
              {
                width: confirmationWidth - 24,
              },
            );
          document
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor('#334155')
            .text(
              `Confirmation enregistrée le ${this.formatDateTime(leaveRequest.rhDirectorAgreementConfirmedAt)}.`,
              document.page.margins.left + 12,
              confirmationY + 24,
              {
                width: confirmationWidth - 24,
              },
            );
          document.y = confirmationY + 54;
        }

        this.ensureSpace(document, 172);
        this.drawSectionTitle(document, 'Signatures');
        this.drawSignatures(document, leaveRequest);

        this.addFooters(
          document,
          referenceNumber,
          generatedAt,
          documentFingerprint,
        );

        document.end();
      } catch (error) {
        rejectPromise(error);
      }
    });
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
