import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { Holiday, HolidayType } from './holiday.entity';

const OFFICIAL_API_BASE_URL =
  'https://calendrier.api.gouv.fr/jours-feries';
const OFFICIAL_API_SOURCE = 'calendrier.api.gouv.fr';

export interface HolidaySyncResult {
  year: number;
  source: string;
  received: number;
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  national: number;
  martiniqueSpecific: number;
}

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday)
    private readonly holidayRepository: Repository<Holiday>,
    private readonly auditService: AuditService,
  ) {}

  async create(
    authenticatedUser: AuthenticatedUser,
    createHolidayDto: CreateHolidayDto,
  ): Promise<Holiday> {
    const existingHoliday = await this.holidayRepository.findOneBy({
      date: createHolidayDto.date,
      holidayType: createHolidayDto.holidayType,
    });

    if (existingHoliday) {
      throw new ConflictException(
        'Un jour de ce type existe déjà à la date sélectionnée.',
      );
    }

    const holiday = this.holidayRepository.create({
      date: createHolidayDto.date,
      name: createHolidayDto.name.trim(),
      holidayType: createHolidayDto.holidayType,
      deductible: this.resolveDeductible(
        createHolidayDto.holidayType,
        createHolidayDto.deductible,
      ),
      source: createHolidayDto.source?.trim() || null,
      createdById: authenticatedUser.id,
      isActive: true,
    });

    const savedHoliday = await this.holidayRepository.save(holiday);

    await this.auditService.record({
      actorId: authenticatedUser.id,
      action: 'HOLIDAY_CREATED',
      resourceType: 'HOLIDAY',
      resourceId: savedHoliday.id,
      newValue: {
        date: savedHoliday.date,
        name: savedHoliday.name,
        holidayType: savedHoliday.holidayType,
      },
    });

    return this.findOne(savedHoliday.id);
  }

  async syncMartinique(
    year: number,
    authenticatedUser: AuthenticatedUser,
  ): Promise<HolidaySyncResult> {
    this.validateYear(year);

    const [martiniqueDays, metropolitanDays] = await Promise.all([
      this.fetchOfficialDays('martinique', year),
      this.fetchOfficialDays('metropole', year),
    ]);

    const metropolitanDates = new Set(Object.keys(metropolitanDays));
    const expectedKeys = new Set<string>();
    const result: HolidaySyncResult = {
      year,
      source: OFFICIAL_API_SOURCE,
      received: Object.keys(martiniqueDays).length,
      created: 0,
      updated: 0,
      reactivated: 0,
      deactivated: 0,
      national: 0,
      martiniqueSpecific: 0,
    };

    await this.holidayRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Holiday);
      const existing = await repository.find({
        where: {
          date: Between(`${year}-01-01`, `${year}-12-31`),
        },
      });
      const byKey = new Map(
        existing.map((holiday) => [
          `${holiday.date}|${holiday.holidayType}`,
          holiday,
        ]),
      );

      for (const [date, name] of Object.entries(martiniqueDays)) {
        const holidayType = metropolitanDates.has(date)
          ? HolidayType.NATIONAL
          : HolidayType.MARTINIQUE;
        const key = `${date}|${holidayType}`;
        expectedKeys.add(key);

        if (holidayType === HolidayType.NATIONAL) {
          result.national += 1;
        } else {
          result.martiniqueSpecific += 1;
        }

        const current = byKey.get(key);
        if (!current) {
          await repository.save(
            repository.create({
              date,
              name: name.trim(),
              holidayType,
              deductible: false,
              source: OFFICIAL_API_SOURCE,
              createdById: authenticatedUser.id,
              isActive: true,
            }),
          );
          result.created += 1;
          continue;
        }

        const wasInactive = !current.isActive;
        const changed =
          current.name !== name.trim() ||
          current.deductible !== false ||
          current.source !== OFFICIAL_API_SOURCE ||
          wasInactive;

        if (changed) {
          current.name = name.trim();
          current.deductible = false;
          current.source = OFFICIAL_API_SOURCE;
          current.isActive = true;
          current.createdById = authenticatedUser.id;
          await repository.save(current);
          result.updated += 1;
          if (wasInactive) {
            result.reactivated += 1;
          }
        }
      }

      for (const holiday of existing) {
        if (
          holiday.source === OFFICIAL_API_SOURCE &&
          holiday.holidayType !== HolidayType.FERMETURE_GMES &&
          holiday.isActive &&
          !expectedKeys.has(`${holiday.date}|${holiday.holidayType}`)
        ) {
          holiday.isActive = false;
          await repository.save(holiday);
          result.deactivated += 1;
        }
      }

      await this.auditService.record(
        {
          actorId: authenticatedUser.id,
          action: 'HOLIDAYS_MARTINIQUE_SYNCED',
          resourceType: 'HOLIDAY_SYNC',
          resourceId: null,
          newValue: { ...result },
        },
        manager,
      );
    });

    return result;
  }

  async findAllActive(year?: number): Promise<Holiday[]> {
    const where = year
      ? {
          date: Between(`${year}-01-01`, `${year}-12-31`),
          isActive: true,
        }
      : { isActive: true };

    return this.holidayRepository.find({
      where,
      order: {
        date: 'ASC',
        holidayType: 'ASC',
      },
    });
  }

  async findAllForManagement(year?: number): Promise<Holiday[]> {
    const where = year
      ? {
          date: Between(`${year}-01-01`, `${year}-12-31`),
        }
      : {};

    return this.holidayRepository.find({
      where,
      relations: { createdBy: true },
      order: {
        date: 'ASC',
        holidayType: 'ASC',
      },
    });
  }

  async findOne(id: number): Promise<Holiday> {
    const holiday = await this.holidayRepository.findOneBy({ id });

    if (!holiday) {
      throw new NotFoundException(
        `Le jour férié ou la fermeture ${id} est introuvable.`,
      );
    }

    return holiday;
  }

  async update(
    id: number,
    updateHolidayDto: UpdateHolidayDto,
  ): Promise<Holiday> {
    const holiday = await this.findOne(id);
    const date = updateHolidayDto.date ?? holiday.date;
    const holidayType =
      updateHolidayDto.holidayType ?? holiday.holidayType;

    const duplicate = await this.holidayRepository.findOne({
      where: {
        id: Not(id),
        date,
        holidayType,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'Un jour de ce type existe déjà à la date sélectionnée.',
      );
    }

    holiday.date = date;
    holiday.name = updateHolidayDto.name?.trim() ?? holiday.name;
    holiday.holidayType = holidayType;
    holiday.deductible = this.resolveDeductible(
      holidayType,
      updateHolidayDto.deductible ?? holiday.deductible,
    );

    if (updateHolidayDto.source !== undefined) {
      holiday.source = updateHolidayDto.source.trim() || null;
    }

    if (updateHolidayDto.isActive !== undefined) {
      holiday.isActive = updateHolidayDto.isActive;
    }

    await this.holidayRepository.save(holiday);

    return this.findOne(id);
  }

  async disable(id: number): Promise<Holiday> {
    const holiday = await this.findOne(id);
    holiday.isActive = false;

    await this.holidayRepository.save(holiday);

    return this.findOne(id);
  }

  async enable(id: number): Promise<Holiday> {
    const holiday = await this.findOne(id);
    holiday.isActive = true;

    await this.holidayRepository.save(holiday);

    return this.findOne(id);
  }

  async findNonDeductibleBetween(
    startDate: string,
    endDate: string,
  ): Promise<Holiday[]> {
    return this.holidayRepository.find({
      where: {
        date: Between(startDate, endDate),
        deductible: false,
        isActive: true,
      },
      order: { date: 'ASC' },
    });
  }

  private async fetchOfficialDays(
    zone: 'martinique' | 'metropole',
    year: number,
  ): Promise<Record<string, string>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(
        `${OFFICIAL_API_BASE_URL}/${zone}/${year}.json`,
        {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new BadGatewayException(
          `L’API officielle des jours fériés a répondu avec le statut ${response.status}.`,
        );
      }

      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new BadGatewayException(
          'La réponse de l’API officielle des jours fériés est invalide.',
        );
      }

      const normalized: Record<string, string> = {};
      for (const [date, name] of Object.entries(payload)) {
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          typeof name === 'string' &&
          name.trim()
        ) {
          normalized[date] = name.trim();
        }
      }

      return normalized;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException(
        `Impossible de joindre l’API officielle des jours fériés : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateYear(year: number): void {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException(
        'L’année doit être comprise entre 2000 et 2100.',
      );
    }
  }

  private resolveDeductible(
    holidayType: HolidayType,
    deductible?: boolean,
  ): boolean {
    if (
      holidayType === HolidayType.NATIONAL ||
      holidayType === HolidayType.MARTINIQUE
    ) {
      if (deductible === true) {
        throw new BadRequestException(
          'Un jour férié national ou martiniquais ne peut pas être décompté comme un jour travaillé.',
        );
      }

      return false;
    }

    return deductible ?? false;
  }
}
