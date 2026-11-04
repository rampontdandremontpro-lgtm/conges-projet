import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { BirthEventsModule } from '../birth-events/birth-events.module';
import { Document } from '../documents/document.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { ArreteChevauchementModule } from '../leave-balances/arrete-chevauchement.module';
import { LeaveBalancesModule } from '../leave-balances/leave-balances.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { LeaveTypesModule } from '../leave-types/leave-types.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AbsenceDeclaration } from './absence-declaration.entity';
import { AbsenceDeclarationsController } from './absence-declarations.controller';
import { AbsenceDeclarationsService } from './absence-declarations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AbsenceDeclaration,
      Document,
      LeaveRequest,
    ]),
    UsersModule,
    LeaveTypesModule,
    NotificationsModule,
    ArreteChevauchementModule,
    forwardRef(() => LeaveBalancesModule),
    HolidaysModule,
    BirthEventsModule,
    AuditModule,
  ],
  controllers: [AbsenceDeclarationsController],
  providers: [AbsenceDeclarationsService],
  exports: [AbsenceDeclarationsService, TypeOrmModule],
})
export class AbsenceDeclarationsModule {}
