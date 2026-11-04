import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from '../../audit/audit-log.entity';
import { AuditModule } from '../../audit/audit.module';
import { Document } from '../../documents/document.entity';
import { HolidaysModule } from '../../holidays/holidays.module';
import { SettingsModule } from '../../settings/settings.module';
import { User } from '../../users/user.entity';
import { LeaveType } from '../../leave-types/leave-type.entity';
import { LeaveRequest } from '../../leave-requests/leave-request.entity';
import { BalanceMovement } from '../balance-movement.entity';
import { LeaveBalance } from '../leave-balance.entity';
import { CarryoverLot } from '../carryover-lot.entity';
import { CarryoverLotAllocation } from './carryover-lot-allocation.entity';
import { CarryoverLotAllocationController } from './carryover-lot-allocation.controller';
import { CarryoverLotAllocationService } from './carryover-lot-allocation.service';
import { CarryoverLotLedgerService } from './carryover-lot-ledger.service';
import { CarryoverLotClosureController } from './carryover-lot-closure.controller';
import { CarryoverLotClosureService } from './carryover-lot-closure.service';
import { CarryoverLotsController } from './carryover-lots.controller';
import { CarryoverLotsService } from './carryover-lots.service';
import {
  CarryoverNotification,
} from '../carryover-notification/carryover-notification.entity';
import {
  CarryoverReceptionProof,
} from '../carryover-notification/carryover-reception-proof.entity';
import { CarryoverNotificationController } from '../carryover-notification/carryover-notification.controller';
import { CarryoverNotificationService } from '../carryover-notification/carryover-notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CarryoverLot,
      CarryoverLotAllocation,
      User,
      Document,
      AuditLog,
      BalanceMovement,
      LeaveBalance,
      LeaveRequest,
      LeaveType,
      CarryoverNotification,
      CarryoverReceptionProof,
    ]),
    SettingsModule,
    AuditModule,
    HolidaysModule,
  ],
  controllers: [
    CarryoverLotsController,
    CarryoverLotAllocationController,
    CarryoverLotClosureController,
    CarryoverNotificationController,
  ],
  providers: [
    CarryoverLotsService,
    CarryoverLotAllocationService,
    CarryoverLotLedgerService,
    CarryoverLotClosureService,
    CarryoverNotificationService,
  ],
  exports: [
    CarryoverLotsService,
    CarryoverLotAllocationService,
    CarryoverLotLedgerService,
    CarryoverLotClosureService,
    CarryoverNotificationService,
  ],
})
export class CarryoverLotsModule {}
