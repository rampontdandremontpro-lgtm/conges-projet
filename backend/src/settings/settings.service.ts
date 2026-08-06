import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Setting } from './setting.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  async getValue(key: string): Promise<string | null> {
    const setting = await this.settingRepository.findOneBy({
      settingKey: key,
    });

    return setting?.settingValue ?? null;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.getValue(key);

    if (value === null) {
      return fallback;
    }

    const parsed = Number(value.replace(',', '.'));

    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
