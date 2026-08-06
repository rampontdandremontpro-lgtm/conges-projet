import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from '../audit/audit-log.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { Derogation } from './derogation.entity';
import { DerogationsController } from './derogations.controller';
import { DerogationsService } from './derogations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Derogation,
      LeaveRequest,
      AuditLog,
    ]),
  ],
  controllers: [DerogationsController],
  providers: [DerogationsService],
  exports: [DerogationsService, TypeOrmModule],
})
export class DerogationsModule {}
