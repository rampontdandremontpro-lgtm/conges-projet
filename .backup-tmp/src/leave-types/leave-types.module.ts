import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaveType } from './leave-type.entity';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([LeaveType])],
  controllers: [LeaveTypesController],
  providers: [LeaveTypesService],
  exports: [LeaveTypesService, TypeOrmModule],
})
export class LeaveTypesModule {}
