import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createReadStream,
  promises as fs,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  DataSource,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';

import {
  AbsenceDeclaration,
  AbsenceDeclarationStatus,
} from '../absence-declarations/absence-declaration.entity';
import { AbsenceDeclarationsService } from '../absence-declarations/absence-declarations.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  LeaveRequest,
  LeaveRequestStatus,
} from '../leave-requests/leave-request.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole } from '../users/user.entity';
import {
  DocumentQueryDto,
  type DocumentLibraryCategory,
} from './dto/document-query.dto';
import {
  Document,
  DocumentKind,
  DocumentStatus,
} from './document.entity';

export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentMetadataResponse {
  id: number;
  leaveRequestId: number | null;
  absenceDeclarationId: number | null;
  documentKind: DocumentKind;
  originalName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: DocumentStatus;
  uploadedById: number;
  verifiedByRhId: number | null;
  rejectionReason: string | null;
  retentionUntil: string | null;
  uploadedAt: Date;
  verifiedAt: Date | null;
  deletedAt: Date | null;
}


export type RhDocumentLibraryKind =
  | DocumentKind
  | 'PDF_RECAPITULATIF';

export interface RhDocumentLibraryItem
  extends Omit<DocumentMetadataResponse, 'documentKind'> {
  documentKind: RhDocumentLibraryKind;
  category: DocumentLibraryCategory;
  employee: {
    id: number;
    nom: string;
    prenom: string;
  } | null;
  service: {
    id: number;
    name: string;
  } | null;
  source: {
    type: 'ABSENCE' | 'CONGE' | 'ANNULATION';
    id: number | null;
    label: string;
    startDate: string | null;
    endDate: string | null;
  };
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ACTIVE_DOCUMENTS = 5;
const ACTIVE_DOCUMENT_STATUSES = [
  DocumentStatus.EN_ATTENTE,
  DocumentStatus.ACCEPTE,
  DocumentStatus.REJETE,
];

const ALLOWED_FILE_TYPES: Record<
  string,
  { extensions: string[]; signature: (buffer: Buffer) => boolean }
> = {
  'application/pdf': {
    extensions: ['.pdf'],
    signature: (buffer) =>
      buffer.length >= 5 &&
      buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  'image/jpeg': {
    extensions: ['.jpg', '.jpeg'],
    signature: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  'image/png': {
    extensions: ['.png'],
    signature: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47,
          0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      ),
  },
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly privateStorageRoot: string;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,

    @InjectRepository(AbsenceDeclaration)
    private readonly absenceDeclarationRepository: Repository<AbsenceDeclaration>,

    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepository: Repository<LeaveRequest>,

    private readonly absenceDeclarationsService: AbsenceDeclarationsService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.privateStorageRoot = path.resolve(
      configService.get<string>(
        'PRIVATE_STORAGE_ROOT',
        path.join(process.cwd(), 'storage', 'private'),
      ),
    );
  }

  async uploadForAbsence(
    absenceDeclarationId: number,
    authenticatedUser: AuthenticatedUser,
    file: UploadedDocumentFile | undefined,
  ): Promise<DocumentMetadataResponse> {
    const declaration = await this.findAbsenceForDocumentAccess(
      absenceDeclarationId,
      authenticatedUser,
    );

    this.ensureAbsenceAcceptsDocuments(declaration);

    const document = await this.createDocument({
      file,
      authenticatedUser,
      leaveRequestId: null,
      absenceDeclarationId,
      folder: 'absence',
    });

    const becomesReadyForReview = [
      AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
      AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
    ].includes(declaration.status);

    if (becomesReadyForReview) {
      if (
        authenticatedUser.role === UserRole.RH
      ) {
        await this.absenceDeclarationsService.markDocumentProvidedByRh(
          absenceDeclarationId,
          authenticatedUser.id,
        );
      } else {
        await this.absenceDeclarationsService.markDocumentReadyForReview(
          absenceDeclarationId,
        );
      }
    }

    await this.notificationsService.createForActiveRoles(
      [UserRole.RH],
      {
        type: becomesReadyForReview
          ? 'SUPPORTING_DOCUMENT_TO_REVIEW'
          : 'SUPPORTING_DOCUMENT_RECEIVED',
        title: becomesReadyForReview
          ? 'Justificatif à vérifier'
          : 'Nouveau justificatif reçu',
        message: `${declaration.employee.nom} ${declaration.employee.prenom} a ajouté un justificatif à sa déclaration d’absence.`,
        absenceDeclarationId,
      },
    );

    return this.toMetadata(document);
  }

  async uploadForLeaveRequest(
    leaveRequestId: number,
    authenticatedUser: AuthenticatedUser,
    file: UploadedDocumentFile | undefined,
  ): Promise<DocumentMetadataResponse> {
    const leaveRequest = await this.findLeaveRequestForDocumentAccess(
      leaveRequestId,
      authenticatedUser,
    );

    if (
      ![
        LeaveRequestStatus.BROUILLON,
        LeaveRequestStatus.EN_ATTENTE_VALIDATION,
      ].includes(leaveRequest.status)
    ) {
      throw new BadRequestException(
        'Aucun justificatif ne peut être ajouté à cette demande dans son statut actuel.',
      );
    }

    const document = await this.createDocument({
      file,
      authenticatedUser,
      leaveRequestId,
      absenceDeclarationId: null,
      folder: 'leave-request',
    });

    await this.notificationsService.createForActiveRoles(
      [UserRole.RH],
      {
        type: 'SUPPORTING_DOCUMENT_RECEIVED',
        title: 'Nouveau justificatif reçu',
        message: `${leaveRequest.employee.nom} ${leaveRequest.employee.prenom} a ajouté un justificatif à sa demande de congé.`,
        leaveRequestId,
      },
    );

    return this.toMetadata(document);
  }

  async findMy(
    authenticatedUser: AuthenticatedUser,
  ): Promise<DocumentMetadataResponse[]> {
    const documents = await this.documentRepository
      .createQueryBuilder('document')
      .leftJoin('document.leaveRequest', 'leaveRequest')
      .leftJoin(
        'document.absenceDeclaration',
        'absenceDeclaration',
      )
      .where(
        '(leaveRequest.employeeId = :employeeId OR absenceDeclaration.employeeId = :employeeId)',
        { employeeId: authenticatedUser.id },
      )
      .andWhere('document.status NOT IN (:...hiddenStatuses)', {
        hiddenStatuses: [
          DocumentStatus.ARCHIVE,
          DocumentStatus.SUPPRIME,
        ],
      })
      .orderBy('document.uploadedAt', 'DESC')
      .getMany();

    return documents.map((document) =>
      this.toMetadata(document),
    );
  }

  async findForAbsence(
    absenceDeclarationId: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<DocumentMetadataResponse[]> {
    await this.findAbsenceForDocumentAccess(
      absenceDeclarationId,
      authenticatedUser,
    );

    const documents = await this.documentRepository.find({
      where: {
        absenceDeclarationId,
        status: Not(In([
          DocumentStatus.ARCHIVE,
          DocumentStatus.SUPPRIME,
        ])),
      },
      order: { uploadedAt: 'DESC' },
    });

    return documents.map((document) =>
      this.toMetadata(document),
    );
  }

  async findForLeaveRequest(
    leaveRequestId: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<DocumentMetadataResponse[]> {
    await this.findLeaveRequestForDocumentAccess(
      leaveRequestId,
      authenticatedUser,
    );

    const documents = await this.documentRepository.find({
      where: {
        leaveRequestId,
        status: Not(In([
          DocumentStatus.ARCHIVE,
          DocumentStatus.SUPPRIME,
        ])),
      },
      order: { uploadedAt: 'DESC' },
    });

    return documents.map((document) =>
      this.toMetadata(document),
    );
  }

  async findForManagement(
    query: DocumentQueryDto,
  ): Promise<DocumentMetadataResponse[]> {
    const qb = this.documentRepository
      .createQueryBuilder('document')
      .orderBy('document.uploadedAt', 'DESC');

    if (query.status) {
      qb.andWhere('document.status = :status', {
        status: query.status,
      });
    }

    if (query.leaveRequestId) {
      qb.andWhere('document.leaveRequestId = :leaveRequestId', {
        leaveRequestId: query.leaveRequestId,
      });
    }

    if (query.absenceDeclarationId) {
      qb.andWhere(
        'document.absenceDeclarationId = :absenceDeclarationId',
        {
          absenceDeclarationId: query.absenceDeclarationId,
        },
      );
    }

    const documents = await qb.getMany();

    return documents.map((document) =>
      this.toMetadata(document),
    );
  }


  async findLibraryForManagement(
    query: DocumentQueryDto,
  ): Promise<RhDocumentLibraryItem[]> {
    const qb = this.documentRepository
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.leaveRequest', 'leaveRequest')
      .leftJoinAndSelect('leaveRequest.employee', 'leaveEmployee')
      .leftJoinAndSelect('leaveRequest.service', 'leaveService')
      .leftJoinAndSelect('leaveRequest.leaveType', 'leaveType')
      .leftJoinAndSelect(
        'document.absenceDeclaration',
        'absenceDeclaration',
      )
      .leftJoinAndSelect(
        'absenceDeclaration.employee',
        'absenceEmployee',
      )
      .leftJoinAndSelect(
        'absenceDeclaration.service',
        'absenceService',
      )
      .leftJoinAndSelect(
        'absenceDeclaration.leaveType',
        'absenceType',
      )
      .where('document.status NOT IN (:...hiddenStatuses)', {
        hiddenStatuses: [
          DocumentStatus.ARCHIVE,
          DocumentStatus.SUPPRIME,
        ],
      })
      .andWhere("COALESCE(leaveEmployee.role, absenceEmployee.role, '') <> :directorRole", { directorRole: UserRole.DIRECTEUR })
      .orderBy('document.uploadedAt', 'DESC');

    if (query.status) {
      qb.andWhere('document.status = :status', {
        status: query.status,
      });
    }

    if (query.category === 'JUSTIFICATIFS') {
      qb.andWhere('document.documentKind = :documentKind', {
        documentKind: DocumentKind.JUSTIFICATIF,
      });
    } else if (query.category === 'CONGES') {
      qb.andWhere('document.documentKind = :documentKind', {
        documentKind: DocumentKind.PDF_VALIDATION,
      });
    } else if (query.category === 'ANNULATIONS') {
      qb.andWhere('document.documentKind = :documentKind', {
        documentKind: DocumentKind.PDF_ANNULATION,
      });
    }

    if (query.serviceId) {
      qb.andWhere(
        '(leaveRequest.serviceId = :serviceId OR absenceDeclaration.serviceId = :serviceId)',
        { serviceId: query.serviceId },
      );
    }

    if (query.employeeId) {
      qb.andWhere(
        '(leaveRequest.employeeId = :employeeId OR absenceDeclaration.employeeId = :employeeId)',
        { employeeId: query.employeeId },
      );
    }

    if (query.startDate) {
      qb.andWhere('DATE(document.uploadedAt) >= :startDate', {
        startDate: query.startDate,
      });
    }

    if (query.endDate) {
      qb.andWhere('DATE(document.uploadedAt) <= :endDate', {
        endDate: query.endDate,
      });
    }

    const documents = await qb.getMany();

    const storedItems: RhDocumentLibraryItem[] = documents.map((document) => {
      const leaveRequest = document.leaveRequest;
      const absenceDeclaration = document.absenceDeclaration;

      const employee =
        leaveRequest?.employee ?? absenceDeclaration?.employee ?? null;
      const service =
        leaveRequest?.service ?? absenceDeclaration?.service ?? null;

      let category: DocumentLibraryCategory = 'JUSTIFICATIFS';
      let sourceType: RhDocumentLibraryItem['source']['type'] = 'CONGE';
      let sourceLabel = 'Demande de congé';
      let sourceId: number | null = document.leaveRequestId;
      let startDate: string | null = leaveRequest?.startDate ?? null;
      let endDate: string | null = leaveRequest?.endDate ?? null;

      if (document.documentKind === DocumentKind.PDF_VALIDATION) {
        category = 'CONGES';
        sourceType = 'CONGE';
        sourceLabel = leaveRequest?.leaveType?.name ?? 'Congé validé';
      } else if (document.documentKind === DocumentKind.PDF_ANNULATION) {
        category = 'ANNULATIONS';
        sourceType = 'ANNULATION';
        sourceLabel = leaveRequest?.leaveType?.name
          ? `Annulation · ${leaveRequest.leaveType.name}`
          : 'Annulation de congé';
      } else if (absenceDeclaration) {
        category = 'JUSTIFICATIFS';
        sourceType = 'ABSENCE';
        sourceId = absenceDeclaration.id;
        sourceLabel = absenceDeclaration.leaveType?.name ?? 'Absence';
        startDate = absenceDeclaration.startDate;
        endDate = absenceDeclaration.endDate;
      } else {
        category = 'JUSTIFICATIFS';
        sourceType = 'CONGE';
        sourceLabel = leaveRequest?.leaveType?.name
          ? `Justificatif · ${leaveRequest.leaveType.name}`
          : 'Justificatif de congé';
      }

      return {
        ...this.toMetadata(document),
        category,
        employee: employee
          ? {
              id: employee.id,
              nom: employee.nom,
              prenom: employee.prenom,
            }
          : null,
        service: service
          ? {
              id: service.id,
              name: service.name,
            }
          : null,
        source: {
          type: sourceType,
          id: sourceId,
          label: sourceLabel,
          startDate,
          endDate,
        },
      };
    });

    const syntheticItems: RhDocumentLibraryItem[] = [];
    const shouldIncludeConges =
      !query.category || query.category === 'CONGES';
    const shouldIncludePending =
      !query.status || query.status === DocumentStatus.EN_ATTENTE;
    const shouldIncludeValidated =
      !query.status || query.status === DocumentStatus.ACCEPTE;

    if (shouldIncludeConges && (shouldIncludePending || shouldIncludeValidated)) {
      const requestQb = this.leaveRequestRepository
        .createQueryBuilder('libraryRequest')
        .leftJoinAndSelect('libraryRequest.employee', 'libraryEmployee')
        .leftJoinAndSelect('libraryRequest.service', 'libraryService')
        .leftJoinAndSelect('libraryRequest.leaveType', 'libraryLeaveType')
        .where('libraryRequest.status IN (:...libraryStatuses)', {
          libraryStatuses: [
            LeaveRequestStatus.EN_ATTENTE_VALIDATION,
            LeaveRequestStatus.VALIDEE,
            LeaveRequestStatus.ANNULATION_EN_ATTENTE_ACCORD,
            LeaveRequestStatus.ANNULEE_APRES_VALIDATION,
          ],
        })
        .andWhere('libraryEmployee.role <> :libraryDirectorRole', { libraryDirectorRole: UserRole.DIRECTEUR });

      if (query.serviceId) {
        requestQb.andWhere('libraryRequest.serviceId = :libraryServiceId', {
          libraryServiceId: query.serviceId,
        });
      }

      if (query.employeeId) {
        requestQb.andWhere('libraryRequest.employeeId = :libraryEmployeeId', {
          libraryEmployeeId: query.employeeId,
        });
      }

      const requests = await requestQb.getMany();
      const validationDocumentRequestIds = new Set(
        storedItems
          .filter((item) => item.documentKind === DocumentKind.PDF_VALIDATION)
          .map((item) => item.leaveRequestId)
          .filter((id): id is number => id !== null),
      );

      const isInDateRange = (value: Date): boolean => {
        const isoDate = value.toISOString().slice(0, 10);
        if (query.startDate && isoDate < query.startDate) return false;
        if (query.endDate && isoDate > query.endDate) return false;
        return true;
      };

      for (const leaveRequest of requests) {
        const employee = leaveRequest.employee;
        const service = leaveRequest.service;

        if (
          leaveRequest.status === LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
          shouldIncludePending
        ) {
          const uploadedAt =
            leaveRequest.submittedAt ?? leaveRequest.updatedAt ?? leaveRequest.createdAt;

          if (isInDateRange(uploadedAt)) {
            const year = uploadedAt.getFullYear();
            syntheticItems.push({
              id: -leaveRequest.id,
              leaveRequestId: leaveRequest.id,
              absenceDeclarationId: null,
              documentKind: 'PDF_RECAPITULATIF',
              originalName: `RECAP-${year}-${String(leaveRequest.id).padStart(6, '0')}.pdf`,
              mimeType: 'application/pdf',
              fileSize: null,
              status: DocumentStatus.EN_ATTENTE,
              uploadedById: leaveRequest.employeeId,
              verifiedByRhId: null,
              rejectionReason: null,
              retentionUntil: null,
              uploadedAt,
              verifiedAt: null,
              deletedAt: null,
              category: 'CONGES',
              employee: employee
                ? { id: employee.id, nom: employee.nom, prenom: employee.prenom }
                : null,
              service: service
                ? { id: service.id, name: service.name }
                : null,
              source: {
                type: 'CONGE',
                id: leaveRequest.id,
                label: leaveRequest.leaveType?.name
                  ? `Récapitulatif · ${leaveRequest.leaveType.name}`
                  : 'Récapitulatif de demande',
                startDate: leaveRequest.startDate,
                endDate: leaveRequest.endDate,
              },
            });
          }
        }

        if (
          leaveRequest.status !== LeaveRequestStatus.EN_ATTENTE_VALIDATION &&
          shouldIncludeValidated &&
          !validationDocumentRequestIds.has(leaveRequest.id)
        ) {
          const uploadedAt =
            leaveRequest.decisionAt ?? leaveRequest.updatedAt ?? leaveRequest.createdAt;

          if (isInDateRange(uploadedAt)) {
            const year = uploadedAt.getFullYear();
            syntheticItems.push({
              id: -1000000000 - leaveRequest.id,
              leaveRequestId: leaveRequest.id,
              absenceDeclarationId: null,
              documentKind: DocumentKind.PDF_VALIDATION,
              originalName: `CONGE-${year}-${String(leaveRequest.id).padStart(6, '0')}.pdf`,
              mimeType: 'application/pdf',
              fileSize: null,
              status: DocumentStatus.ACCEPTE,
              uploadedById:
                leaveRequest.finalDeciderId ?? leaveRequest.employeeId,
              verifiedByRhId: null,
              rejectionReason: null,
              retentionUntil: null,
              uploadedAt,
              verifiedAt: null,
              deletedAt: null,
              category: 'CONGES',
              employee: employee
                ? { id: employee.id, nom: employee.nom, prenom: employee.prenom }
                : null,
              service: service
                ? { id: service.id, name: service.name }
                : null,
              source: {
                type: 'CONGE',
                id: leaveRequest.id,
                label: leaveRequest.leaveType?.name ?? 'Congé validé',
                startDate: leaveRequest.startDate,
                endDate: leaveRequest.endDate,
              },
            });
          }
        }
      }
    }

    return [...storedItems, ...syntheticItems].sort(
      (left, right) =>
        right.uploadedAt.getTime() - left.uploadedAt.getTime(),
    );
  }

  async accept(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<DocumentMetadataResponse> {
    const document = await this.findActiveOne(id);

    await this.ensureParentReadyForReview(document);

    if (document.status !== DocumentStatus.EN_ATTENTE) {
      throw new BadRequestException(
        'Seul un justificatif en attente peut être accepté.',
      );
    }

    const result = await this.documentRepository.update(
      {
        id: document.id,
        status: DocumentStatus.EN_ATTENTE,
      },
      {
        status: DocumentStatus.ACCEPTE,
        verifiedByRhId: authenticatedUser.id,
        verifiedAt: new Date(),
        rejectionReason: null,
      },
    );

    if (!result.affected) {
      throw new ConflictException(
        'Ce justificatif a déjà été traité par un autre utilisateur.',
      );
    }

    const updatedDocument = await this.findActiveOne(id);
    const owner = await this.resolveDocumentOwner(updatedDocument);
    if (owner) {
      await this.notificationsService.create({
        userId: owner.employeeId,
        type: 'SUPPORTING_DOCUMENT_ACCEPTED',
        title: 'Justificatif accepté',
        message: 'Votre justificatif a été accepté par la RH.',
        leaveRequestId: updatedDocument.leaveRequestId,
        absenceDeclarationId: updatedDocument.absenceDeclarationId,
      });
    }

    return this.toMetadata(updatedDocument);
  }

  async reject(
    id: number,
    authenticatedUser: AuthenticatedUser,
    reason: string,
  ): Promise<DocumentMetadataResponse> {
    const document = await this.findActiveOne(id);

    await this.ensureParentReadyForReview(document);

    if (document.status !== DocumentStatus.EN_ATTENTE) {
      throw new BadRequestException(
        'Seul un justificatif en attente peut être rejeté.',
      );
    }

    const result = await this.documentRepository.update(
      {
        id: document.id,
        status: DocumentStatus.EN_ATTENTE,
      },
      {
        status: DocumentStatus.REJETE,
        verifiedByRhId: authenticatedUser.id,
        verifiedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    );

    if (!result.affected) {
      throw new ConflictException(
        'Ce justificatif a déjà été traité par un autre utilisateur.',
      );
    }

    if (document.absenceDeclarationId !== null) {
      await this.absenceDeclarationsService.markDocumentRejected(
        document.absenceDeclarationId,
      );
    }

    const updatedDocument = await this.findActiveOne(id);
    const owner = await this.resolveDocumentOwner(updatedDocument);
    if (owner) {
      await this.notificationsService.create({
        userId: owner.employeeId,
        type: 'SUPPORTING_DOCUMENT_REFUSED',
        title: 'Justificatif refusé',
        message: `Votre justificatif a été refusé par la RH.${reason.trim() ? ` Motif : ${reason.trim()}` : ''}`,
        leaveRequestId: updatedDocument.leaveRequestId,
        absenceDeclarationId: updatedDocument.absenceDeclarationId,
      });
    }

    return this.toMetadata(updatedDocument);
  }

  async replace(
    id: number,
    authenticatedUser: AuthenticatedUser,
    file: UploadedDocumentFile | undefined,
  ): Promise<DocumentMetadataResponse> {
    const existing = await this.findActiveOne(id);

    await this.ensureCanManageDocument(
      existing,
      authenticatedUser,
    );

    if (
      ![
        DocumentStatus.EN_ATTENTE,
        DocumentStatus.REJETE,
      ].includes(existing.status)
    ) {
      throw new BadRequestException(
        'Un justificatif accepté ne peut plus être remplacé.',
      );
    }

    const validatedFile = this.validateFile(file);
    const newStorageKey = this.createStorageKey(
      existing.absenceDeclarationId !== null
        ? 'absence'
        : 'leave-request',
      validatedFile.extension,
    );

    await this.writeFile(newStorageKey, validatedFile.buffer);

    let replacement: Document;

    try {
      replacement = await this.dataSource.transaction(
        async (manager) => {
          const current = await manager
            .getRepository(Document)
            .createQueryBuilder('document')
            .setLock('pessimistic_write')
            .where('document.id = :id', { id })
            .getOne();

          if (!current) {
            throw new NotFoundException(
              `Le justificatif ${id} est introuvable.`,
            );
          }

          if (
            ![
              DocumentStatus.EN_ATTENTE,
              DocumentStatus.REJETE,
            ].includes(current.status)
          ) {
            throw new BadRequestException(
              'Ce justificatif ne peut plus être remplacé.',
            );
          }

          current.status = DocumentStatus.ARCHIVE;
          current.deletedAt = new Date();

          await manager.getRepository(Document).save(current);

          const created = manager.getRepository(Document).create({
            leaveRequestId: current.leaveRequestId,
            absenceDeclarationId:
              current.absenceDeclarationId,
            documentKind: DocumentKind.JUSTIFICATIF,
            originalName: validatedFile.originalName,
            storageKey: newStorageKey,
            mimeType: validatedFile.mimeType,
            fileSize: validatedFile.size,
            status: DocumentStatus.EN_ATTENTE,
            uploadedById: authenticatedUser.id,
            verifiedByRhId: null,
            rejectionReason: null,
            retentionUntil: current.retentionUntil,
            verifiedAt: null,
            deletedAt: null,
          });

          return manager.getRepository(Document).save(created);
        },
      );
    } catch (error) {
      await this.deletePhysicalFile(newStorageKey);
      throw error;
    }

    await this.deletePhysicalFile(existing.storageKey);

    if (replacement.absenceDeclarationId !== null) {
      const declaration =
        await this.absenceDeclarationRepository.findOneBy({
          id: replacement.absenceDeclarationId,
        });

      if (
        declaration &&
        [
          AbsenceDeclarationStatus.JUSTIFICATIF_EN_ATTENTE,
          AbsenceDeclarationStatus.JUSTIFICATIF_REJETE,
        ].includes(declaration.status)
      ) {
        await this.absenceDeclarationsService.markDocumentReadyForReview(
          replacement.absenceDeclarationId,
        );
      }
    }

    return this.toMetadata(replacement);
  }

  async remove(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const document = await this.findActiveOne(id);

    await this.ensureCanManageDocument(
      document,
      authenticatedUser,
    );

    if (
      authenticatedUser.role !== UserRole.RH &&
      document.status === DocumentStatus.ACCEPTE
    ) {
      throw new ForbiddenException(
        'Un justificatif accepté ne peut être supprimé que par la RH.',
      );
    }

    document.status = DocumentStatus.SUPPRIME;
    document.deletedAt = new Date();

    await this.documentRepository.save(document);
    await this.deletePhysicalFile(document.storageKey);

    if (document.absenceDeclarationId !== null) {
      const remaining = await this.countActiveForParent({
        leaveRequestId: null,
        absenceDeclarationId:
          document.absenceDeclarationId,
      });

      if (remaining === 0) {
        await this.absenceDeclarationsService.markDocumentMissing(
          document.absenceDeclarationId,
        );
      }
    }

    return {
      message: 'Le justificatif a été supprimé.',
    };
  }

  async openForRh(id: number): Promise<{
    document: DocumentMetadataResponse;
    absolutePath: string;
  }> {
    const document = await this.findActiveOne(id);
    const absolutePath = this.resolveStoragePath(
      document.storageKey,
    );

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException(
        'Le fichier physique du justificatif est introuvable.',
      );
    }

    this.logger.log(
      `Consultation du justificatif ${document.id} par la RH.`,
    );

    return {
      document: this.toMetadata(document),
      absolutePath,
    };
  }

  async openForUser(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<{
    document: DocumentMetadataResponse;
    absolutePath: string;
  }> {
    const document = await this.findActiveOne(id);

    if (document.documentKind !== DocumentKind.JUSTIFICATIF) {
      throw new BadRequestException(
        'Cette route est réservée aux justificatifs.',
      );
    }

    await this.ensureCanManageDocument(
      document,
      authenticatedUser,
    );

    const absolutePath = this.resolveStoragePath(
      document.storageKey,
    );

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException(
        'Le fichier physique du justificatif est introuvable.',
      );
    }

    this.logger.log(
      `Consultation du justificatif ${document.id} par l’utilisateur ${authenticatedUser.id} (${authenticatedUser.role}).`,
    );

    return {
      document: this.toMetadata(document),
      absolutePath,
    };
  }

  createReadStream(absolutePath: string) {
    return createReadStream(absolutePath);
  }

  private async createDocument(input: {
    file: UploadedDocumentFile | undefined;
    authenticatedUser: AuthenticatedUser;
    leaveRequestId: number | null;
    absenceDeclarationId: number | null;
    folder: 'absence' | 'leave-request';
  }): Promise<Document> {
    const file = this.validateFile(input.file);
    const activeCount = await this.countActiveForParent({
      leaveRequestId: input.leaveRequestId,
      absenceDeclarationId: input.absenceDeclarationId,
    });

    if (activeCount >= MAX_ACTIVE_DOCUMENTS) {
      throw new BadRequestException(
        'Une demande ou déclaration ne peut contenir que cinq justificatifs actifs au maximum.',
      );
    }

    const storageKey = this.createStorageKey(
      input.folder,
      file.extension,
    );

    await this.writeFile(storageKey, file.buffer);

    try {
      const document = this.documentRepository.create({
        leaveRequestId: input.leaveRequestId,
        absenceDeclarationId: input.absenceDeclarationId,
        documentKind: DocumentKind.JUSTIFICATIF,
        originalName: file.originalName,
        storageKey,
        mimeType: file.mimeType,
        fileSize: file.size,
        status: DocumentStatus.EN_ATTENTE,
        uploadedById: input.authenticatedUser.id,
        verifiedByRhId: null,
        rejectionReason: null,
        retentionUntil: null,
        verifiedAt: null,
        deletedAt: null,
      });

      return await this.documentRepository.save(document);
    } catch (error) {
      await this.deletePhysicalFile(storageKey);
      throw error;
    }
  }

  private async findAbsenceForDocumentAccess(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<AbsenceDeclaration> {
    const declaration = await this.absenceDeclarationRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        leaveType: true,
      },
    });

    if (!declaration) {
      throw new NotFoundException(
        `La déclaration d’absence ${id} est introuvable.`,
      );
    }

    if (
      authenticatedUser.role !== UserRole.RH &&
      declaration.employeeId !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez gérer que les justificatifs de vos propres déclarations.',
      );
    }

    return declaration;
  }

  private async findLeaveRequestForDocumentAccess(
    id: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepository.findOne({
      where: { id },
      relations: {
        employee: true,
        leaveType: true,
      },
    });

    if (!leaveRequest) {
      throw new NotFoundException(
        `La demande de congé ${id} est introuvable.`,
      );
    }

    if (
      authenticatedUser.role !== UserRole.RH &&
      leaveRequest.employeeId !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez gérer que les justificatifs de vos propres demandes.',
      );
    }

    return leaveRequest;
  }

  private ensureAbsenceAcceptsDocuments(
    declaration: AbsenceDeclaration,
  ): void {
    if (
      [
        AbsenceDeclarationStatus.ENREGISTREE,
        AbsenceDeclarationStatus.ANNULEE,
      ].includes(declaration.status)
    ) {
      throw new BadRequestException(
        'Aucun justificatif ne peut être ajouté à cette déclaration dans son statut actuel.',
      );
    }
  }

  private async ensureParentReadyForReview(
    document: Document,
  ): Promise<void> {
    if (document.absenceDeclarationId !== null) {
      const declaration =
        await this.absenceDeclarationRepository.findOneBy({
          id: document.absenceDeclarationId,
        });

      if (!declaration) {
        throw new NotFoundException(
          'La déclaration liée au justificatif est introuvable.',
        );
      }

      if (
        declaration.status !==
        AbsenceDeclarationStatus.A_VERIFIER_PAR_RH
      ) {
        throw new BadRequestException(
          'Le justificatif ne peut être traité qu’après la transmission de la déclaration à la RH.',
        );
      }

      return;
    }

    if (document.leaveRequestId !== null) {
      const leaveRequest =
        await this.leaveRequestRepository.findOneBy({
          id: document.leaveRequestId,
        });

      if (!leaveRequest) {
        throw new NotFoundException(
          'La demande liée au justificatif est introuvable.',
        );
      }

      if (
        leaveRequest.status !==
        LeaveRequestStatus.EN_ATTENTE_VALIDATION
      ) {
        throw new BadRequestException(
          'Le justificatif ne peut être traité qu’après la soumission de la demande.',
        );
      }
    }
  }

  private async ensureCanManageDocument(
    document: Document,
    authenticatedUser: AuthenticatedUser,
  ): Promise<void> {
    if (authenticatedUser.role === UserRole.RH) {
      return;
    }

    if (document.absenceDeclarationId !== null) {
      const declaration =
        await this.absenceDeclarationRepository.findOneBy({
          id: document.absenceDeclarationId,
        });

      if (
        declaration?.employeeId === authenticatedUser.id
      ) {
        return;
      }
    }

    if (document.leaveRequestId !== null) {
      const leaveRequest =
        await this.leaveRequestRepository.findOneBy({
          id: document.leaveRequestId,
        });

      if (leaveRequest?.employeeId === authenticatedUser.id) {
        return;
      }
    }

    throw new ForbiddenException(
      'Vous ne pouvez pas gérer ce justificatif.',
    );
  }

  private async resolveDocumentOwner(
    document: Document,
  ): Promise<{ employeeId: number } | null> {
    if (document.leaveRequestId !== null) {
      const leaveRequest = await this.leaveRequestRepository.findOne({
        where: { id: document.leaveRequestId },
        select: { id: true, employeeId: true },
      });
      return leaveRequest
        ? { employeeId: leaveRequest.employeeId }
        : null;
    }

    if (document.absenceDeclarationId !== null) {
      const absence = await this.absenceDeclarationRepository.findOne({
        where: { id: document.absenceDeclarationId },
        select: { id: true, employeeId: true },
      });
      return absence
        ? { employeeId: absence.employeeId }
        : null;
    }

    return null;
  }

  private async findActiveOne(id: number): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: {
        id,
        status: Not(In([
          DocumentStatus.ARCHIVE,
          DocumentStatus.SUPPRIME,
        ])),
      },
    });

    if (!document) {
      throw new NotFoundException(
        `Le justificatif ${id} est introuvable.`,
      );
    }

    return document;
  }

  private async countActiveForParent(input: {
    leaveRequestId: number | null;
    absenceDeclarationId: number | null;
  }): Promise<number> {
    const hasLeaveRequest = input.leaveRequestId !== null;
    const hasAbsenceDeclaration =
      input.absenceDeclarationId !== null;

    if (hasLeaveRequest === hasAbsenceDeclaration) {
      throw new BadRequestException(
        'Un justificatif doit être rattaché à une seule demande de congé ou à une seule déclaration d’absence.',
      );
    }

    if (input.leaveRequestId !== null) {
      return this.documentRepository.count({
        where: {
          leaveRequestId: input.leaveRequestId,
          absenceDeclarationId: IsNull(),
          status: In(ACTIVE_DOCUMENT_STATUSES),
        },
      });
    }

    const absenceDeclarationId = input.absenceDeclarationId;

    if (absenceDeclarationId === null) {
      throw new BadRequestException(
        'La déclaration d’absence associée au justificatif est manquante.',
      );
    }

    return this.documentRepository.count({
      where: {
        leaveRequestId: IsNull(),
        absenceDeclarationId,
        status: In(ACTIVE_DOCUMENT_STATUSES),
      },
    });
  }

  private validateFile(file: UploadedDocumentFile | undefined): {
    originalName: string;
    mimeType: string;
    size: number;
    buffer: Buffer;
    extension: string;
  } {
    if (!file) {
      throw new BadRequestException(
        'Aucun fichier n’a été transmis.',
      );
    }

    if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException(
        'Le fichier transmis est vide ou invalide.',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        'Le fichier ne doit pas dépasser 10 Mo.',
      );
    }

    const allowedType = ALLOWED_FILE_TYPES[file.mimetype];
    const extension = path
      .extname(file.originalname)
      .toLowerCase();

    if (
      !allowedType ||
      !allowedType.extensions.includes(extension) ||
      !allowedType.signature(file.buffer)
    ) {
      throw new BadRequestException(
        'Seuls les fichiers PDF, JPG, JPEG et PNG valides sont acceptés.',
      );
    }

    const originalName = this.sanitizeOriginalName(
      file.originalname,
      extension,
    );

    return {
      originalName,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
      extension,
    };
  }

  private sanitizeOriginalName(
    originalName: string,
    extension: string,
  ): string {
    const baseName = path
      .basename(originalName)
      .replace(/\0/g, '')
      .trim();

    if (!baseName) {
      return `justificatif${extension}`;
    }

    if (baseName.length <= 255) {
      return baseName;
    }

    const nameWithoutExtension = path.basename(
      baseName,
      extension,
    );
    const maximumBaseLength = Math.max(
      1,
      255 - extension.length,
    );

    return `${nameWithoutExtension.slice(
      0,
      maximumBaseLength,
    )}${extension}`;
  }

  private createStorageKey(
    folder: 'absence' | 'leave-request',
    extension: string,
  ): string {
    const year = new Date().getFullYear().toString();

    return path
      .join(
        'supporting-documents',
        folder,
        year,
        `${randomUUID()}${extension}`,
      )
      .replace(/\\/g, '/');
  }

  private async writeFile(
    storageKey: string,
    buffer: Buffer,
  ): Promise<void> {
    const absolutePath = this.resolveStoragePath(storageKey);

    await fs.mkdir(path.dirname(absolutePath), {
      recursive: true,
    });
    await fs.writeFile(absolutePath, buffer, {
      flag: 'wx',
    });
  }

  private async deletePhysicalFile(
    storageKey: string,
  ): Promise<void> {
    const absolutePath = this.resolveStoragePath(storageKey);

    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String((error as { code: unknown }).code)
          : '';

      if (code !== 'ENOENT') {
        this.logger.warn(
          `Le fichier privé ${storageKey} n’a pas pu être supprimé immédiatement.`,
        );
      }
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const absolutePath = path.resolve(
      this.privateStorageRoot,
      storageKey,
    );
    const rootWithSeparator = `${this.privateStorageRoot}${path.sep}`;

    if (
      absolutePath !== this.privateStorageRoot &&
      !absolutePath.startsWith(rootWithSeparator)
    ) {
      throw new BadRequestException(
        'La clé de stockage du document est invalide.',
      );
    }

    return absolutePath;
  }

  private toMetadata(
    document: Document,
  ): DocumentMetadataResponse {
    return {
      id: document.id,
      leaveRequestId: document.leaveRequestId,
      absenceDeclarationId:
        document.absenceDeclarationId,
      documentKind: document.documentKind,
      originalName: document.originalName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      status: document.status,
      uploadedById: document.uploadedById,
      verifiedByRhId: document.verifiedByRhId,
      rejectionReason: document.rejectionReason,
      retentionUntil: document.retentionUntil,
      uploadedAt: document.uploadedAt,
      verifiedAt: document.verifiedAt,
      deletedAt: document.deletedAt,
    };
  }
}
