import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { Setting } from '../settings/setting.entity';
import { User } from '../users/user.entity';
import { ValidatorsModule } from '../validators/validators.module';
import { Notification } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User, Setting, LeaveRequest]),
    ValidatorsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, TypeOrmModule],
})
export class NotificationsModule {}
