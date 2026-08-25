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

export interface AuditStatusChangeInput {
  actorId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  comment?: string | null;
  metadata?: Record<string, unknown> | null;
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

  async recordStatusChange(
    input: AuditStatusChangeInput,
    manager?: EntityManager,
  ): Promise<AuditLog> {
    return this.record(
      {
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        oldValue:
          input.oldStatus === undefined
            ? null
            : { status: input.oldStatus ?? null },
        newValue: {
          status: input.newStatus ?? null,
          comment: input.comment ?? null,
          metadata: input.metadata ?? null,
        },
        ipAddress: input.ipAddress,
      },
      manager,
    );
  }

  async findRhHistory(query: AuditQueryDto) {
    const qb = this.auditRepository
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.actor', 'actor')
      .where('actor.role = :rhRole', { rhRole: 'RH' })
      .orderBy('audit.createdAt', 'DESC')
      .take(query.limit ?? 2000);

    this.applyQueryFilters(qb, query);
    const logs = await qb.getMany();
    const collaboratorByResource = await this.resolveCollaborators(logs);

    return logs.map((log) => ({
      ...log,
      collaborator:
        log.resourceId === null
          ? null
          : collaboratorByResource.get(`${String(log.resourceType).toUpperCase()}:${log.resourceId}`) ?? null,
    }));
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

  private applyQueryFilters(qb: any, query: AuditQueryDto): void {
    if (query.action?.trim()) {
      qb.andWhere('audit.action = :action', { action: query.action.trim() });
    }
    if (query.resourceType?.trim()) {
      qb.andWhere('audit.resourceType = :resourceType', {
        resourceType: query.resourceType.trim().toUpperCase(),
      });
    }
    if (query.actorId) {
      qb.andWhere('audit.actorId = :actorId', { actorId: query.actorId });
    }
    if (query.resourceId) {
      qb.andWhere('audit.resourceId = :resourceId', { resourceId: query.resourceId });
    }
    if (query.startDate) {
      qb.andWhere('audit.createdAt >= :startDate', { startDate: `${query.startDate}T00:00:00` });
    }
    if (query.endDate) {
      qb.andWhere('audit.createdAt <= :endDate', { endDate: `${query.endDate}T23:59:59` });
    }
  }

  private async resolveCollaborators(logs: AuditLog[]): Promise<Map<string, { id: number; nom: string; prenom: string }>> {
    const result = new Map<string, { id: number; nom: string; prenom: string }>();
    const groups = new Map<string, number[]>();
    for (const log of logs) {
      if (!log.resourceId) continue;
      const type = String(log.resourceType ?? '').toUpperCase();
      const ids = groups.get(type) ?? [];
      ids.push(Number(log.resourceId));
      groups.set(type, ids);
    }

    const specs: Array<{ types: string[]; table: string; idColumn: string; employeeExpression: string; joins?: string }> = [
      { types: ['LEAVE_REQUESTS', 'LEAVE_REQUEST'], table: 'leave_requests r', idColumn: 'r.id', employeeExpression: 'r.employee_id' },
      { types: ['ABSENCE_DECLARATIONS', 'ABSENCE_DECLARATION'], table: 'absence_declarations r', idColumn: 'r.id', employeeExpression: 'r.employee_id' },
      { types: ['DEROGATIONS', 'DEROGATION'], table: 'derogations r', idColumn: 'r.id', employeeExpression: 'r.employee_id' },
      { types: ['LEAVE_BALANCE', 'LEAVE_BALANCES'], table: 'leave_balances r', idColumn: 'r.id', employeeExpression: 'r.employee_id' },
      { types: ['VALIDATOR_REPLACEMENTS'], table: 'validator_replacements r', idColumn: 'r.id', employeeExpression: 'r.employee_id' },
      {
        types: ['DOCUMENTS'],
        table: 'documents r',
        idColumn: 'r.id',
        employeeExpression: 'COALESCE(lr.employee_id, ad.employee_id)',
        joins: 'LEFT JOIN leave_requests lr ON lr.id = r.leave_request_id LEFT JOIN absence_declarations ad ON ad.id = r.absence_declaration_id',
      },
    ];

    for (const spec of specs) {
      const ids = [...new Set(spec.types.flatMap((type) => groups.get(type) ?? []))];
      if (!ids.length) continue;
      const placeholders = ids.map(() => '?').join(',');
      const rows = await this.auditRepository.manager.query(
        `SELECT ${spec.idColumn} AS resourceId, ${spec.employeeExpression} AS employeeId, u.nom, u.prenom
         FROM ${spec.table}
         ${spec.joins ?? ''}
         INNER JOIN users u ON u.id = ${spec.employeeExpression}
         WHERE ${spec.idColumn} IN (${placeholders})`,
        ids,
      );
      for (const row of rows) {
        for (const type of spec.types) {
          result.set(`${type}:${Number(row.resourceId)}`, {
            id: Number(row.employeeId),
            nom: row.nom,
            prenom: row.prenom,
          });
        }
      }
    }

    return result;
  }

}
