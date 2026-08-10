import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Setting } from './setting.entity';
import { SettingsService } from './settings.service';

function baseSetting(key: string, value: string) {
  return {
    settingKey: key,
    settingValue: value,
    description: null,
    updatedById: null,
    updatedBy: null,
  };
}

describe('SettingsService — notification de changement de AFTERNOON_START_HOUR', () => {
  let service: SettingsService;
  let settingRepository: {
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    settingRepository = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(async (setting: Setting) => setting),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: getRepositoryToken(Setting),
          useValue: settingRepository,
        },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('notifie les écouteurs APRÈS la sauvegarde réussie de AFTERNOON_START_HOUR', async () => {
    const setting = baseSetting('AFTERNOON_START_HOUR', '12:00');
    settingRepository.findOne.mockResolvedValue(setting);
    const listener = jest.fn();
    service.onAfternoonStartHourChange(listener);

    await service.update(
      'AFTERNOON_START_HOUR',
      { settingValue: '11:00' } as never,
      { id: 1 } as never,
    );

    expect(settingRepository.save).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ne notifie PAS si la sauvegarde échoue', async () => {
    const setting = baseSetting('AFTERNOON_START_HOUR', '12:00');
    settingRepository.findOne.mockResolvedValue(setting);
    settingRepository.save.mockRejectedValue(new Error('échec base simulé'));
    const listener = jest.fn();
    service.onAfternoonStartHourChange(listener);

    await expect(
      service.update(
        'AFTERNOON_START_HOUR',
        { settingValue: '11:00' } as never,
        { id: 1 } as never,
      ),
    ).rejects.toThrow('échec base simulé');

    expect(listener).not.toHaveBeenCalled();
  });

  it('ne notifie PAS en cas de valeur invalide (400 avant toute sauvegarde)', async () => {
    const setting = baseSetting('AFTERNOON_START_HOUR', '12:00');
    settingRepository.findOne.mockResolvedValue(setting);
    const listener = jest.fn();
    service.onAfternoonStartHourChange(listener);

    await expect(
      service.update(
        'AFTERNOON_START_HOUR',
        { settingValue: '25:00' } as never,
        { id: 1 } as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(settingRepository.save).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('C — modifier un AUTRE paramètre ne déclenche pas la replanification', async () => {
    const setting = baseSetting('NORMAL_REQUEST_DEADLINE_DAYS', '30');
    settingRepository.findOne.mockResolvedValue(setting);
    const listener = jest.fn();
    service.onAfternoonStartHourChange(listener);

    await service.update(
      'NORMAL_REQUEST_DEADLINE_DAYS',
      { settingValue: '31' } as never,
      { id: 1 } as never,
    );

    expect(settingRepository.save).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('un écouteur désabonné n’est plus notifié', async () => {
    const setting = baseSetting('AFTERNOON_START_HOUR', '12:00');
    settingRepository.findOne.mockResolvedValue(setting);
    const listener = jest.fn();
    service.onAfternoonStartHourChange(listener);
    service.removeAfternoonStartHourChangeListener(listener);

    await service.update(
      'AFTERNOON_START_HOUR',
      { settingValue: '11:00' } as never,
      { id: 1 } as never,
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('l’échec d’un écouteur ne casse pas la mise à jour ni les autres écouteurs', async () => {
    const setting = baseSetting('AFTERNOON_START_HOUR', '12:00');
    settingRepository.findOne.mockResolvedValue(setting);
    const failing = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const healthy = jest.fn();
    service.onAfternoonStartHourChange(failing);
    service.onAfternoonStartHourChange(healthy);

    const result = await service.update(
      'AFTERNOON_START_HOUR',
      { settingValue: '11:00' } as never,
      { id: 1 } as never,
    );

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(result.settingValue).toBe('11:00');
  });
});
