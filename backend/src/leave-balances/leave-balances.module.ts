import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { CarryoverLotsModule } from './carryover-lots/carryover-lots.module';
import { ArreteChevauchementModule } from './arrete-chevauchement.module';
import { ArreteChevauchementService } from './arrete-chevauchement.service';
import { User } from '../users/user.entity';
import { BalanceReminderService } from './balance-reminder.service';
import { BalanceMovement } from './balance-movement.entity';
import { LeaveBalance } from './leave-balance.entity';
import { TakePeriodReport } from './take-period-report.entity';
import { AccrualAnomaly } from './accrual-anomaly.entity';
import { AccrualAnomalyService } from './accrual-anomaly.service';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { MonthlyAccrualService } from './monthly-accrual.service';
import { ReferencePeriodService } from './reference-period.service';
import { SeniorityExtraDaysService } from './seniority-extra-days.service';
import { FractionnementService } from './fractionnement.service';
import { TakePeriodService } from './take-period.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveBalance,
      BalanceMovement,
      User,
      TakePeriodReport,
      AccrualAnomaly,
    ]),
    UsersModule,
    SettingsModule,
    AuditModule,
    forwardRef(() => DocumentsModule),
    NotificationsModule,
    HolidaysModule,
    CarryoverLotsModule,
    ArreteChevauchementModule,
  ],
  controllers: [LeaveBalancesController],
  providers: [
    LeaveBalancesService,
    MonthlyAccrualService,
    ReferencePeriodService,
    BalanceReminderService,
    SeniorityExtraDaysService,
    FractionnementService,
    TakePeriodService,
    ArreteChevauchementService,
    AccrualAnomalyService,
  ],
  exports: [
    LeaveBalancesService,
    MonthlyAccrualService,
    AccrualAnomalyService,
    ReferencePeriodService,
    BalanceReminderService,
    SeniorityExtraDaysService,
    FractionnementService,
    TakePeriodService,
    TypeOrmModule,
  ],
})
export class LeaveBalancesModule {}
