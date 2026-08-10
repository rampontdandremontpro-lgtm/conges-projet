import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { Document } from '../documents/document.entity';
import { DerogationsModule } from '../derogations/derogations.module';
import { DocumentsModule } from '../documents/documents.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { LeaveBalancesModule } from '../leave-balances/leave-balances.module';
import { LeaveTypesModule } from '../leave-types/leave-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { ValidatorsModule } from '../validators/validators.module';
import { LeaveRequest } from './leave-request.entity';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';
import { ServiceAvailabilityService } from './service-availability.service';
import { LeaveRequestSchedulerService } from './leave-request-scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveRequest,
      AbsenceDeclaration,
      Document,
    ]),
    AuditModule,
    UsersModule,
    DerogationsModule,
    DocumentsModule,
    LeaveTypesModule,
    HolidaysModule,
    LeaveBalancesModule,
    NotificationsModule,
    SettingsModule,
    ValidatorsModule,
  ],
  controllers: [LeaveRequestsController],
  providers: [
    LeaveRequestsService,
    ServiceAvailabilityService,
    LeaveRequestSchedulerService,
  ],
  exports: [LeaveRequestsService, TypeOrmModule],
})
export class LeaveRequestsModule {}
