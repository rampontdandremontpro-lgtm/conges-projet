import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { Setting } from './setting.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([Setting]), AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService, TypeOrmModule],
})
export class SettingsModule {}
