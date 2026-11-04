import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { LegalEntity, IllnessWageMaintenance } from './legal-entity.entity';
import { UpdateLegalEntityConventionDto } from './dto/update-legal-entity-convention.dto';
import { UpdateLegalEntityIllnessRegimeDto } from './dto/update-legal-entity-illness-regime.dto';

@Injectable()
export class LegalEntitiesService {
  constructor(
    @InjectRepository(LegalEntity)
    private readonly legalEntityRepository: Repository<LegalEntity>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  findAllActive(): Promise<LegalEntity[]> {
    return this.legalEntityRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  findById(id: number): Promise<LegalEntity | null> {
    return this.legalEntityRepository.findOneBy({ id });
  }

  findByCode(code: string): Promise<LegalEntity | null> {
    return this.legalEntityRepository.findOneBy({ code });
  }

  async updateConvention(
    id: number,
    dto: UpdateLegalEntityConventionDto,
    actorId: number,
  ): Promise<LegalEntity> {
    const entity = await this.legalEntityRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(
        `L’entité juridique ${id} est introuvable.`,
      );
    }

    const previous = {
      conventionType: entity.conventionType,
      idcc: entity.idcc,
      conventionName: entity.conventionName,
      accordType: entity.accordType,
      accordName: entity.accordName,
      accordIdcc: entity.accordIdcc,
      accordValidFrom: entity.accordValidFrom,
      accordValidTo: entity.accordValidTo,
      accordDocumentId: entity.accordDocumentId,
    };

    entity.conventionType = dto.conventionType;
    entity.idcc = dto.idcc?.trim() || null;
    entity.conventionName = dto.conventionName?.trim() || null;
    if (dto.accordType !== undefined) {
      entity.accordType = dto.accordType;
    }
    if (dto.accordName !== undefined) {
      entity.accordName = dto.accordName.trim() || null;
    }
    if (dto.accordIdcc !== undefined) {
      entity.accordIdcc = dto.accordIdcc.trim() || null;
    }
    if (dto.accordValidFrom !== undefined) {
      entity.accordValidFrom = dto.accordValidFrom
        ? dto.accordValidFrom.slice(0, 10)
        : null;
    }
    if (dto.accordValidTo !== undefined) {
      entity.accordValidTo = dto.accordValidTo
        ? dto.accordValidTo.slice(0, 10)
        : null;
    }
    if (dto.accordDocumentId !== undefined) {
      entity.accordDocumentId = dto.accordDocumentId;
    }
    if (
      entity.accordValidFrom &&
      entity.accordValidTo &&
      entity.accordValidFrom > entity.accordValidTo
    ) {
      throw new BadRequestException(
        'La période de validité de l’accord est incohérente (début après fin).',
      );
    }
    // Les dates de validité de l'accord ne valent preuve que si elles sont
    // adossées à un justificatif d'accord VÉRIFIÉ (validé par la RH, rattaché
    // à l'entité, non supprimé). Des dates seules ne constituent pas une preuve.
    if (
      entity.accordValidFrom ||
      entity.accordValidTo ||
      entity.accordDocumentId
    ) {
      await this.assertAccordDocumentVerified(entity);
    }

    const saved = await this.legalEntityRepository.save(entity);

    await this.auditService.record({
      actorId,
      action: 'LEGAL_ENTITY_CONVENTION_UPDATED',
      resourceType: 'LEGAL_ENTITY',
      resourceId: saved.id,
      oldValue: previous,
      newValue: {
        conventionType: saved.conventionType,
        idcc: saved.idcc,
        conventionName: saved.conventionName,
        accordType: saved.accordType,
        accordName: saved.accordName,
        accordIdcc: saved.accordIdcc,
        accordValidFrom: saved.accordValidFrom,
        accordValidTo: saved.accordValidTo,
        accordDocumentId: saved.accordDocumentId,
      },
    });

    return saved;
  }

  /**
   * JUR-025/037 — un accord ne vaut preuve que s'il est adossé à un justificatif
   * VÉRIFIÉ (document ACCEPTE, validé RH, rattaché à l'entité, non supprimé).
   */
  private async assertAccordDocumentVerified(
    entity: LegalEntity,
  ): Promise<void> {
    if (!entity.accordDocumentId) {
      throw new BadRequestException(
        'Les dates de validité de l’accord doivent être adossées à un justificatif d’accord vérifié (accordDocumentId).',
      );
    }
    const rows = await this.dataSource.query(
      `SELECT status, verified_by_rh_id, deleted_at, related_legal_entity_id
         FROM documents WHERE id = ? LIMIT 1`,
      [entity.accordDocumentId],
    );
    const document = rows?.[0];
    if (
      !document ||
      document.status !== 'ACCEPTE' ||
      !document.verified_by_rh_id ||
      document.deleted_at ||
      Number(document.related_legal_entity_id) !== Number(entity.id)
    ) {
      throw new BadRequestException(
        'Le justificatif d’accord doit être un document validé par la RH et rattaché à cette entité.',
      );
    }
  }

  /**
   * JUR-025/037 — décision RH contrôlée et historisée sur le régime applicable
   * aux arrêts maladie non professionnels. Une valeur UNKNOWN (ou un régime
   * SYNTEC sans maintien confirmé) interdit toute assimilation automatique.
   */
  async updateIllnessRegime(
    id: number,
    dto: UpdateLegalEntityIllnessRegimeDto,
    actorId: number,
  ): Promise<LegalEntity> {
    const entity = await this.legalEntityRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(
        `L’entité juridique ${id} est introuvable.`,
      );
    }

    const previous = entity.illnessWageMaintenance;
    entity.illnessWageMaintenance = dto.illnessWageMaintenance;
    const saved = await this.legalEntityRepository.save(entity);

    await this.auditService.record({
      actorId,
      action: 'LEGAL_ENTITY_ILLNESS_REGIME_UPDATED',
      resourceType: 'LEGAL_ENTITY',
      resourceId: saved.id,
      oldValue: { illnessWageMaintenance: previous },
      newValue: { illnessWageMaintenance: saved.illnessWageMaintenance },
    });

    return saved;
  }

  async getIllnessRegime(id: number): Promise<{
    illnessWageMaintenance: IllnessWageMaintenance;
  }> {
    const entity = await this.legalEntityRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(
        `L’entité juridique ${id} est introuvable.`,
      );
    }
    return { illnessWageMaintenance: entity.illnessWageMaintenance };
  }
}
