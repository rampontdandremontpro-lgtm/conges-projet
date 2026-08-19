import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { Derogation } from './derogation.entity';
import { DerogationsController } from './derogations.controller';
import { DerogationsService } from './derogations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Derogation,
      LeaveRequest,
    ]),
    AuditModule,
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [DerogationsController],
  providers: [DerogationsService],
  exports: [DerogationsService, TypeOrmModule],
})
export class DerogationsModule {}
