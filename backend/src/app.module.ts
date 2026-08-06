import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclarationsModule } from './absence-declarations/absence-declarations.module';
import { AuditModule } from './audit/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DerogationsModule } from './derogations/derogations.module';
import { DocumentsModule } from './documents/documents.module';
import { HolidaysModule } from './holidays/holidays.module';
import { LeaveBalancesModule } from './leave-balances/leave-balances.module';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { LeaveTypesModule } from './leave-types/leave-types.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { ServicesModule } from './services/services.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string>('DB_PORT', '3306')),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>(
          'DB_DATABASE',
          'gestion_conges_gmes',
        ),
        autoLoadEntities: true,
        synchronize: false,
        supportBigNumbers: true,
        bigNumberStrings: false,
        charset: 'utf8mb4',
      }),
    }),

    AuditModule,
    SettingsModule,
    NotificationsModule,
    ServicesModule,
    AbsenceDeclarationsModule,
    UsersModule,
    AuthModule,
    DerogationsModule,
    DocumentsModule,
    LeaveTypesModule,
    LeaveBalancesModule,
    LeaveRequestsModule,
    HolidaysModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
