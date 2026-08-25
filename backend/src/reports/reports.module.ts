import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditModule, HolidaysModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
