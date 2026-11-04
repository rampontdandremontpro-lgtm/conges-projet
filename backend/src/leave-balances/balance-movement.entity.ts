import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { User } from '../users/user.entity';
import { LeaveBalance } from './leave-balance.entity';

export enum BalanceMovementType {
  ACQUISITION = 'ACQUISITION',
  RESERVATION = 'RESERVATION',
  LIBERATION_RESERVATION = 'LIBERATION_RESERVATION',
  DEDUCTION = 'DEDUCTION',
  CORRECTION_POSITIVE = 'CORRECTION_POSITIVE',
  CORRECTION_NEGATIVE = 'CORRECTION_NEGATIVE',
  RECREDIT = 'RECREDIT',
  REMISE_A_ZERO = 'REMISE_A_ZERO',
  SENIORITY_EXTRA = 'SENIORITY_EXTRA',
  FRACTIONNEMENT = 'FRACTIONNEMENT',
  ARRET_RESTITUTION = 'ARRET_RESTITUTION',
}

const decimalTransformer = {
  to: (value: number | null): number | null => value,
  // Préserve NULL : un mouvement ANCIEN/manuel (illness_days NULL) doit rester
  // distinguable d'un mouvement moteur (illness_days = 0). Number(null) = 0
  // écraserait cette distinction utilisée pour protéger le crédit historique.
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('balance_movements')
@Index('IDX_balance_movements_employee_created', ['employeeId', 'createdAt'])
@Index('IDX_balance_movements_leave_request', ['leaveRequestId'])
export class BalanceMovement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'leave_balance_id', type: 'bigint' })
  leaveBalanceId!: number;

  @ManyToOne(() => LeaveBalance, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_balance_id' })
  leaveBalance!: LeaveBalance;

  @Column({ name: 'leave_request_id', type: 'bigint', nullable: true })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest | null;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  @Column({ name: 'movement_type', type: 'enum', enum: BalanceMovementType })
  movementType!: BalanceMovementType;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  days!: number;

  @Column({
    name: 'balance_before',
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  balanceBefore!: number;

  @Column({
    name: 'balance_after',
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  balanceAfter!: number;

  /**
   * JUR-025/037 — mois d'acquisition stable (AAAA-MM) pour une idempotence
   * indépendante du libellé du motif.
   */
  @Column({ name: 'accrual_month', type: 'varchar', length: 7, nullable: true })
  accrualMonth!: string | null;

  /**
   * JUR-037 — part du crédit acquise au titre de la maladie non professionnelle
   * (L3141-5-1), isolée par période de référence pour le plafond de 24 jours.
   */
  @Column({
    name: 'illness_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  illnessDays!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
