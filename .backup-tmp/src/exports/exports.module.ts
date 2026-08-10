import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [AuditModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
