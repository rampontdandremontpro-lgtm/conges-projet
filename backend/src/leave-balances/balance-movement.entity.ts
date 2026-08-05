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
}

const decimalTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

@Entity('balance_movements')
@Index('IDX_balance_movements_employee_created', [
  'employeeId',
  'createdAt',
])
@Index('IDX_balance_movements_leave_request', ['leaveRequestId'])
export class BalanceMovement {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    name: 'employee_id',
    type: 'int',
  })
  employeeId!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({
    name: 'leave_balance_id',
    type: 'int',
  })
  leaveBalanceId!: number;

  @ManyToOne(
    () => LeaveBalance,
    (leaveBalance) => leaveBalance.movements,
    {
      nullable: false,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'leave_balance_id' })
  leaveBalance!: LeaveBalance;

  @Column({
    name: 'leave_request_id',
    type: 'int',
    nullable: true,
  })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest | null;

  @Column({
    name: 'actor_id',
    type: 'int',
    nullable: true,
  })
  actorId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  @Column({
    name: 'movement_type',
    type: 'enum',
    enum: BalanceMovementType,
  })
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

  @Column({
    type: 'text',
    nullable: true,
  })
  reason!: string | null;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt!: Date;
}
