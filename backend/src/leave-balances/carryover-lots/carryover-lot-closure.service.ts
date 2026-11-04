import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { SettingsService } from '../../settings/settings.service';
import { UserRole } from '../../users/user.entity';
import { BalanceMovement } from '../balance-movement.entity';
import { LeaveBalance } from '../leave-balance.entity';
import { CarryoverLot } from '../carryover-lot.entity';
import { CarryoverLotAllocation } from './carryover-lot-allocation.entity';
import { isCarryoverLotsEnvironmentAllowed } from './carryover-lots.service';
import { buildCarryoverLotPlan } from './carryover-lot-closure.core';
import {
  martiniqueDateString,
  nextReferencePeriod,
  parseReferencePeriod,
  referencePeriodEndDate,
} from '../reference-period.util';

/**
 * JUR-027 — Lot L5 (clôture unifiée) : ce service n'exécute PLUS de
 * pré-traitement autonome des lots. Le traitement des lots maladie est
 * désormais intégré à `closeReferencePeriod` (même transaction, même verrou,
 * marqueur définitif unique).
 *
 * Seul le point de prévisualisation (lecture seule) reste exposé pour la RH.
 */
@Injectable()
export class CarryoverLotClosureService {
  constructor(
    @InjectRepository(CarryoverLot)
    private readonly lotRepository: Repository<CarryoverLot>,
    @InjectRepository(CarryoverLotAllocation)
    private readonly allocationRepository: Repository<CarryoverLotAllocation>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepository: Repository<LeaveBalance>,
    @InjectRepository(BalanceMovement)
    private readonly movementRepository: Repository<BalanceMovement>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  private assertEnvironment(): void {
    const flag = this.configService.get<string>('CARRYOVER_LOTS_ENABLED');
    const database = this.dataSource.options.database;
    if (
      !isCarryoverLotsEnvironmentAllowed(
        flag,
        typeof database === 'string' ? database : undefined,
      )
    ) {
      throw new NotFoundException('Fonctionnalité indisponible.');
    }
  }

  private assertRh(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.RH) {
      throw new ForbiddenException(
        'Vous ne disposez pas des autorisations nécessaires.',
      );
    }
  }

  private assertPeriod(referencePeriod: string): void {
    try {
      parseReferencePeriod(referencePeriod);
    } catch (error) {
      throw new BadRequestException(
        `Période invalide : ${(error as Error).message}`,
      );
    }
  }

  async preview(referencePeriod: string): Promise<unknown> {
    this.assertEnvironment();
    this.assertPeriod(referencePeriod);
    // Lecture seule : aucune écriture, aucun verrou de période.
    return this.dataSource.transaction(async (manager) => {
      const plan = await buildCarryoverLotPlan(manager, referencePeriod);
      return {
        referencePeriod,
        nextReferencePeriod: nextReferencePeriod(referencePeriod),
        blocked: plan.blocked,
        reasons: plan.reasons,
        counters: plan.counters,
      };
    });
  }

  /**
   * L'exécution autonome du pré-traitement est BLOQUÉE : elle modifierait les
   * compteurs avant une clôture ultérieure (deux transactions non atomiques).
   * La clôture des reports maladie est portée par la clôture de période GMES
   * (`POST /leave-balances/period/close`), qui traite les lots dans la même
   * transaction et écrit le marqueur définitif unique.
   */
  async execute(referencePeriod: string, actor: AuthenticatedUser): Promise<never> {
    this.assertEnvironment();
    this.assertRh(actor);
    this.assertPeriod(referencePeriod);

    // Réutilise la règle de fin de période pour un message cohérent (aucune
    // mutation SQL : l'opération est refusée avant toute écriture).
    const startMonthDay = await this.settingsService.getString(
      'REFERENCE_PERIOD_START',
      '06-01',
    );
    const expectedEndDate = referencePeriodEndDate(referencePeriod, startMonthDay);
    const today = martiniqueDateString(new Date());
    if (today < expectedEndDate) {
      throw new BadRequestException(
        `La période ${referencePeriod} ne peut pas être clôturée avant le ${expectedEndDate}.`,
      );
    }

    throw new BadRequestException(
      'Le pré-traitement autonome des lots maladie est désactivé. ' +
        'Utilisez la clôture de période GMES (POST /leave-balances/period/close) : ' +
        'elle traite les lots maladie et les opérations GMES dans une seule transaction.',
    );
  }
}
