import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { BalanceReminderService } from './balance-reminder.service';
import { BalanceMovement } from './balance-movement.entity';
import { LeaveBalance } from './leave-balance.entity';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { MonthlyAccrualService } from './monthly-accrual.service';
import { ReferencePeriodService } from './reference-period.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveBalance,
      BalanceMovement,
      User,
    ]),
    UsersModule,
    SettingsModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [LeaveBalancesController],
  providers: [
    LeaveBalancesService,
    MonthlyAccrualService,
    ReferencePeriodService,
    BalanceReminderService,
  ],
  exports: [
    LeaveBalancesService,
    MonthlyAccrualService,
    ReferencePeriodService,
    BalanceReminderService,
    TypeOrmModule,
  ],
})
export class LeaveBalancesModule {}
