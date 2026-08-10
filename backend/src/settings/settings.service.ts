import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { User } from '../users/user.entity';
import { Setting } from './setting.entity';
import { UpdateSettingDto } from './dto/update-setting.dto';

export interface SubmissionRules {
  normalDeadlineDays: number;
  specialDeadlineDays: number;
  specialDurationThresholdDays: number;
  derogationLastAllowedDay: number;
  summerPeriodStart: string;
  summerPeriodEnd: string;
}

export type AfternoonStartHourChangeListener = () => void;

const PUBLIC_SETTING_KEYS = [
  'NORMAL_REQUEST_DEADLINE_DAYS',
  'SPECIAL_REQUEST_DEADLINE_DAYS',
  'SPECIAL_DURATION_THRESHOLD_DAYS',
  'MODIFICATION_DEADLINE_DAYS',
  'DEROGATION_LAST_ALLOWED_DAY',
  'SUMMER_PERIOD_START',
  'SUMMER_PERIOD_END',
  'MONTHLY_ACCRUAL_RATE',
  'REFERENCE_PERIOD_START',
] as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly afternoonStartHourChangeListeners: AfternoonStartHourChangeListener[] =
    [];

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  onAfternoonStartHourChange(
    listener: AfternoonStartHourChangeListener,
  ): void {
    if (!this.afternoonStartHourChangeListeners.includes(listener)) {
      this.afternoonStartHourChangeListeners.push(listener);
    }
  }

  removeAfternoonStartHourChangeListener(
    listener: AfternoonStartHourChangeListener,
  ): void {
    const index = this.afternoonStartHourChangeListeners.indexOf(listener);
    if (index >= 0) {
      this.afternoonStartHourChangeListeners.splice(index, 1);
    }
  }

  private notifyAfternoonStartHourChanged(): void {
    for (const listener of [...this.afternoonStartHourChangeListeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.error(
          'Un écouteur de changement de AFTERNOON_START_HOUR a échoué.',
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  async findAll(): Promise<Setting[]> {
    return this.settingRepository.find({
      relations: { updatedBy: true },
      order: { settingKey: 'ASC' },
    });
  }

  async findPublic(): Promise<Setting[]> {
    const settings = await this.settingRepository
      .createQueryBuilder('setting')
      .where('setting.settingKey IN (:...keys)', {
        keys: PUBLIC_SETTING_KEYS,
      })
      .orderBy('setting.settingKey', 'ASC')
      .getMany();

    return settings;
  }

  async findOne(key: string): Promise<Setting> {
    const normalizedKey = this.normalizeKey(key);
    const setting = await this.settingRepository.findOne({
      where: { settingKey: normalizedKey },
      relations: { updatedBy: true },
    });

    if (!setting) {
      throw new NotFoundException(
        `Le paramètre « ${normalizedKey} » est introuvable.`,
      );
    }

    return setting;
  }

  async getValue(key: string): Promise<string | null> {
    const setting = await this.settingRepository.findOneBy({
      settingKey: this.normalizeKey(key),
    });

    return setting?.settingValue ?? null;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const value = await this.getValue(key);
    const normalized = value?.trim();
    return normalized ? normalized : fallback;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.getValue(key);

    if (value === null) {
      return fallback;
    }

    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getInteger(key: string, fallback: number): Promise<number> {
    const value = await this.getNumber(key, fallback);
    return Number.isInteger(value) ? value : fallback;
  }

  async getSubmissionRules(): Promise<SubmissionRules> {
    const [
      normalDeadlineDays,
      specialDeadlineDays,
      specialDurationThresholdDays,
      derogationLastAllowedDay,
      summerPeriodStart,
      summerPeriodEnd,
    ] = await Promise.all([
      this.getInteger('NORMAL_REQUEST_DEADLINE_DAYS', 30),
      this.getInteger('SPECIAL_REQUEST_DEADLINE_DAYS', 60),
      this.getInteger('SPECIAL_DURATION_THRESHOLD_DAYS', 21),
      this.getInteger('DEROGATION_LAST_ALLOWED_DAY', 3),
      this.getString('SUMMER_PERIOD_START', '05-01'),
      this.getString('SUMMER_PERIOD_END', '10-31'),
    ]);

    if (
      normalDeadlineDays < 1 ||
      specialDeadlineDays < normalDeadlineDays ||
      specialDurationThresholdDays < 1 ||
      derogationLastAllowedDay < 3
    ) {
      throw new BadRequestException(
        'Les paramètres de délai de dépôt sont incohérents.',
      );
    }

    this.validateMonthDay(summerPeriodStart, 'SUMMER_PERIOD_START');
    this.validateMonthDay(summerPeriodEnd, 'SUMMER_PERIOD_END');

    return {
      normalDeadlineDays,
      specialDeadlineDays,
      specialDurationThresholdDays,
      derogationLastAllowedDay,
      summerPeriodStart,
      summerPeriodEnd,
    };
  }

  async getModificationDeadlineDays(): Promise<number> {
    const days = await this.getInteger('MODIFICATION_DEADLINE_DAYS', 7);

    if (days < 0 || days > 90) {
      throw new BadRequestException(
        'Le paramètre MODIFICATION_DEADLINE_DAYS doit être compris entre 0 et 90.',
      );
    }

    return days;
  }

  async upsertInternal(
    key: string,
    value: string,
    description: string | null,
    updatedById: number | null,
    manager?: EntityManager,
  ): Promise<Setting> {
    const repository = manager
      ? manager.getRepository(Setting)
      : this.settingRepository;
    const normalizedKey = this.normalizeKey(key);
    let setting = await repository.findOneBy({ settingKey: normalizedKey });

    if (!setting) {
      setting = repository.create({
        settingKey: normalizedKey,
        settingValue: value,
        description,
        updatedById,
        updatedBy: null,
      });
    } else {
      setting.settingValue = value;
      setting.description = description;
      setting.updatedById = updatedById;
    }

    return repository.save(setting);
  }

  async update(
    key: string,
    dto: UpdateSettingDto,
    authenticatedUser: AuthenticatedUser,
  ): Promise<Setting> {
    const setting = await this.findOne(key);
    const value = dto.settingValue.trim();

    this.validateKnownSettingValue(setting.settingKey, value);

    setting.settingValue = value;
    setting.updatedById = authenticatedUser.id;
    setting.updatedBy = { id: authenticatedUser.id } as User;

    if (dto.description !== undefined) {
      setting.description = dto.description.trim() || null;
    }

    await this.settingRepository.save(setting);

    if (setting.settingKey === 'AFTERNOON_START_HOUR') {
      this.notifyAfternoonStartHourChanged();
    }

    return this.findOne(setting.settingKey);
  }

  async updateSeasonalPeriod(
    start: string,
    end: string,
    authenticatedUser: AuthenticatedUser,
  ): Promise<{ summerPeriodStart: Setting; summerPeriodEnd: Setting }> {
    this.validateMonthDay(start, 'SUMMER_PERIOD_START');
    this.validateMonthDay(end, 'SUMMER_PERIOD_END');

    const startSetting = await this.findOne('SUMMER_PERIOD_START');
    const endSetting = await this.findOne('SUMMER_PERIOD_END');

    startSetting.settingValue = start;
    startSetting.updatedById = authenticatedUser.id;
    endSetting.settingValue = end;
    endSetting.updatedById = authenticatedUser.id;

    await this.settingRepository.save([startSetting, endSetting]);

    return {
      summerPeriodStart: await this.findOne('SUMMER_PERIOD_START'),
      summerPeriodEnd: await this.findOne('SUMMER_PERIOD_END'),
    };
  }

  private normalizeKey(key: string): string {
    return key.trim().toUpperCase();
  }

  private validateKnownSettingValue(key: string, value: string): void {
    const integerKeys = new Set([
      'NORMAL_REQUEST_DEADLINE_DAYS',
      'SPECIAL_REQUEST_DEADLINE_DAYS',
      'SPECIAL_DURATION_THRESHOLD_DAYS',
      'MODIFICATION_DEADLINE_DAYS',
      'DEROGATION_LAST_ALLOWED_DAY',
    ]);

    if (integerKeys.has(key)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        throw new BadRequestException(
          `La valeur du paramètre ${key} doit être un entier compris entre 0 et 365.`,
        );
      }
    }

    if (key === 'MONTHLY_ACCRUAL_RATE') {
      const parsed = Number(value.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 31) {
        throw new BadRequestException(
          'MONTHLY_ACCRUAL_RATE doit être un nombre strictement positif inférieur ou égal à 31.',
        );
      }
    }

    if (
      key === 'SUMMER_PERIOD_START' ||
      key === 'SUMMER_PERIOD_END' ||
      key === 'REFERENCE_PERIOD_START'
    ) {
      this.validateMonthDay(value, key);
    }

    if (key === 'AFTERNOON_START_HOUR') {
      this.validateHourMinute(value, key);
    }
  }

  private validateHourMinute(value: string, key: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException(
        `Le paramètre ${key} doit être une heure au format HH:MM (exemples valides : 00:00, 08:30, 12:00, 23:59).`,
      );
    }
  }

  private validateMonthDay(value: string, key: string): void {
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
      throw new BadRequestException(
        `${key} doit respecter le format MM-JJ.`,
      );
    }

    const [month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(2024, month - 1, day));

    if (
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${key} contient une date invalide.`);
    }
  }
}
