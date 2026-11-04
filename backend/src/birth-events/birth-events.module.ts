import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BirthEvent } from './birth-event.entity';
import { BirthEventsController } from './birth-events.controller';
import { BirthEventsService } from './birth-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([BirthEvent])],
  controllers: [BirthEventsController],
  providers: [BirthEventsService],
  exports: [BirthEventsService, TypeOrmModule],
})
export class BirthEventsModule {}
