import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclarationsModule } from './absence-declarations/absence-declarations.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DerogationsModule } from './derogations/derogations.module';
import { AddBalanceProcessingStatus20260827230000 } from './database/migrations/20260827230000-add-balance-processing-status';
import { AddMustChangePassword20260828140000 } from './database/migrations/20260828140000-add-must-change-password';
import { AddAnticipatedLeave20260828180000 } from './database/migrations/20260828180000-add-anticipated-leave';
import { AddLeaveRequestDurationHours20260901150000 } from './database/migrations/20260901150000-add-leave-request-duration-hours';
import { AddDerogationSubmittedAt20260929180000 } from './database/migrations/20260929180000-add-derogation-submitted-at';
import { AddUserExitDate20260930180000 } from './database/migrations/20260930180000-add-user-exit-date';
import { MakeServiceIdNullable20261012100000 } from './database/migrations/20261012100000-make-service-id-nullable';
import { MakeActorReferencesNullable20261012120000 } from './database/migrations/20261012120000-make-actor-references-nullable';
import { AddLegalEntities20261014100000 } from './database/migrations/20261014100000-add-legal-entities';
import { AddExtraDaysMovementTypes20261029100000 } from './database/migrations/20261029100000-add-extra-days-movement-types';
import { AddLeaveRequestIsFifthWeek20261029120000 } from './database/migrations/20261029120000-add-leave-request-is-fifth-week';
import { AddLeaveClassification20261029130000 } from './database/migrations/20261029130000-add-leave-classification';
import { AddTakePeriodReports20261029140000 } from './database/migrations/20261029140000-add-take-period-reports';
import { SimplifyTakePeriodReports20261029150000 } from './database/migrations/20261029150000-simplify-take-period-reports';
import { TakePeriodReportDocumentId20261029160000 } from './database/migrations/20261029160000-take-period-report-document-id';
import { AddArreteRestitution20261029170000 } from './database/migrations/20261029170000-add-arrete-restitution';
import { AddLegalEntityConvention20261029180000 } from './database/migrations/20261029180000-add-legal-entity-convention';
import { AddLeaveTypeAbsenceKind20261029190000 } from './database/migrations/20261029190000-add-leave-type-absence-kind';
import { LegalEntityConventionLegal20261029200000 } from './database/migrations/20261029200000-legal-entity-convention-legal';
import { LegalEntityAccord20261029210000 } from './database/migrations/20261029210000-legal-entity-accord';
import { AddFamilyEventKinds20261029220000 } from './database/migrations/20261029220000-add-family-event-kinds';
import { AddDecesEnfantKind20261029230000 } from './database/migrations/20261029230000-add-deces-enfant-kind';
import { AddFamilyEventContext20261029240000 } from './database/migrations/20261029240000-add-family-event-context';
import { AddFamilyEventRule20261030000000 } from './database/migrations/20261030000000-add-family-event-rule';
import { AddMariageEnfantKind20261031000000 } from './database/migrations/20261031000000-add-mariage-enfant-kind';
import { AddPaterniteKind20261031010000 } from './database/migrations/20261031010000-add-paternite-kind';
import { CreateBirthEvents20261031120000 } from './database/migrations/20261031120000-create-birth-events';
import { BirthEventsUnique20261031130000 } from './database/migrations/20261031130000-birth-events-unique';
import { AddAccrualIllnessTracking20261031140000 } from './database/migrations/20261031140000-add-accrual-illness-tracking';
import { CreateIllnessMaintenanceDecisions20261031150000 } from './database/migrations/20261031150000-create-illness-maintenance-decisions';
import { CreateAccrualAnomalies20261031160000 } from './database/migrations/20261031160000-create-accrual-anomalies';
import { AddAccrualAnomalyResolution20261031170000 } from './database/migrations/20261031170000-add-accrual-anomaly-resolution';
import { AddDecisionBasisReference20261031180000 } from './database/migrations/20261031180000-add-decision-basis-reference';
import { AddDecisionBasisStructured20261031190000 } from './database/migrations/20261031190000-add-decision-basis-structured';
import { AddAnomalyRhDecision20261031200000 } from './database/migrations/20261031200000-add-anomaly-rh-decision';
import { AddLegacyPendingStatus20261031210000 } from './database/migrations/20261031210000-add-legacy-pending-status';
import { AddAccordValidityAndDocumentScope20261031220000 } from './database/migrations/20261031220000-add-accord-validity-and-document-scope';
import { AddAnomalyConflictKey20261031230000 } from './database/migrations/20261031230000-add-anomaly-conflict-key';
import { FixAnomalyUniqueness20261031240000 } from './database/migrations/20261031240000-fix-anomaly-uniqueness';
import { AddAccordDocumentAndEntityScope20261031250000 } from './database/migrations/20261031250000-add-accord-document-and-entity-scope';
import { BirthEventsModule } from './birth-events/birth-events.module';
import { DocumentsModule } from './documents/documents.module';
import { ExportsModule } from './exports/exports.module';
import { HolidaysModule } from './holidays/holidays.module';
import { IllnessMaintenanceModule } from './illness-maintenance/illness-maintenance.module';
import { LeaveBalancesModule } from './leave-balances/leave-balances.module';
import { CarryoverLotsModule } from './leave-balances/carryover-lots/carryover-lots.module';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { LeaveTypesModule } from './leave-types/leave-types.module';
import { LegalEntitiesModule } from './legal-entities/legal-entities.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { ServicesModule } from './services/services.module';
import { UsersModule } from './users/users.module';
import { ValidatorsModule } from './validators/validators.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fichier d'environnement sélectionné au lancement :
      //   - production : ENV_FILE non défini → `.env` (gestion_conges_gmes)
      //   - recette    : ENV_FILE=.env.recette → base isolée de test
      // Évite qu'un `node dist/main` nu retombe sur `.env` et cible la base
      // réelle, ce qui déclenchait à tort l'échec de compatibilité de schéma.
      envFilePath: process.env.ENV_FILE || '.env',
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = configService.get<string>(
          'DB_DATABASE',
          'gestion_conges_gmes',
        );
        const nodeEnv = configService.get<string>('NODE_ENV');
        const carryoverEnabled =
          configService.get<string>('CARRYOVER_LOTS_ENABLED') === 'true';

        // Garde-fou absolu : les tests e2e (NODE_ENV=test) et la recette
        // JUR-027 (CARRYOVER_LOTS_ENABLED=true) ne peuvent démarrer que sur la
        // base de test. La connexion (et migrationsRun) n'a lieu qu'après
        // cette fabrique : l'erreur empêche toute connexion à une autre base.
        const mustUseTestDatabase = nodeEnv === 'test' || carryoverEnabled;
        if (mustUseTestDatabase && database !== 'gestion_conges_gmes_test') {
          throw new Error(
            `Garde-fou base de données : la base « ${database} » est interdite. ` +
              (nodeEnv === 'test'
                ? 'Les tests e2e doivent cibler exclusivement « gestion_conges_gmes_test ».'
                : 'La recette JUR-027 doit cibler exclusivement « gestion_conges_gmes_test ».') +
              ' Vérifiez DB_DATABASE (variable d’environnement ou .env).',
          );
        }

        // Garde-fou migrations : aucune migration ne doit être exécutée
        // automatiquement sur la base réelle sans autorisation explicite. Les
        // migrations ne s'exécutent que sur la base de test isolée ou lorsque
        // MIGRATIONS_AUTHORIZED=true (déploiement explicitement autorisé).
        const migrationsAuthorized =
          configService.get<string>('MIGRATIONS_AUTHORIZED') === 'true';
        const isTestDatabase = database === 'gestion_conges_gmes_test';
        const migrationsRun = isTestDatabase || migrationsAuthorized;

        return {
          type: 'mysql',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: Number(configService.get<string>('DB_PORT', '3306')),
          username: configService.get<string>('DB_USERNAME', 'root'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database,
          autoLoadEntities: true,
          synchronize: false,
          migrations: [
            AddBalanceProcessingStatus20260827230000,
            AddMustChangePassword20260828140000,
            AddAnticipatedLeave20260828180000,
            AddLeaveRequestDurationHours20260901150000,
            AddDerogationSubmittedAt20260929180000,
            AddUserExitDate20260930180000,
            MakeServiceIdNullable20261012100000,
            MakeActorReferencesNullable20261012120000,
            AddLegalEntities20261014100000,
            AddExtraDaysMovementTypes20261029100000,
            AddLeaveRequestIsFifthWeek20261029120000,
            AddLeaveClassification20261029130000,
            AddTakePeriodReports20261029140000,
            SimplifyTakePeriodReports20261029150000,
            TakePeriodReportDocumentId20261029160000,
            AddArreteRestitution20261029170000,
            AddLegalEntityConvention20261029180000,
            AddLeaveTypeAbsenceKind20261029190000,
            LegalEntityConventionLegal20261029200000,
            LegalEntityAccord20261029210000,
            AddFamilyEventKinds20261029220000,
            AddDecesEnfantKind20261029230000,
            AddFamilyEventContext20261029240000,
            AddFamilyEventRule20261030000000,
            AddMariageEnfantKind20261031000000,
            AddPaterniteKind20261031010000,
            CreateBirthEvents20261031120000,
            BirthEventsUnique20261031130000,
            AddAccrualIllnessTracking20261031140000,
            CreateIllnessMaintenanceDecisions20261031150000,
            CreateAccrualAnomalies20261031160000,
            AddAccrualAnomalyResolution20261031170000,
            AddDecisionBasisReference20261031180000,
            AddDecisionBasisStructured20261031190000,
            AddAnomalyRhDecision20261031200000,
            AddLegacyPendingStatus20261031210000,
            AddAccordValidityAndDocumentScope20261031220000,
            AddAnomalyConflictKey20261031230000,
            FixAnomalyUniqueness20261031240000,
            AddAccordDocumentAndEntityScope20261031250000,
          ],
          migrationsRun,
          migrationsTableName: 'typeorm_migrations',
          supportBigNumbers: true,
          bigNumberStrings: false,
          charset: 'utf8mb4',
        };
      },
    }),

    AuditModule,
    BirthEventsModule,
    PresenceModule,
    SettingsModule,
    NotificationsModule,
    ReportsModule,
    ServicesModule,
    AbsenceDeclarationsModule,
    UsersModule,
    AuthModule,
    DerogationsModule,
    DocumentsModule,
    ExportsModule,
    LeaveTypesModule,
    LeaveBalancesModule,
    CarryoverLotsModule,
    LeaveRequestsModule,
    IllnessMaintenanceModule,
    HolidaysModule,
    ValidatorsModule,
    LegalEntitiesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
