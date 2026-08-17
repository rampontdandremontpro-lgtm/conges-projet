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
const LEGAL_FALLBACK_SOURCE = 'code-travail-fallback';

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
  private readonly officialDaysCache = new Map<string, Promise<Record<string, string>>>();

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
    if (!year) {
      return this.holidayRepository.find({
        where: { isActive: true },
        order: { date: 'ASC', holidayType: 'ASC' },
      });
    }

    this.validateYear(year);

    const databaseDays = await this.holidayRepository.find({
      where: {
        date: Between(`${year}-01-01`, `${year}-12-31`),
        isActive: true,
      },
      order: { date: 'ASC', holidayType: 'ASC' },
    });

    const officialDays = await this.getMartiniqueCalendarDays(year);

    const closures = databaseDays.filter(
      (holiday) => holiday.holidayType === HolidayType.FERMETURE_GMES,
    );

    return [...officialDays, ...closures].sort((a, b) =>
      `${a.date}-${a.holidayType}`.localeCompare(
        `${b.date}-${b.holidayType}`,
      ),
    );
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
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      throw new BadRequestException(
        'Les dates doivent être fournies au format AAAA-MM-JJ.',
      );
    }

    if (endDate < startDate) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début.',
      );
    }

    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const years = Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => startYear + index,
    );

    const days = (
      await Promise.all(years.map((year) => this.findAllActive(year)))
    ).flat()
      .filter(
        (holiday) =>
          holiday.date >= startDate &&
          holiday.date <= endDate &&
          holiday.deductible === false &&
          holiday.isActive,
      );

    const byDateAndType = new Map<string, Holiday>();
    for (const holiday of days) {
      byDateAndType.set(`${holiday.date}|${holiday.holidayType}`, holiday);
    }

    return [...byDateAndType.values()].sort((a, b) =>
      `${a.date}-${a.holidayType}`.localeCompare(`${b.date}-${b.holidayType}`),
    );
  }

  async findCalendarBetween(
    startDate: string,
    endDate: string,
  ): Promise<Holiday[]> {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const years = Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => startYear + index,
    );

    return (
      await Promise.all(years.map((year) => this.findAllActive(year)))
    )
      .flat()
      .filter((holiday) => holiday.date >= startDate && holiday.date <= endDate)
      .sort((a, b) =>
        `${a.date}-${a.holidayType}`.localeCompare(
          `${b.date}-${b.holidayType}`,
        ),
      );
  }

  private async getMartiniqueCalendarDays(year: number): Promise<Holiday[]> {
    try {
      const [martiniqueDays, metropolitanDays] = await Promise.all([
        this.fetchOfficialDaysCached('martinique', year),
        this.fetchOfficialDaysCached('metropole', year),
      ]);
      const metropolitanDates = new Set(Object.keys(metropolitanDays));

      return Object.entries(martiniqueDays).map(([date, name]) =>
        this.holidayRepository.create({
          date,
          name,
          holidayType: metropolitanDates.has(date)
            ? HolidayType.NATIONAL
            : HolidayType.MARTINIQUE,
          deductible: false,
          source: OFFICIAL_API_SOURCE,
          createdById: null,
          isActive: true,
        }),
      );
    } catch {
      return this.buildMartiniqueLegalFallback(year);
    }
  }

  private fetchOfficialDaysCached(
    zone: 'martinique' | 'metropole',
    year: number,
  ): Promise<Record<string, string>> {
    const key = `${zone}:${year}`;
    const cached = this.officialDaysCache.get(key);
    if (cached) {
      return cached;
    }

    const request = this.fetchOfficialDays(zone, year).catch((error) => {
      this.officialDaysCache.delete(key);
      throw error;
    });
    this.officialDaysCache.set(key, request);
    return request;
  }

  private buildMartiniqueLegalFallback(year: number): Holiday[] {
    const easterSunday = this.calculateGregorianEasterSunday(year);
    const dateFromEaster = (days: number): string => {
      const date = new Date(easterSunday.getTime());
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    const national: Array<[string, string]> = [
      [`${year}-01-01`, '1er janvier'],
      [dateFromEaster(1), 'Lundi de Pâques'],
      [`${year}-05-01`, '1er mai'],
      [`${year}-05-08`, '8 mai'],
      [dateFromEaster(39), 'Ascension'],
      [dateFromEaster(50), 'Lundi de Pentecôte'],
      [`${year}-07-14`, '14 juillet'],
      [`${year}-08-15`, 'Assomption'],
      [`${year}-11-01`, 'Toussaint'],
      [`${year}-11-11`, '11 novembre'],
      [`${year}-12-25`, 'Jour de Noël'],
    ];

    const local: Array<[string, string]> = [
      [`${year}-05-22`, "Abolition de l'esclavage"],
    ];

    return [
      ...national.map(([date, name]) =>
        this.holidayRepository.create({
          date,
          name,
          holidayType: HolidayType.NATIONAL,
          deductible: false,
          source: LEGAL_FALLBACK_SOURCE,
          createdById: null,
          isActive: true,
        }),
      ),
      ...local.map(([date, name]) =>
        this.holidayRepository.create({
          date,
          name,
          holidayType: HolidayType.MARTINIQUE,
          deductible: false,
          source: LEGAL_FALLBACK_SOURCE,
          createdById: null,
          isActive: true,
        }),
      ),
    ];
  }

  private calculateGregorianEasterSunday(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(Date.UTC(year, month - 1, day));
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
