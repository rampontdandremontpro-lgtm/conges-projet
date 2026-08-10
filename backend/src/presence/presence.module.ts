import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AbsenceDeclaration,
} from '../absence-declarations/absence-declaration.entity';
import {
  LeaveRequest,
} from '../leave-requests/leave-request.entity';
import { SettingsModule } from '../settings/settings.module';
import { User } from '../users/user.entity';
import { PresenceService } from './presence.service';

@Global()
@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([
      User,
      LeaveRequest,
      AbsenceDeclaration,
    ]),
  ],
  providers: [PresenceService],
  exports: [PresenceService, TypeOrmModule],
})
export class PresenceModule {}
