import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { Holiday, HolidayType } from './holiday.entity';

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday)
    private readonly holidayRepository: Repository<Holiday>,
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

    return this.findOne(savedHoliday.id);
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
