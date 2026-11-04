import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { LeaveBalancesModule } from '../leave-balances/leave-balances.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IllnessMaintenanceDecision } from './illness-maintenance-decision.entity';
import { IllnessMaintenanceController } from './illness-maintenance.controller';
import { IllnessMaintenanceService } from './illness-maintenance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IllnessMaintenanceDecision]),
    AuditModule,
    NotificationsModule,
    LeaveBalancesModule,
    DocumentsModule,
  ],
  controllers: [IllnessMaintenanceController],
  providers: [IllnessMaintenanceService],
  exports: [IllnessMaintenanceService, TypeOrmModule],
})
export class IllnessMaintenanceModule {}
