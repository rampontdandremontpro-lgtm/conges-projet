import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  Repository,
} from 'typeorm';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  BalanceMovement,
  BalanceMovementType,
} from './balance-movement.entity';
import { AddBalanceAccrualDto } from './dto/add-balance-accrual.dto';
import { CorrectLeaveBalanceDto } from './dto/correct-leave-balance.dto';
import { InitializeLeaveBalanceDto } from './dto/initialize-leave-balance.dto';
import { LeaveBalanceQueryDto } from './dto/leave-balance-query.dto';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';

export interface LeaveBalanceView {
  id: number;
  employee: {
    id: number;
    nom: string;
    prenom: string;
    email: string;
    isActive: boolean;
  };
  referencePeriod: string;
  counterType: LeaveBalanceCounterType;
  acquiredDays: number;
  reservedDays: number;
  consumedDays: number;
  availableDays: number;
  potentialDays: number;
  updatedAt: Date;
}

export interface PaidLeaveReservationSummary {
  realBalanceBefore: number;
  potentialBalanceBefore: number;
  realBalanceAfter: number;
  potentialBalanceAfter: number;
  reservations: Array<{
    leaveBalanceId: number;
    referencePeriod: string;
    counterType: LeaveBalanceCounterType;
    days: number;
  }>;
}

export interface PaidLeaveReservationReleaseSummary {
  releasedDays: number;
  releases: Array<{
    leaveBalanceId: number;
    referencePeriod: string;
    counterType: LeaveBalanceCounterType;
    days: number;
  }>;
}

@Injectable()
export class LeaveBalancesService {
  constructor(
    @InjectRepository(LeaveBalance)
    private readonly leaveBalanceRepository: Repository<LeaveBalance>,

    @InjectRepository(BalanceMovement)
    private readonly movementRepository: Repository<BalanceMovement>,

    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async initializeBalance(
    authenticatedUser: AuthenticatedUser,
    dto: InitializeLeaveBalanceDto,
  ): Promise<LeaveBalanceView> {
    const employee = await this.findEligibleEmployee(
      dto.employeeId,
      true,
    );

    this.validateReferencePeriod(dto.referencePeriod);

    const acquiredDays = this.round(dto.acquiredDays ?? 0);

    const balanceId = await this.dataSource.transaction(
      async (manager) => {
        const balanceRepository = manager.getRepository(LeaveBalance);
        const movementRepository =
          manager.getRepository(BalanceMovement);

        const existingBalance = await balanceRepository.findOne({
          where: {
            employeeId: employee.id,
            referencePeriod: dto.referencePeriod,
            counterType: dto.counterType,
          },
        });

        if (existingBalance) {
          throw new ConflictException(
            'Un solde existe déjà pour ce collaborateur, cette période et ce compteur.',
          );
        }

        const balance = balanceRepository.create({
          employeeId: employee.id,
          employee,
          referencePeriod: dto.referencePeriod,
          counterType: dto.counterType,
          acquiredDays,
          reservedDays: 0,
          consumedDays: 0,
          availableDays: acquiredDays,
        });

        const savedBalance = await balanceRepository.save(balance);

        if (acquiredDays > 0) {
          await movementRepository.save(
            movementRepository.create({
              employeeId: employee.id,
              employee,
              leaveBalanceId: savedBalance.id,
              leaveBalance: savedBalance,
              leaveRequestId: null,
              leaveRequest: null,
              actorId: authenticatedUser.id,
              movementType:
                BalanceMovementType.CORRECTION_POSITIVE,
              days: acquiredDays,
              balanceBefore: 0,
              balanceAfter: acquiredDays,
              reason:
                dto.reason?.trim() ||
                'Initialisation du compteur de congés.',
            }),
          );
        }

        return savedBalance.id;
      },
    );

    return this.getBalanceView(balanceId);
  }

  async addAccrual(
    balanceId: number,
    authenticatedUser: AuthenticatedUser,
    dto: AddBalanceAccrualDto,
  ): Promise<LeaveBalanceView> {
    const days = this.round(dto.days);

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceForUpdate(
        manager,
        balanceId,
      );

      const balanceBefore = this.round(balance.availableDays);

      balance.acquiredDays = this.round(
        balance.acquiredDays + days,
      );
      balance.availableDays = this.round(
        balance.availableDays + days,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.ACQUISITION,
        days,
        balanceBefore,
        balanceAfter: balance.availableDays,
        actorId: authenticatedUser.id,
        leaveRequestId: null,
        reason:
          dto.reason?.trim() || 'Acquisition de congés payés.',
      });
    });

    return this.getBalanceView(balanceId);
  }

  async correctBalance(
    balanceId: number,
    authenticatedUser: AuthenticatedUser,
    dto: CorrectLeaveBalanceDto,
  ): Promise<LeaveBalanceView> {
    const correction = this.round(dto.days);

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceForUpdate(
        manager,
        balanceId,
      );

      const balanceBefore = this.round(balance.availableDays);
      const balanceAfter = this.round(balanceBefore + correction);
      const potentialAfter = this.round(
        balanceAfter - balance.reservedDays,
      );
      const acquiredAfter = this.round(
        balance.acquiredDays + correction,
      );

      if (balanceAfter < 0 || potentialAfter < 0) {
        throw new BadRequestException(
          'Cette correction rendrait le solde réel ou le solde potentiel négatif.',
        );
      }

      if (acquiredAfter < 0) {
        throw new BadRequestException(
          'Cette correction rendrait le nombre de jours acquis négatif.',
        );
      }

      balance.acquiredDays = acquiredAfter;
      balance.availableDays = balanceAfter;

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType:
          correction > 0
            ? BalanceMovementType.CORRECTION_POSITIVE
            : BalanceMovementType.CORRECTION_NEGATIVE,
        days: Math.abs(correction),
        balanceBefore,
        balanceAfter,
        actorId: authenticatedUser.id,
        leaveRequestId: null,
        reason: dto.reason?.trim() || null,
      });
    });

    return this.getBalanceView(balanceId);
  }

  async getManagementOverview() {
    const employees = (await this.usersService.findAll())
      .filter((employee) => employee.role !== UserRole.ADMIN && employee.isActive)
      .sort((first, second) => {
        const lastName = first.nom.localeCompare(second.nom, 'fr', { sensitivity: 'base' });
        return lastName !== 0
          ? lastName
          : first.prenom.localeCompare(second.prenom, 'fr', { sensitivity: 'base' });
      });

    const employeeIds = new Set(employees.map((employee) => employee.id));
    const balances = (await this.leaveBalanceRepository.find())
      .filter((balance) => employeeIds.has(balance.employeeId));

    return employees.map((employee) => {
      const employeeBalances = balances.filter(
        (balance) => balance.employeeId === employee.id,
      );
      const referencePeriods = [
        ...new Set(employeeBalances.map((balance) => balance.referencePeriod)),
      ].sort((first, second) => second.localeCompare(first));
      const referencePeriod = referencePeriods[0] ?? null;
      const scoped = referencePeriod
        ? employeeBalances.filter(
            (balance) => balance.referencePeriod === referencePeriod,
          )
        : [];
      const usable = scoped.find(
        (balance) => balance.counterType === LeaveBalanceCounterType.N_MINUS_1,
      ) ?? null;
      const acquisition = scoped.find(
        (balance) => balance.counterType === LeaveBalanceCounterType.N,
      ) ?? null;

      const usableDays = this.round(usable?.availableDays ?? 0);
      const acquisitionDays = this.round(acquisition?.acquiredDays ?? 0);
      const reservedDays = this.round(usable?.reservedDays ?? 0);
      const availableAfterReservations = this.round(
        usableDays - reservedDays,
      );

      return {
        employee: {
          id: employee.id,
          nom: employee.nom,
          prenom: employee.prenom,
          email: employee.email,
          role: employee.role,
          isActive: employee.isActive,
          service: employee.service
            ? { id: employee.service.id, name: employee.service.name }
            : null,
        },
        referencePeriod,
        usableDays,
        acquisitionDays,
        reservedDays,
        availableAfterReservations,
        hasBalances: scoped.length > 0,
        updatedAt: scoped
          .map((balance) => balance.updatedAt)
          .sort((first, second) => second.getTime() - first.getTime())[0] ?? null,
      };
    });
  }

  async getEmployeeBalances(
    employeeId: number,
    query: LeaveBalanceQueryDto,
  ): Promise<LeaveBalanceView[]> {
    await this.findEligibleEmployee(employeeId, false);

    if (query.referencePeriod) {
      this.validateReferencePeriod(query.referencePeriod);
    }

    const queryBuilder = this.leaveBalanceRepository
      .createQueryBuilder('balance')
      .leftJoinAndSelect('balance.employee', 'employee')
      .where('balance.employeeId = :employeeId', {
        employeeId,
      });

    if (query.referencePeriod) {
      queryBuilder.andWhere(
        'balance.referencePeriod = :referencePeriod',
        {
          referencePeriod: query.referencePeriod,
        },
      );
    }

    if (query.counterType) {
      queryBuilder.andWhere('balance.counterType = :counterType', {
        counterType: query.counterType,
      });
    }

    const balances = await queryBuilder
      .orderBy('balance.referencePeriod', 'DESC')
      .getMany();

    return balances
      .sort((first, second) => {
        const periodComparison = second.referencePeriod.localeCompare(
          first.referencePeriod,
        );

        if (periodComparison !== 0) {
          return periodComparison;
        }

        return (
          this.counterOrder(first.counterType) -
          this.counterOrder(second.counterType)
        );
      })
      .map((balance) => this.toView(balance));
  }

  async getEmployeeHistory(
    employeeId: number,
    query: LeaveBalanceQueryDto,
  ): Promise<BalanceMovement[]> {
    await this.findEligibleEmployee(employeeId, false);

    if (query.referencePeriod) {
      this.validateReferencePeriod(query.referencePeriod);
    }

    const queryBuilder = this.movementRepository
      .createQueryBuilder('movement')
      .leftJoinAndSelect('movement.leaveBalance', 'leaveBalance')
      .leftJoinAndSelect('movement.actor', 'actor')
      .leftJoinAndSelect('movement.leaveRequest', 'leaveRequest')
      .where('movement.employeeId = :employeeId', {
        employeeId,
      });

    if (query.referencePeriod) {
      queryBuilder.andWhere(
        'leaveBalance.referencePeriod = :referencePeriod',
        {
          referencePeriod: query.referencePeriod,
        },
      );
    }

    if (query.counterType) {
      queryBuilder.andWhere(
        'leaveBalance.counterType = :counterType',
        {
          counterType: query.counterType,
        },
      );
    }

    return queryBuilder
      .orderBy('movement.createdAt', 'DESC')
      .addOrderBy('movement.id', 'DESC')
      .getMany();
  }

  async getBalanceView(balanceId: number): Promise<LeaveBalanceView> {
    const balance = await this.leaveBalanceRepository.findOne({
      where: { id: balanceId },
      relations: {
        employee: true,
      },
    });

    if (!balance) {
      throw new NotFoundException(
        `Le solde ${balanceId} est introuvable.`,
      );
    }

    return this.toView(balance);
  }

  async getPotentialDays(
    employeeId: number,
    referencePeriod: string,
    counterType: LeaveBalanceCounterType,
  ): Promise<number> {
    const balance = await this.findBalanceByCounter(
      employeeId,
      referencePeriod,
      counterType,
    );

    return this.round(
      balance.availableDays - balance.reservedDays,
    );
  }

  async reserveDays(data: {
    employeeId: number;
    referencePeriod: string;
    counterType: LeaveBalanceCounterType;
    leaveRequestId: number;
    days: number;
    actorId: number | null;
    reason?: string | null;
  }): Promise<LeaveBalanceView> {
    this.validateReferencePeriod(data.referencePeriod);
    const days = this.validatePositiveDays(data.days);

    let balanceId = 0;

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceByCounterForUpdate(
        manager,
        data.employeeId,
        data.referencePeriod,
        data.counterType,
      );

      balanceId = balance.id;

      const potentialBefore = this.round(
        balance.availableDays - balance.reservedDays,
      );
      const potentialAfter = this.round(potentialBefore - days);

      if (potentialAfter < 0) {
        throw new BadRequestException(
          'Le solde potentiel est insuffisant pour cette demande.',
        );
      }

      balance.reservedDays = this.round(
        balance.reservedDays + days,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.RESERVATION,
        days,
        balanceBefore: potentialBefore,
        balanceAfter: potentialAfter,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Réservation liée à une demande de congés.',
      });
    });

    return this.getBalanceView(balanceId);
  }

  async releaseReservation(data: {
    balanceId: number;
    leaveRequestId: number;
    days: number;
    actorId: number | null;
    reason?: string | null;
  }): Promise<LeaveBalanceView> {
    const days = this.validatePositiveDays(data.days);

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceForUpdate(
        manager,
        data.balanceId,
      );

      if (balance.reservedDays < days) {
        throw new BadRequestException(
          'Le nombre de jours à libérer dépasse les jours réservés.',
        );
      }

      const potentialBefore = this.round(
        balance.availableDays - balance.reservedDays,
      );

      balance.reservedDays = this.round(
        balance.reservedDays - days,
      );

      const potentialAfter = this.round(
        balance.availableDays - balance.reservedDays,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType:
          BalanceMovementType.LIBERATION_RESERVATION,
        days,
        balanceBefore: potentialBefore,
        balanceAfter: potentialAfter,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Libération de la réservation de congés.',
      });
    });

    return this.getBalanceView(data.balanceId);
  }

  async deductReservedDays(data: {
    balanceId: number;
    leaveRequestId: number;
    days: number;
    actorId: number | null;
    reason?: string | null;
  }): Promise<LeaveBalanceView> {
    const days = this.validatePositiveDays(data.days);

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceForUpdate(
        manager,
        data.balanceId,
      );

      if (
        balance.reservedDays < days ||
        balance.availableDays < days
      ) {
        throw new BadRequestException(
          'Le solde réservé ou disponible est insuffisant.',
        );
      }

      const balanceBefore = this.round(balance.availableDays);

      balance.reservedDays = this.round(
        balance.reservedDays - days,
      );
      balance.consumedDays = this.round(
        balance.consumedDays + days,
      );
      balance.availableDays = this.round(
        balance.availableDays - days,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.DEDUCTION,
        days,
        balanceBefore,
        balanceAfter: balance.availableDays,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Déduction après validation de la demande.',
      });
    });

    return this.getBalanceView(data.balanceId);
  }

  async recreditDays(data: {
    balanceId: number;
    leaveRequestId: number;
    days: number;
    actorId: number | null;
    reason?: string | null;
  }): Promise<LeaveBalanceView> {
    const days = this.validatePositiveDays(data.days);

    await this.dataSource.transaction(async (manager) => {
      const balance = await this.findBalanceForUpdate(
        manager,
        data.balanceId,
      );

      if (balance.consumedDays < days) {
        throw new BadRequestException(
          'Le nombre de jours à recréditer dépasse les jours consommés.',
        );
      }

      const balanceBefore = this.round(balance.availableDays);

      balance.consumedDays = this.round(
        balance.consumedDays - days,
      );
      balance.availableDays = this.round(
        balance.availableDays + days,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.RECREDIT,
        days,
        balanceBefore,
        balanceAfter: balance.availableDays,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Recrédit après annulation définitive de la demande.',
      });
    });

    return this.getBalanceView(data.balanceId);
  }

  async reservePaidLeaveForRequest(
    manager: EntityManager,
    data: {
      employeeId: number;
      leaveRequestId: number;
      days: number;
      actorId: number | null;
      reason?: string | null;
    },
  ): Promise<PaidLeaveReservationSummary> {
    const days = this.validatePositiveDays(data.days);

    const existingActiveReservations =
      await this.findActiveReservationAllocations(
        manager,
        data.leaveRequestId,
      );

    if (existingActiveReservations.length > 0) {
      throw new ConflictException(
        'Une réservation active existe déjà pour cette demande.',
      );
    }

    const balances = await manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', {
        employeeId: data.employeeId,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      })
      .orderBy('balance.referencePeriod', 'ASC')
      .addOrderBy('balance.id', 'ASC')
      .getMany();

    if (balances.length === 0) {
      throw new NotFoundException(
        'Aucun compteur N-1 utilisable n’a été trouvé pour ce collaborateur.',
      );
    }

    const realBalanceBefore = this.round(
      balances.reduce(
        (total, balance) => total + balance.availableDays,
        0,
      ),
    );

    const potentialBalanceBefore = this.round(
      balances.reduce(
        (total, balance) =>
          total + balance.availableDays - balance.reservedDays,
        0,
      ),
    );

    if (potentialBalanceBefore < days) {
      throw new BadRequestException(
        `Le solde potentiel est insuffisant. Solde disponible : ${potentialBalanceBefore} jour(s), demande : ${days} jour(s).`,
      );
    }

    let remainingDays = days;
    const reservations: PaidLeaveReservationSummary['reservations'] =
      [];

    for (const balance of balances) {
      if (remainingDays <= 0) {
        break;
      }

      const potentialBefore = this.round(
        balance.availableDays - balance.reservedDays,
      );

      if (potentialBefore <= 0) {
        continue;
      }

      const reservedDays = this.round(
        Math.min(potentialBefore, remainingDays),
      );

      balance.reservedDays = this.round(
        balance.reservedDays + reservedDays,
      );

      const potentialAfter = this.round(
        balance.availableDays - balance.reservedDays,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.RESERVATION,
        days: reservedDays,
        balanceBefore: potentialBefore,
        balanceAfter: potentialAfter,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Réservation liée à la soumission d’une demande de congés.',
      });

      reservations.push({
        leaveBalanceId: balance.id,
        referencePeriod: balance.referencePeriod,
        counterType: balance.counterType,
        days: reservedDays,
      });

      remainingDays = this.round(remainingDays - reservedDays);
    }

    if (remainingDays > 0) {
      throw new BadRequestException(
        'La réservation du solde n’a pas pu être effectuée intégralement.',
      );
    }

    return {
      realBalanceBefore,
      potentialBalanceBefore,
      realBalanceAfter: realBalanceBefore,
      potentialBalanceAfter: this.round(
        potentialBalanceBefore - days,
      ),
      reservations,
    };
  }

  async releasePaidLeaveReservationForRequest(
    manager: EntityManager,
    data: {
      employeeId: number;
      leaveRequestId: number;
      actorId: number | null;
      reason?: string | null;
    },
  ): Promise<PaidLeaveReservationReleaseSummary> {
    const activeReservations =
      await this.findActiveReservationAllocations(
        manager,
        data.leaveRequestId,
      );

    if (activeReservations.length === 0) {
      return {
        releasedDays: 0,
        releases: [],
      };
    }

    let releasedDays = 0;
    const releases: PaidLeaveReservationReleaseSummary['releases'] =
      [];

    for (const reservation of activeReservations) {
      const balance = await this.findBalanceForUpdate(
        manager,
        reservation.leaveBalanceId,
      );

      if (balance.employeeId !== data.employeeId) {
        throw new ConflictException(
          'La réservation trouvée ne correspond pas au collaborateur de la demande.',
        );
      }

      const days = this.round(reservation.days);

      if (balance.reservedDays < days) {
        throw new ConflictException(
          'Les jours réservés sont insuffisants pour annuler la réservation de cette demande.',
        );
      }

      const potentialBefore = this.round(
        balance.availableDays - balance.reservedDays,
      );

      balance.reservedDays = this.round(
        balance.reservedDays - days,
      );

      const potentialAfter = this.round(
        balance.availableDays - balance.reservedDays,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType:
          BalanceMovementType.LIBERATION_RESERVATION,
        days,
        balanceBefore: potentialBefore,
        balanceAfter: potentialAfter,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          data.reason?.trim() ||
          'Libération de la réservation avant nouvelle soumission.',
      });

      releasedDays = this.round(releasedDays + days);
      releases.push({
        leaveBalanceId: balance.id,
        referencePeriod: balance.referencePeriod,
        counterType: balance.counterType,
        days,
      });
    }

    return {
      releasedDays,
      releases,
    };
  }

  async finalizePaidLeaveReservation(
    manager: EntityManager,
    data: {
      employeeId: number;
      leaveRequestId: number;
      actorId: number;
      expectedDays: number;
      decision: 'VALIDATE' | 'REFUSE';
    },
  ): Promise<{
    processedDays: number;
    realBalanceAfter: number;
  }> {
    const activeReservations =
      await this.findActiveReservationAllocations(
        manager,
        data.leaveRequestId,
      );

    if (activeReservations.length === 0) {
      throw new NotFoundException(
        'Aucune réservation active de solde n’a été trouvée pour cette demande.',
      );
    }

    const expectedDays = this.validatePositiveDays(
      data.expectedDays,
    );
    const reservedDays = this.round(
      activeReservations.reduce(
        (total, reservation) =>
          total + reservation.days,
        0,
      ),
    );

    if (reservedDays !== expectedDays) {
      throw new ConflictException(
        'La réservation active du solde ne correspond pas au nombre de jours de la demande.',
      );
    }

    let processedDays = 0;

    for (const reservation of activeReservations) {
      const balance = await this.findBalanceForUpdate(
        manager,
        reservation.leaveBalanceId,
      );

      if (balance.employeeId !== data.employeeId) {
        throw new ConflictException(
          'La réservation trouvée ne correspond pas au collaborateur de la demande.',
        );
      }

      const days = this.round(reservation.days);

      if (balance.reservedDays < days) {
        throw new BadRequestException(
          'Les jours réservés sont insuffisants pour finaliser cette demande.',
        );
      }

      if (data.decision === 'VALIDATE') {
        if (balance.availableDays < days) {
          throw new BadRequestException(
            'Le solde disponible est insuffisant pour valider cette demande.',
          );
        }

        const balanceBefore = this.round(
          balance.availableDays,
        );

        balance.reservedDays = this.round(
          balance.reservedDays - days,
        );
        balance.consumedDays = this.round(
          balance.consumedDays + days,
        );
        balance.availableDays = this.round(
          balance.availableDays - days,
        );

        await manager.getRepository(LeaveBalance).save(
          balance,
        );

        await this.createMovement(manager, {
          balance,
          movementType: BalanceMovementType.DEDUCTION,
          days,
          balanceBefore,
          balanceAfter: balance.availableDays,
          actorId: data.actorId,
          leaveRequestId: data.leaveRequestId,
          reason:
            'Déduction définitive après validation de la demande.',
        });
      } else {
        const potentialBefore = this.round(
          balance.availableDays - balance.reservedDays,
        );

        balance.reservedDays = this.round(
          balance.reservedDays - days,
        );

        const potentialAfter = this.round(
          balance.availableDays - balance.reservedDays,
        );

        await manager.getRepository(LeaveBalance).save(
          balance,
        );

        await this.createMovement(manager, {
          balance,
          movementType:
            BalanceMovementType.LIBERATION_RESERVATION,
          days,
          balanceBefore: potentialBefore,
          balanceAfter: potentialAfter,
          actorId: data.actorId,
          leaveRequestId: data.leaveRequestId,
          reason:
            'Libération de la réservation après refus de la demande.',
        });
      }

      processedDays = this.round(processedDays + days);
    }

    const balances = await manager.getRepository(LeaveBalance).find({
      where: {
        employeeId: data.employeeId,
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      },
    });

    const realBalanceAfter = this.round(
      balances.reduce(
        (total, balance) => total + balance.availableDays,
        0,
      ),
    );

    return {
      processedDays,
      realBalanceAfter,
    };
  }

  async recreditPaidLeaveForCancelledRequest(
    manager: EntityManager,
    data: {
      employeeId: number;
      leaveRequestId: number;
      actorId: number;
      expectedDays: number;
    },
  ): Promise<{
    recreditedDays: number;
    realBalanceAfter: number;
  }> {
    const expectedDays = this.validatePositiveDays(
      data.expectedDays,
    );

    const movements = await manager
      .getRepository(BalanceMovement)
      .find({
        where: {
          leaveRequestId: data.leaveRequestId,
          movementType: In([
            BalanceMovementType.DEDUCTION,
            BalanceMovementType.RECREDIT,
          ]),
        },
        order: { id: 'ASC' },
      });

    const netDeductionByBalance = new Map<number, number>();

    for (const movement of movements) {
      const current =
        netDeductionByBalance.get(movement.leaveBalanceId) ?? 0;
      const signedDays =
        movement.movementType === BalanceMovementType.DEDUCTION
          ? movement.days
          : -movement.days;

      netDeductionByBalance.set(
        movement.leaveBalanceId,
        this.round(current + signedDays),
      );
    }

    const allocations = [...netDeductionByBalance.entries()]
      .filter(([, days]) => days > 0)
      .map(([leaveBalanceId, days]) => ({
        leaveBalanceId,
        days: this.round(days),
      }));

    const totalToRecredit = this.round(
      allocations.reduce((total, item) => total + item.days, 0),
    );

    if (totalToRecredit === 0) {
      throw new ConflictException(
        'Cette demande a déjà été recréditée ou ne possède aucune déduction active.',
      );
    }

    if (totalToRecredit !== expectedDays) {
      throw new ConflictException(
        'Le total des déductions actives ne correspond pas au nombre de jours de la demande.',
      );
    }

    for (const allocation of allocations) {
      const balance = await this.findBalanceForUpdate(
        manager,
        allocation.leaveBalanceId,
      );

      if (balance.employeeId !== data.employeeId) {
        throw new ConflictException(
          'Le mouvement de solde ne correspond pas au collaborateur de la demande.',
        );
      }

      if (balance.consumedDays < allocation.days) {
        throw new ConflictException(
          'Le compteur ne contient pas assez de jours consommés pour effectuer le recrédit.',
        );
      }

      const balanceBefore = this.round(balance.availableDays);

      balance.consumedDays = this.round(
        balance.consumedDays - allocation.days,
      );
      balance.availableDays = this.round(
        balance.availableDays + allocation.days,
      );

      await manager.getRepository(LeaveBalance).save(balance);

      await this.createMovement(manager, {
        balance,
        movementType: BalanceMovementType.RECREDIT,
        days: allocation.days,
        balanceBefore,
        balanceAfter: balance.availableDays,
        actorId: data.actorId,
        leaveRequestId: data.leaveRequestId,
        reason:
          'Recrédit après annulation d’une demande de congé validée.',
      });
    }

    const balances = await manager.getRepository(LeaveBalance).find({
      where: {
        employeeId: data.employeeId,
        counterType: LeaveBalanceCounterType.N_MINUS_1,
      },
    });

    return {
      recreditedDays: totalToRecredit,
      realBalanceAfter: this.round(
        balances.reduce(
          (total, balance) => total + balance.availableDays,
          0,
        ),
      ),
    };
  }

  private async findActiveReservationAllocations(
    manager: EntityManager,
    leaveRequestId: number,
  ): Promise<
    Array<{
      leaveBalanceId: number;
      days: number;
    }>
  > {
    const movements = await manager
      .getRepository(BalanceMovement)
      .find({
        where: {
          leaveRequestId,
          movementType: In([
            BalanceMovementType.RESERVATION,
            BalanceMovementType.LIBERATION_RESERVATION,
          ]),
        },
        order: {
          id: 'ASC',
        },
      });

    const amountsByBalance = new Map<number, number>();

    for (const movement of movements) {
      const currentAmount =
        amountsByBalance.get(movement.leaveBalanceId) ?? 0;

      const delta =
        movement.movementType ===
        BalanceMovementType.RESERVATION
          ? movement.days
          : -movement.days;

      amountsByBalance.set(
        movement.leaveBalanceId,
        this.round(currentAmount + delta),
      );
    }

    return [...amountsByBalance.entries()]
      .filter(([, days]) => days > 0)
      .map(([leaveBalanceId, days]) => ({
        leaveBalanceId,
        days: this.round(days),
      }));
  }

  private async createMovement(
    manager: EntityManager,
    data: {
      balance: LeaveBalance;
      movementType: BalanceMovementType;
      days: number;
      balanceBefore: number;
      balanceAfter: number;
      actorId: number | null;
      leaveRequestId: number | null;
      reason: string | null;
    },
  ): Promise<BalanceMovement> {
    const repository = manager.getRepository(BalanceMovement);

    const movement = repository.create({
      employeeId: data.balance.employeeId,
      leaveBalanceId: data.balance.id,
      leaveBalance: data.balance,
      leaveRequestId: data.leaveRequestId,
      actorId: data.actorId,
      movementType: data.movementType,
      days: this.round(data.days),
      balanceBefore: this.round(data.balanceBefore),
      balanceAfter: this.round(data.balanceAfter),
      reason: data.reason,
    });

    return repository.save(movement);
  }

  private async findBalanceForUpdate(
    manager: EntityManager,
    balanceId: number,
  ): Promise<LeaveBalance> {
    const balance = await manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.id = :balanceId', { balanceId })
      .getOne();

    if (!balance) {
      throw new NotFoundException(
        `Le solde ${balanceId} est introuvable.`,
      );
    }

    return balance;
  }

  private async findBalanceByCounter(
    employeeId: number,
    referencePeriod: string,
    counterType: LeaveBalanceCounterType,
  ): Promise<LeaveBalance> {
    const balance = await this.leaveBalanceRepository.findOne({
      where: {
        employeeId,
        referencePeriod,
        counterType,
      },
    });

    if (!balance) {
      throw new NotFoundException(
        'Aucun solde ne correspond à ce collaborateur, cette période et ce compteur.',
      );
    }

    return balance;
  }

  private async findBalanceByCounterForUpdate(
    manager: EntityManager,
    employeeId: number,
    referencePeriod: string,
    counterType: LeaveBalanceCounterType,
  ): Promise<LeaveBalance> {
    const balance = await manager
      .getRepository(LeaveBalance)
      .createQueryBuilder('balance')
      .setLock('pessimistic_write')
      .where('balance.employeeId = :employeeId', { employeeId })
      .andWhere('balance.referencePeriod = :referencePeriod', {
        referencePeriod,
      })
      .andWhere('balance.counterType = :counterType', {
        counterType,
      })
      .getOne();

    if (!balance) {
      throw new NotFoundException(
        'Aucun solde ne correspond à ce collaborateur, cette période et ce compteur.',
      );
    }

    return balance;
  }

  private async findEligibleEmployee(
    employeeId: number,
    requireActive: boolean,
  ): Promise<User> {
    const employee = await this.usersService.findOne(employeeId);

    if (employee.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Un compte administrateur ne possède pas de solde de congés.',
      );
    }

    if (requireActive && !employee.isActive) {
      throw new BadRequestException(
        'Le solde d’un utilisateur désactivé ne peut pas être modifié.',
      );
    }

    return employee;
  }

  private validateReferencePeriod(referencePeriod: string): void {
    const match = /^(\d{4})-(\d{4})$/.exec(referencePeriod);

    if (!match) {
      throw new BadRequestException(
        'La période de référence doit respecter le format AAAA-AAAA.',
      );
    }

    const startYear = Number(match[1]);
    const endYear = Number(match[2]);

    if (endYear !== startYear + 1) {
      throw new BadRequestException(
        'La période de référence doit couvrir deux années consécutives.',
      );
    }
  }

  private validatePositiveDays(value: number): number {
    const days = this.round(value);

    if (days <= 0) {
      throw new BadRequestException(
        'Le nombre de jours doit être strictement positif.',
      );
    }

    return days;
  }

  private toView(balance: LeaveBalance): LeaveBalanceView {
    return {
      id: balance.id,
      employee: {
        id: balance.employee.id,
        nom: balance.employee.nom,
        prenom: balance.employee.prenom,
        email: balance.employee.email,
        isActive: balance.employee.isActive,
      },
      referencePeriod: balance.referencePeriod,
      counterType: balance.counterType,
      acquiredDays: this.round(balance.acquiredDays),
      reservedDays: this.round(balance.reservedDays),
      consumedDays: this.round(balance.consumedDays),
      availableDays: this.round(balance.availableDays),
      potentialDays: this.round(
        balance.availableDays - balance.reservedDays,
      ),
      updatedAt: balance.updatedAt,
    };
  }

  private counterOrder(counterType: LeaveBalanceCounterType): number {
    switch (counterType) {
      case LeaveBalanceCounterType.N_MINUS_1:
        return 0;
      case LeaveBalanceCounterType.N:
        return 1;
      case LeaveBalanceCounterType.N_PLUS_1:
        return 2;
      default:
        return 3;
    }
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
