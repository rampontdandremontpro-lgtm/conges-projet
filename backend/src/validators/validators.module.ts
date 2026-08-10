import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { Service } from '../services/service.entity';
import { User } from '../users/user.entity';
import { ServiceBackupValidator } from './service-backup-validator.entity';
import { ValidatorReplacement } from './validator-replacement.entity';
import { ValidatorResolutionService } from './validator-resolution.service';
import { ValidatorsController } from './validators.controller';
import { ValidatorsService } from './validators.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceBackupValidator,
      ValidatorReplacement,
      Service,
      User,
    ]),
    AuditModule,
  ],
  controllers: [ValidatorsController],
  providers: [ValidatorsService, ValidatorResolutionService],
  exports: [ValidatorsService, ValidatorResolutionService, TypeOrmModule],
})
export class ValidatorsModule {}
