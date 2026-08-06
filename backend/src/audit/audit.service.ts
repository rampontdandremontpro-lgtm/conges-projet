import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditLog } from './audit-log.entity';

export interface AuditRecordInput {
  actorId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  async record(
    input: AuditRecordInput,
    manager?: EntityManager,
  ): Promise<AuditLog> {
    const repository = manager
      ? manager.getRepository(AuditLog)
      : this.auditRepository;

    const log = repository.create({
      actorId: input.actorId ?? null,
      action: input.action.slice(0, 120),
      resourceType: input.resourceType.slice(0, 100),
      resourceId: input.resourceId ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
    });

    return repository.save(log);
  }

  async findAll(query: AuditQueryDto): Promise<AuditLog[]> {
    const qb = this.auditRepository
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.actor', 'actor')
      .orderBy('audit.createdAt', 'DESC')
      .take(query.limit ?? 200);

    if (query.action?.trim()) {
      qb.andWhere('audit.action = :action', {
        action: query.action.trim(),
      });
    }

    if (query.resourceType?.trim()) {
      qb.andWhere('audit.resourceType = :resourceType', {
        resourceType: query.resourceType.trim().toUpperCase(),
      });
    }

    if (query.actorId) {
      qb.andWhere('audit.actorId = :actorId', {
        actorId: query.actorId,
      });
    }

    if (query.resourceId) {
      qb.andWhere('audit.resourceId = :resourceId', {
        resourceId: query.resourceId,
      });
    }

    if (query.startDate) {
      qb.andWhere('audit.createdAt >= :startDate', {
        startDate: `${query.startDate}T00:00:00`,
      });
    }

    if (query.endDate) {
      qb.andWhere('audit.createdAt <= :endDate', {
        endDate: `${query.endDate}T23:59:59`,
      });
    }

    return qb.getMany();
  }
}
