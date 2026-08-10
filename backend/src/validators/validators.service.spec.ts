import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import {
  Service,
  ServiceType,
  ValidationMode,
} from '../services/service.entity';
import {
  EmploymentType,
  User,
  UserRole,
} from '../users/user.entity';
import { ServiceBackupValidator } from './service-backup-validator.entity';
import { ValidatorReplacement } from './validator-replacement.entity';
import { ValidatorsService } from './validators.service';

function actor(role: UserRole = UserRole.RH): User {
  return {
    id: 90,
    nom: 'Acteur',
    prenom: 'RH',
    email: 'rh@example.com',
    role,
    employmentType: EmploymentType.INTERNE,
    serviceId: null,
    isActive: true,
  } as User;
}

function serviceEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: 'Service A',
    serviceType: ServiceType.INTERNE,
    primaryManagerId: 2,
    validationMode: ValidationMode.RESPONSABLE_PUIS_RELAIS,
    takeoverDelayDays: 7,
    isActive: true,
    ...overrides,
  } as Service;
}

function validatorUser(
  id: number,
  role: UserRole,
  overrides: Record<string, unknown> = {},
): User {
  return {
    id,
    nom: 'Nom',
    prenom: 'Prenom',
    email: `user${id}@example.com`,
    role,
    employmentType: EmploymentType.INTERNE,
    serviceId: id === 2 ? 10 : 20,
    isActive: true,
    ...overrides,
  } as User;
}

describe('ValidatorsService', () => {
  let service: ValidatorsService;
  let backupRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let replacementRepository: {
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let serviceRepository: { findOneBy: jest.Mock };
  let userRepository: { findOneBy: jest.Mock };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    backupRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input) => input),
      save: jest.fn((input) => Promise.resolve({ id: 1, ...input })),
    };
    replacementRepository = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input) => input),
      save: jest.fn((input) => Promise.resolve({ id: 1, ...input })),
    };
    serviceRepository = { findOneBy: jest.fn() };
    userRepository = { findOneBy: jest.fn() };
    auditService = { record: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidatorsService,
        {
          provide: getRepositoryToken(ServiceBackupValidator),
          useValue: backupRepository,
        },
        {
          provide: getRepositoryToken(ValidatorReplacement),
          useValue: replacementRepository,
        },
        { provide: getRepositoryToken(Service), useValue: serviceRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ValidatorsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('assignBackupValidator — valideurs de secours', () => {
    it('service introuvable → 404', async () => {
      serviceRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(NotFoundException);
    });

    it('service sans circuit Responsable puis relais → 400', async () => {
      serviceRepository.findOneBy.mockResolvedValue(
        serviceEntity({
          validationMode: ValidationMode.DIRECTEUR_ET_RH,
        }),
      );

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('le Responsable principal ne peut pas être son propre secours → 400', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());

      await expect(
        service.assignBackupValidator(10, 2, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('utilisateur inactif → 400', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE, { isActive: false }),
      );

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('COLLABORATEUR interdit → 400', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.COLLABORATEUR),
      );

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('ADMIN interdit → 400', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.ADMIN),
      );

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rôles autorisés RESPONSABLE_SERVICE / RH / DIRECTEUR', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      backupRepository.findOne.mockResolvedValue(null);

      for (const role of [
        UserRole.RESPONSABLE_SERVICE,
        UserRole.RH,
        UserRole.DIRECTEUR,
      ]) {
        userRepository.findOneBy.mockResolvedValue(
          validatorUser(4, role),
        );
        const saved = await service.assignBackupValidator(10, 4, actor());
        expect(saved.serviceId).toBe(10);
        expect(saved.validatorId).toBe(4);
        expect(saved.isActive).toBe(true);
      }
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SERVICE_BACKUP_VALIDATOR_ASSIGNED,
          resourceType: 'SERVICES',
          resourceId: 10,
        }),
      );
    });

    it('doublon actif → 409', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE),
      );
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: true,
      });

      await expect(
        service.assignBackupValidator(10, 4, actor()),
      ).rejects.toThrow(ConflictException);
    });

    it('association désactivée → réactivée au lieu d’un doublon', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE),
      );
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      backupRepository.save.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: true,
      });

      const saved = await service.assignBackupValidator(10, 4, actor());

      expect(saved.isActive).toBe(true);
      expect(backupRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SERVICE_BACKUP_VALIDATOR_ENABLED,
        }),
      );
    });

    it('plusieurs secours peuvent coexister', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE),
      );
      backupRepository.findOne.mockResolvedValue(null);

      await service.assignBackupValidator(10, 4, actor());
      await service.assignBackupValidator(10, 5, actor());

      expect(backupRepository.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('disableBackupValidator / enableBackupValidator', () => {
    it('disable : association introuvable → 404', async () => {
      backupRepository.findOne.mockResolvedValue(null);

      await expect(
        service.disableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(NotFoundException);
    });

    it('disable : désactive logiquement et trace', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: true,
      });
      backupRepository.save.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });

      const saved = await service.disableBackupValidator(10, 4, actor());

      expect(saved.isActive).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SERVICE_BACKUP_VALIDATOR_DISABLED,
        }),
      );
    });

    it('disable : idempotent si déjà désactivé', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });

      await service.disableBackupValidator(10, 4, actor());

      expect(backupRepository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('enable : réactive et trace', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      backupRepository.save.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: true,
      });
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE),
      );

      const saved = await service.enableBackupValidator(10, 4, actor());

      expect(saved.isActive).toBe(true);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SERVICE_BACKUP_VALIDATOR_ENABLED,
        }),
      );
    });

    it('enable : service introuvable → 400', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      serviceRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.enableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
      expect(backupRepository.save).not.toHaveBeenCalled();
    });

    it('enable : validationMode n’est plus RESPONSABLE_PUIS_RELAIS → 400', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      serviceRepository.findOneBy.mockResolvedValue(
        serviceEntity({
          validationMode: ValidationMode.DIRECTEUR_ET_RH,
        }),
      );

      await expect(
        service.enableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
      expect(backupRepository.save).not.toHaveBeenCalled();
    });

    it('enable : utilisateur devenu inactif → 400', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.RESPONSABLE_SERVICE, {
          isActive: false,
        }),
      );

      await expect(
        service.enableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
      expect(backupRepository.save).not.toHaveBeenCalled();
    });

    it('enable : rôle devenu COLLABORATEUR → 400', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(4, UserRole.COLLABORATEUR),
      );

      await expect(
        service.enableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
      expect(backupRepository.save).not.toHaveBeenCalled();
    });

    it('enable : utilisateur devenu Responsable principal → 400', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: false,
      });
      serviceRepository.findOneBy.mockResolvedValue(
        serviceEntity({ primaryManagerId: 4 }),
      );

      await expect(
        service.enableBackupValidator(10, 4, actor()),
      ).rejects.toThrow(BadRequestException);
      expect(backupRepository.save).not.toHaveBeenCalled();
    });

    it('enable : idempotent si déjà actif', async () => {
      backupRepository.findOne.mockResolvedValue({
        id: 1,
        serviceId: 10,
        validatorId: 4,
        isActive: true,
      });

      await service.enableBackupValidator(10, 4, actor());

      expect(backupRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getServiceValidators', () => {
    it('renvoie le Responsable principal et les secours actifs/inactifs', async () => {
      serviceRepository.findOneBy.mockResolvedValue(serviceEntity());
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(2, UserRole.RESPONSABLE_SERVICE),
      );
      backupRepository.find.mockResolvedValue([
        {
          id: 1,
          serviceId: 10,
          validatorId: 4,
          isActive: true,
          validator: validatorUser(4, UserRole.RESPONSABLE_SERVICE),
        },
        {
          id: 2,
          serviceId: 10,
          validatorId: 5,
          isActive: false,
          validator: validatorUser(5, UserRole.RH),
        },
      ]);

      const result = await service.getServiceValidators(10);

      expect(result.primaryManagerId).toBe(2);
      expect(result.backupValidators).toHaveLength(2);
      expect(result.backupValidators[0].isActive).toBe(true);
      expect(result.backupValidators[1].isActive).toBe(false);
    });

    it('service introuvable → 404', async () => {
      serviceRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getServiceValidators(10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createReplacement — remplacements temporaires', () => {
    const validDto = {
      employeeId: 1,
      replacementValidatorId: 3,
      startDate: '2026-08-10',
      endDate: '2026-08-25',
      reason: 'Absence du Responsable',
    };

    it('collaborateur introuvable ou inactif → 400', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('salarié RH comme employee → 400', async () => {
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(1, UserRole.RH),
      );

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('collaborateur externe → 400', async () => {
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(1, UserRole.COLLABORATEUR, {
          employmentType: EmploymentType.EXTERNE,
        }),
      );

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('remplaçant inactif → 400', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(validatorUser(1, UserRole.COLLABORATEUR))
        .mockResolvedValueOnce(
          validatorUser(3, UserRole.RESPONSABLE_SERVICE, {
            isActive: false,
          }),
        );

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('remplaçant COLLABORATEUR → 400', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(validatorUser(1, UserRole.COLLABORATEUR))
        .mockResolvedValueOnce(validatorUser(3, UserRole.COLLABORATEUR));

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('remplaçant ADMIN → 400', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(validatorUser(1, UserRole.COLLABORATEUR))
        .mockResolvedValueOnce(validatorUser(3, UserRole.ADMIN));

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('employee = remplaçant → 400', async () => {
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(1, UserRole.COLLABORATEUR),
      );

      await expect(
        service.createReplacement(
          { ...validDto, replacementValidatorId: 1 },
          actor(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('start > end → 400', async () => {
      userRepository.findOneBy.mockResolvedValue(
        validatorUser(1, UserRole.COLLABORATEUR),
      );

      await expect(
        service.createReplacement(
          { ...validDto, startDate: '2026-08-26', endDate: '2026-08-10' },
          actor(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('chevauchement d’un remplacement actif → 400', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(validatorUser(1, UserRole.COLLABORATEUR))
        .mockResolvedValueOnce(
          validatorUser(3, UserRole.RESPONSABLE_SERVICE),
        );
      replacementRepository.findOne.mockResolvedValue({
        id: 5,
        employeeId: 1,
        isActive: true,
      });

      await expect(
        service.createReplacement(validDto, actor()),
      ).rejects.toThrow(BadRequestException);
    });

    it('création valide : dates inclusives, audit VALIDATOR_REPLACEMENT_CREATED', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(validatorUser(1, UserRole.COLLABORATEUR))
        .mockResolvedValueOnce(
          validatorUser(3, UserRole.RESPONSABLE_SERVICE),
        );
      replacementRepository.findOne.mockResolvedValue(null);

      const saved = await service.createReplacement(validDto, actor());

      expect(saved.employeeId).toBe(1);
      expect(saved.replacementValidatorId).toBe(3);
      expect(saved.isActive).toBe(true);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.VALIDATOR_REPLACEMENT_CREATED,
          resourceType: 'VALIDATOR_REPLACEMENTS',
          resourceId: 1,
        }),
      );
    });
  });

  describe('disableReplacement / listReplacements / findReplacement', () => {
    it('disable : remplacement introuvable → 404', async () => {
      replacementRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.disableReplacement(5, actor()),
      ).rejects.toThrow(NotFoundException);
    });

    it('disable : désactivation logique et audit', async () => {
      replacementRepository.findOneBy.mockResolvedValue({
        id: 5,
        employeeId: 1,
        replacementValidatorId: 3,
        isActive: true,
      });
      replacementRepository.save.mockResolvedValue({
        id: 5,
        employeeId: 1,
        replacementValidatorId: 3,
        isActive: false,
      });

      const saved = await service.disableReplacement(5, actor());

      expect(saved.isActive).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.VALIDATOR_REPLACEMENT_DISABLED,
          resourceType: 'VALIDATOR_REPLACEMENTS',
          resourceId: 5,
        }),
      );
    });

    it('disable : idempotent si déjà désactivé', async () => {
      replacementRepository.findOneBy.mockResolvedValue({
        id: 5,
        employeeId: 1,
        replacementValidatorId: 3,
        isActive: false,
      });

      await service.disableReplacement(5, actor());

      expect(replacementRepository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('list : filtre par collaborateur, statut et date active', async () => {
      await service.listReplacements({
        employeeId: 1,
        isActive: true,
        activeAt: '2026-08-15',
      });

      expect(replacementRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 1,
            isActive: true,
          }),
          order: expect.objectContaining({ startDate: 'DESC' }),
        }),
      );
    });

    it('findReplacement : introuvable → 404', async () => {
      replacementRepository.findOne.mockResolvedValue(null);

      await expect(service.findReplacement(5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
