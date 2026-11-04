import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  PATERNITY_DEADLINE_MONTHS,
  PATERNITY_SECOND_PERIOD_MAX_FRACTIONS,
  addMonthsIso,
  applicablePaternityLeaveRule,
  paternityCalendarDays,
} from '../leave-balances/paternity-leave.util';
import { User, UserRole } from '../users/user.entity';
import {
  BirthEvent,
  type BirthEventCorrection,
} from './birth-event.entity';
import { CorrectBirthEventDto } from './dto/correct-birth-event.dto';
import { CreateBirthEventDto } from './dto/create-birth-event.dto';

interface PaternityRow {
  start_date: string;
  end_date: string;
  status: string;
  family_event_context: string | null;
}

@Injectable()
export class BirthEventsService {
  constructor(
    @InjectRepository(BirthEvent)
    private readonly birthEventRepository: Repository<BirthEvent>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    authenticatedUser: AuthenticatedUser,
    dto: CreateBirthEventDto,
    employeeId?: number,
  ): Promise<BirthEvent> {
    const targetEmployeeId = employeeId ?? authenticatedUser.id;

    if (
      employeeId !== undefined &&
      employeeId !== authenticatedUser.id &&
      authenticatedUser.role !== UserRole.RH
    ) {
      throw new ForbiddenException(
        'Seule la RH peut créer un événement de naissance pour un autre salarié.',
      );
    }

    return this.createForEmployee(
      targetEmployeeId,
      dto.dateNaissance,
      dto.nbEnfants,
      authenticatedUser.id,
    );
  }

  async createForEmployee(
    employeeId: number,
    dateNaissance: string,
    nbEnfants: number,
    createdById: number,
  ): Promise<BirthEvent> {
    // L'unicité (employee_id, date_naissance) est garantie par la contrainte
    // MySQL : deux créations concurrentes ne peuvent pas produire deux quotas.
    try {
      return await this.birthEventRepository.save(
        this.birthEventRepository.create({
          id: randomUUID(),
          employeeId,
          dateNaissance,
          nbEnfants,
          createdById,
          corrections: null,
        }),
      );
    } catch (error) {
      if (this.isDuplicateEntryError(error)) {
        throw new ConflictException(
          `Une naissance est déjà enregistrée à la date du ${dateNaissance} pour ce salarié. Sélectionnez cet événement plutôt que d’en créer un nouveau.`,
        );
      }
      throw error;
    }
  }

  async findForEmployee(employeeId: number): Promise<BirthEvent[]> {
    return this.birthEventRepository.find({
      where: { employeeId },
      order: { dateNaissance: 'ASC' },
    });
  }

  async findOne(id: string): Promise<BirthEvent> {
    const event = await this.birthEventRepository.findOne({
      where: { id },
      relations: { employee: true },
    });
    if (!event) {
      throw new NotFoundException(
        `L’événement de naissance ${id} est introuvable.`,
      );
    }
    return event;
  }

  async findOneFor(
    id: string,
    authenticatedUser: AuthenticatedUser,
  ): Promise<BirthEvent> {
    const event = await this.findOne(id);
    if (
      authenticatedUser.role !== UserRole.RH &&
      event.employeeId !== authenticatedUser.id
    ) {
      throw new ForbiddenException(
        'Cet événement de naissance appartient à un autre salarié.',
      );
    }
    return event;
  }

  async assertOwnedBy(id: string, employeeId: number): Promise<BirthEvent> {
    const event = await this.findOne(id);
    if (event.employeeId !== employeeId) {
      throw new ForbiddenException(
        'Cet événement de naissance appartient à un autre salarié.',
      );
    }
    return event;
  }

  async correctByRh(
    id: string,
    authenticatedUser: AuthenticatedUser,
    dto: CorrectBirthEventDto,
  ): Promise<BirthEvent> {
    const event = await this.findOne(id);

    if (dto.dateNaissance === undefined && dto.nbEnfants === undefined) {
      return event;
    }

    const newDateNaissance = dto.dateNaissance ?? event.dateNaissance;
    const newNbEnfants = dto.nbEnfants ?? event.nbEnfants;

    if (newDateNaissance !== event.dateNaissance) {
      const conflicting = await this.birthEventRepository
        .createQueryBuilder('event')
        .where('event.employeeId = :employeeId', { employeeId: event.employeeId })
        .andWhere('event.dateNaissance = :date', { date: newDateNaissance })
        .andWhere('event.id <> :id', { id })
        .getOne();
      if (conflicting) {
        throw new ConflictException(
          'Une naissance existe déjà à cette date pour ce salarié.',
        );
      }
    }

    // Revalidation : une correction ne doit jamais créer des droits incohérents
    // (dépassement du total, seconde période > plafond, délai de 6 mois dépassé).
    await this.assertCorrectionConsistent(
      event.id,
      event.employeeId,
      newDateNaissance,
      newNbEnfants,
    );

    const correction: BirthEventCorrection = {
      reason: dto.reason.trim(),
      source: dto.source.trim(),
      previous: {
        dateNaissance: event.dateNaissance,
        nbEnfants: event.nbEnfants,
      },
      next: {
        dateNaissance: newDateNaissance,
        nbEnfants: newNbEnfants,
      },
      decidedBy: authenticatedUser.id,
      decidedAt: new Date().toISOString(),
    };

    event.dateNaissance = newDateNaissance;
    event.nbEnfants = newNbEnfants;
    event.corrections = [...(event.corrections ?? []), correction];

    return this.birthEventRepository.save(event);
  }

  private async assertCorrectionConsistent(
    eventId: string,
    employeeId: number,
    dateNaissance: string,
    nbEnfants: number,
  ): Promise<void> {
    const rows: PaternityRow[] = await this.dataSource.query(
      `SELECT DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
              a.status, a.family_event_context
         FROM absence_declarations a
         INNER JOIN leave_types lt ON lt.id = a.leave_type_id
        WHERE a.employee_id = ?
          AND lt.absence_kind = 'PATERNITE_ACCUEIL'
          AND a.status NOT IN ('BROUILLON', 'ANNULEE')`,
      [employeeId],
    );

    const rule = applicablePaternityLeaveRule(nbEnfants);
    const deadline = addMonthsIso(dateNaissance, PATERNITY_DEADLINE_MONTHS);

    let totalDays = 0;
    let firstPeriodCount = 0;
    let secondPeriodCount = 0;
    let secondPeriodDays = 0;

    for (const row of rows) {
      let ctx: Record<string, unknown> | undefined;
      try {
        ctx = row.family_event_context
          ? (JSON.parse(row.family_event_context) as Record<string, unknown>)
          : undefined;
      } catch {
        ctx = undefined;
      }
      if (ctx?.naissanceId !== eventId) continue;

      const days = paternityCalendarDays(row.start_date, row.end_date);
      totalDays += days;

      const periode = ctx?.periode === 'SECONDE' ? 'SECONDE' : 'PREMIERE';
      if (periode === 'PREMIERE') {
        firstPeriodCount += 1;
      } else {
        secondPeriodCount += 1;
        secondPeriodDays += days;
      }

      if (
        periode === 'SECONDE' &&
        row.end_date > deadline &&
        ctx?.hospitalisationEnfant !== true &&
        ctx?.decesMere !== true
      ) {
        throw new BadRequestException(
          `Correction impossible : une seconde période (${row.start_date} → ${row.end_date}) dépasse le délai de 6 mois après la nouvelle date de naissance (${deadline}).`,
        );
      }
    }

    if (totalDays > rule.totalDays) {
      throw new BadRequestException(
        `Correction impossible : ${totalDays} jours calendaires déjà pris dépassent le nouveau total de ${rule.totalDays} jours.`,
      );
    }
    if (firstPeriodCount > 1) {
      throw new BadRequestException(
        'Correction impossible : plusieurs premières périodes sont enregistrées pour cet événement.',
      );
    }
    if (secondPeriodCount > PATERNITY_SECOND_PERIOD_MAX_FRACTIONS) {
      throw new BadRequestException(
        `Correction impossible : plus de ${PATERNITY_SECOND_PERIOD_MAX_FRACTIONS} fractions de seconde période sont enregistrées.`,
      );
    }
    if (secondPeriodDays > rule.secondPeriodDays) {
      throw new BadRequestException(
        `Correction impossible : ${secondPeriodDays} jours de seconde période dépassent le plafond de ${rule.secondPeriodDays} jours.`,
      );
    }
  }

  private isDuplicateEntryError(error: unknown): boolean {
    const code = (error as { code?: string }).code;
    const driverError = (error as { driverError?: { code?: string } })
      .driverError;
    return code === 'ER_DUP_ENTRY' || driverError?.code === 'ER_DUP_ENTRY';
  }
}
