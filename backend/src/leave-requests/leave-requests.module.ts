import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaveTypesModule } from '../leave-types/leave-types.module';
import { UsersModule } from '../users/users.module';
import { LeaveRequest } from './leave-request.entity';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveRequest]),
    UsersModule,
    LeaveTypesModule,
  ],
  controllers: [LeaveRequestsController],
  providers: [LeaveRequestsService],
  exports: [LeaveRequestsService, TypeOrmModule],
})
export class LeaveRequestsModule {}
