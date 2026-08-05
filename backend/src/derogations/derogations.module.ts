import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaveRequestHistory } from '../leave-requests/leave-request-history.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { Derogation } from './derogation.entity';
import { DerogationsController } from './derogations.controller';
import { DerogationsService } from './derogations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Derogation,
      LeaveRequest,
      LeaveRequestHistory,
    ]),
  ],
  controllers: [DerogationsController],
  providers: [DerogationsService],
  exports: [DerogationsService, TypeOrmModule],
})
export class DerogationsModule {}
