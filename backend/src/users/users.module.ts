import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HolidaysModule } from '../holidays/holidays.module';
import { LegalEntitiesModule } from '../legal-entities/legal-entities.module';
import { ServicesModule } from '../services/services.module';
import { SettingsModule } from '../settings/settings.module';
import { ValidatorsModule } from '../validators/validators.module';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    ServicesModule,
    HolidaysModule,
    SettingsModule,
    ValidatorsModule,
    LegalEntitiesModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}