import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { DocumentStatus } from '../documents/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { SettingsService } from '../settings/settings.service';
import { LeaveBalance, LeaveBalanceCounterType } from './leave-balance.entity';
import { martiniqueDateString } from './reference-period.util';
import {
  takePeriodFor,
  takePeriodStatus,
  type TakePeriod,
  type TakePeriodStatusInfo,
} from './take-period.util';
import { TakePeriodReport } from './take-period-report.entity';
import { CreateTakePeriodReportDto } from './dto/create-take-period-report.dto';
import { UpdateTakePeriodReportDto } from './dto/update-take-period-report.dto';

export type TakePeriodProofStatus = 'VALIDE' | 'EN_ATTENTE_PREUVE';

export interface TakePeriodReportItem extends TakePeriodReport {
  proofStatus: TakePeriodProofStatus;
}

export interface TakePeriodEmployeeItem {
  employeeId: number;
  nom: string;
  prenom: string;
  legalEntityCode: string | null;
  remainingDays: number;
  effectiveDeadline: string;
  hasReport: boolean;
  reportId: number | null;
  reportProofStatus: TakePeriodProofStatus | null;
  status: TakePeriodStatusInfo;
}

export interface TakePeriodOverview {
  takePeriod: TakePeriod;
  status: TakePeriodStatusInfo;
  alertDays: number;
  employees: TakePeriodEmployeeItem[];
}

@Injectable()
export class TakePeriodService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async getOverview(referencePeriod: string): Promise<TakePeriodOverview> {
    const { takePeriod, alertDays, today } = await this.config(
      referencePeriod,
    );
    const status = takePeriodStatus(takePeriod, today, alertDays);

    const balances = await this.dataSource
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .innerJoinAndSelect('balance.employee', 'employee')
      .leftJoinAndSelect('employee.legalEntity', 'legalEntity')
      .where('balance.referencePeriod = :referencePeriod', { referencePeriod })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N,
      })
      .orderBy('employee.nom', 'ASC')
      .addOrderBy('employee.prenom', 'ASC')
      .getMany();

    const reports = await this.dataSource
      .getRepository(TakePeriodReport)
      .find({
        where: { referencePeriod },
        relations: { document: true },
      });
    const reportByEmployee = new Map(
      reports.map((report) => [report.employeeId, report]),
    );
    const validProofIds = await this.collectValidProofIds(reports);

    const employees: TakePeriodEmployeeItem[] = balances
      .map((balance) => {
        const remainingDays = this.round(
          balance.availableDays + balance.reservedDays,
        );
        const report = reportByEmployee.get(balance.employeeId);
        const proofValid = report
          ? validProofIds.has(report.documentId as number)
          : false;
        // Un report sans preuve valide reste PROVISOIRE : l'échéance légale
        // s'applique tant que la preuve n'est pas validée.
        const effectiveDeadline =
          report && proofValid ? report.newDeadline : takePeriod.end;
        return {
          employeeId: balance.employeeId,
          nom: balance.employee.nom,
          prenom: balance.employee.prenom,
          legalEntityCode: balance.employee.legalEntity?.code ?? null,
          remainingDays,
          effectiveDeadline,
          hasReport: report !== undefined,
          reportId: report?.id ?? null,
          reportProofStatus: report
            ? proofValid
              ? ('VALIDE' as const)
              : ('EN_ATTENTE_PREUVE' as const)
            : null,
          status: takePeriodStatus(
            { referencePeriod, start: takePeriod.start, end: effectiveDeadline },
            today,
            alertDays,
          ),
        };
      })
      .filter((item) => item.remainingDays > 0.001);

    return { takePeriod, status, alertDays, employees };
  }

  async listReports(referencePeriod: string): Promise<TakePeriodReportItem[]> {
    const reports = await this.dataSource
      .getRepository(TakePeriodReport)
      .find({
        where: { referencePeriod },
        relations: { employee: true, requestedBy: true, document: true },
        order: { employeeId: 'ASC' },
      });
    const validProofIds = await this.collectValidProofIds(reports);

    return reports.map((report) => ({
      ...report,
      proofStatus: validProofIds.has(report.documentId as number)
        ? 'VALIDE'
        : 'EN_ATTENTE_PREUVE',
    }));
  }

  async createReport(
    authenticatedUser: AuthenticatedUser,
    dto: CreateTakePeriodReportDto,
  ): Promise<TakePeriodReport> {
    this.assertRh(authenticatedUser);

    const { takePeriod, today } = await this.config(dto.referencePeriod);
    this.assertDeadline(dto.newDeadline, takePeriod, today);
    await this.assertDocument(dto.documentId);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TakePeriodReport);
      const existing = await repository.findOne({
        where: {
          employeeId: dto.employeeId,
          referencePeriod: dto.referencePeriod,
        },
      });
      if (existing) {
        throw new ConflictException(
          'Un report existe déjà pour ce collaborateur et cette période.',
        );
      }

      const report = await repository.save(
        repository.create({
          employeeId: dto.employeeId,
          employee: { id: dto.employeeId } as never,
          referencePeriod: dto.referencePeriod,
          requestedById: authenticatedUser.id,
          requestedBy: { id: authenticatedUser.id } as never,
          justification: dto.justification.trim(),
          documentId: dto.documentId ?? null,
          newDeadline: dto.newDeadline,
        }),
      );

      await this.auditService.record(
        {
          actorId: authenticatedUser.id,
          action: 'TAKE_PERIOD_REPORT_CREATED',
          resourceType: 'TAKE_PERIOD_REPORT',
          resourceId: report.id,
          oldValue: null,
          newValue: this.reportAuditValue(report),
        },
        manager,
      );

      return report;
    });
  }

  async updateReport(
    authenticatedUser: AuthenticatedUser,
    id: number,
    dto: UpdateTakePeriodReportDto,
  ): Promise<TakePeriodReport> {
    this.assertRh(authenticatedUser);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TakePeriodReport);
      const report = await repository.findOne({
        where: { id },
        relations: { employee: true, requestedBy: true },
      });
      if (!report) {
        throw new NotFoundException(`Le report ${id} est introuvable.`);
      }

      const { takePeriod, today } = await this.config(report.referencePeriod);
      const nextDeadline = dto.newDeadline ?? report.newDeadline;
      this.assertDeadline(nextDeadline, takePeriod, today);
      if (dto.documentId !== undefined) {
        await this.assertDocument(dto.documentId);
      }

      const previous = this.reportAuditValue(report);
      if (dto.justification !== undefined) {
        report.justification = dto.justification.trim();
      }
      if (dto.documentId !== undefined) {
        report.documentId = dto.documentId;
        report.document = dto.documentId ? ({ id: dto.documentId } as never) : null;
      }
      if (dto.newDeadline !== undefined) {
        report.newDeadline = dto.newDeadline;
      }

      const saved = await repository.save(report);
      await this.auditService.record(
        {
          actorId: authenticatedUser.id,
          action: 'TAKE_PERIOD_REPORT_UPDATED',
          resourceType: 'TAKE_PERIOD_REPORT',
          resourceId: saved.id,
          oldValue: previous,
          newValue: this.reportAuditValue(saved),
        },
        manager,
      );
      return saved;
    });
  }

  private async config(referencePeriod: string): Promise<{
    takePeriod: TakePeriod;
    alertDays: number;
    today: string;
  }> {
    const startMonthDay = await this.settingsService.getString(
      'TAKE_PERIOD_START',
      '05-01',
    );
    const durationMonths = await this.settingsService.getInteger(
      'TAKE_PERIOD_DURATION_MONTHS',
      13,
    );
    const alertDays = await this.settingsService.getInteger(
      'TAKE_PERIOD_ALERT_DAYS',
      30,
    );
    const takePeriod = takePeriodFor(
      referencePeriod,
      startMonthDay,
      durationMonths,
    );
    return { takePeriod, alertDays, today: martiniqueDateString(new Date()) };
  }

  private assertDeadline(
    newDeadline: string,
    takePeriod: TakePeriod,
    today: string,
  ): void {
    if (newDeadline <= takePeriod.end) {
      throw new BadRequestException(
        `La nouvelle échéance doit être postérieure à la fin de la période de prise (${takePeriod.end}).`,
      );
    }
    if (newDeadline <= today) {
      throw new BadRequestException(
        'La nouvelle échéance doit être postérieure à aujourd’hui.',
      );
    }
  }

  private assertRh(authenticatedUser: AuthenticatedUser): void {
    if (authenticatedUser.role !== 'RH') {
      throw new ConflictException('Seule la RH peut gérer les reports.');
    }
  }

  private reportAuditValue(report: TakePeriodReport): Record<string, unknown> {
    return {
      employeeId: report.employeeId,
      referencePeriod: report.referencePeriod,
      justification: report.justification,
      documentId: report.documentId,
      newDeadline: report.newDeadline,
      requestedById: report.requestedById,
    };
  }

  private async assertDocument(documentId: number | undefined): Promise<void> {
    if (documentId === undefined || documentId === null) return;
    // Preuve réellement conservée et validée (document actif ACCEPTE + fichier
    // physique présent). Lève une exception sinon — aucune validation silencieuse.
    await this.documentsService.assertConservedProof(documentId);
  }

  /**
   * Une preuve est valide uniquement si le document est toujours présent,
   * conservé au statut ACCEPTE ET physiquement accessible sur le stockage.
   * Un document supprimé, archivé ou dont le fichier a disparu rend le report
   * PROVISOIRE (en attente de preuve) — jamais validé juridiquement.
   * Vérification ciblée : seuls les documents ACCEPTE sont testés (aucun scan
   * du stockage pour les reports sans preuve).
   */
  private async collectValidProofIds(
    reports: TakePeriodReport[],
  ): Promise<Set<number>> {
    const ids = new Set<number>();
    for (const report of reports) {
      if (
        report.documentId != null &&
        report.document?.status === DocumentStatus.ACCEPTE
      ) {
        if (await this.documentsService.isConservedProof(report.documentId)) {
          ids.add(report.documentId);
        }
      }
    }
    return ids;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
