import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BalanceMovement } from '../balance-movement.entity';
import { LeaveBalance } from '../leave-balance.entity';
import { LeaveRequest } from '../../leave-requests/leave-request.entity';
import { User } from '../../users/user.entity';
import { CarryoverLot } from '../carryover-lot.entity';

export enum CarryoverLotAllocationOperation {
  RESERVATION = 'RESERVATION',
  CONSUMPTION = 'CONSUMPTION',
  ANNULATION = 'ANNULATION',
  REGULARISATION = 'REGULARISATION',
}

const decimalTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

const nullableBooleanTransformer = {
  to: (value: boolean | null): boolean | null => value,
  from: (value: number | boolean | null): boolean | null =>
    value === null || value === undefined ? null : Boolean(value),
};

/**
 * JUR-027 — Lot L4 : traçabilité des allocations de jours reportés.
 * Chaque ligne rattache une opération (réservation/consommation/annulation/
 * régularisation) à un lot, une demande, un mouvement et un compteur.
 */
@Entity('lot_allocations')
@Index('IDX_lot_allocations_lot', ['lotId'])
@Index('IDX_lot_allocations_request', ['leaveRequestId'])
@Index('IDX_lot_allocations_movement', ['movementId'])
@Index('UQ_lot_allocations_request_lot_op', ['leaveRequestId', 'lotId', 'operationType'], { unique: true })
export class CarryoverLotAllocation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'lot_id', type: 'bigint' })
  lotId!: number;

  @ManyToOne(() => CarryoverLot, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lot_id' })
  lot!: CarryoverLot;

  @Column({ name: 'leave_request_id', type: 'bigint', nullable: true })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest | null;

  @Column({ name: 'movement_id', type: 'bigint', nullable: true })
  movementId!: number | null;

  @ManyToOne(() => BalanceMovement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'movement_id' })
  movement!: BalanceMovement | null;

  @Column({ name: 'leave_balance_id', type: 'bigint', nullable: true })
  leaveBalanceId!: number | null;

  @ManyToOne(() => LeaveBalance, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leave_balance_id' })
  leaveBalance!: LeaveBalance | null;

  @Column({
    name: 'operation_type',
    type: 'varchar',
    length: 30,
  })
  operationType!: CarryoverLotAllocationOperation;

  /**
   * true : les jours sont encore présents dans `availableDays` du compteur
   * (gelés en attente de régularisation RH, ex. libération d'une réservation
   * après expiration du lot). false/null : jours déjà débités du compteur.
   */
  @Column({
    name: 'frozen_in_balance',
    type: 'tinyint',
    nullable: true,
    transformer: nullableBooleanTransformer,
  })
  frozenInBalance!: boolean | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  days!: number;

  @Column({ name: 'covered_dates', type: 'json', nullable: true })
  coveredDates!: Array<{ date: string; value: number }> | null;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
