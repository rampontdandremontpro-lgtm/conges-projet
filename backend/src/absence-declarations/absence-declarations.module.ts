import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Document } from '../documents/document.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
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
  ],
  controllers: [AbsenceDeclarationsController],
  providers: [AbsenceDeclarationsService],
  exports: [AbsenceDeclarationsService, TypeOrmModule],
})
export class AbsenceDeclarationsModule {}
