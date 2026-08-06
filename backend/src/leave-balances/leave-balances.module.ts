import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { BalanceMovement } from './balance-movement.entity';
import { LeaveBalance } from './leave-balance.entity';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { MonthlyAccrualService } from './monthly-accrual.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveBalance,
      BalanceMovement,
    ]),
    UsersModule,
    SettingsModule,
  ],
  controllers: [LeaveBalancesController],
  providers: [LeaveBalancesService, MonthlyAccrualService],
  exports: [
    LeaveBalancesService,
    MonthlyAccrualService,
    TypeOrmModule,
  ],
})
export class LeaveBalancesModule {}
