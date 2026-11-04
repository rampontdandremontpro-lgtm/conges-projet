import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { AuditModule } from '../audit/audit.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { SettingsModule } from '../settings/settings.module';
import { BalanceMovement } from './balance-movement.entity';
import { LeaveBalance } from './leave-balance.entity';
import { LeaveArreteRestoration } from './leave-arrete-restoration.entity';
import { ArreteChevauchementService } from './arrete-chevauchement.service';

/**
 * JUR-028 — module autonome (sans dépendance circulaire) pour la détection du
 * chevauchement arrêt maladie / congés posés et la restitution des jours.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveArreteRestoration,
      LeaveRequest,
      BalanceMovement,
      LeaveBalance,
      AbsenceDeclaration,
    ]),
    SettingsModule,
    AuditModule,
    HolidaysModule,
  ],
  providers: [ArreteChevauchementService],
  exports: [ArreteChevauchementService, TypeOrmModule],
})
export class ArreteChevauchementModule {}
