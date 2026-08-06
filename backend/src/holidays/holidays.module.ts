import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';

import { Holiday } from './holiday.entity';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';

@Module({
  imports: [TypeOrmModule.forFeature([Holiday]), AuditModule],
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService, TypeOrmModule],
})
export class HolidaysModule {}
