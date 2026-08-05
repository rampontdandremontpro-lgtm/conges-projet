import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DerogationsModule } from '../derogations/derogations.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { LeaveBalancesModule } from '../leave-balances/leave-balances.module';
import { LeaveTypesModule } from '../leave-types/leave-types.module';
import { UsersModule } from '../users/users.module';
import { LeaveRequestHistory } from './leave-request-history.entity';
import { LeaveRequest } from './leave-request.entity';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveRequest,
      LeaveRequestHistory,
    ]),
    UsersModule,
    DerogationsModule,
    LeaveTypesModule,
    HolidaysModule,
    LeaveBalancesModule,
  ],
  controllers: [LeaveRequestsController],
  providers: [LeaveRequestsService],
  exports: [LeaveRequestsService, TypeOrmModule],
})
export class LeaveRequestsModule {}
