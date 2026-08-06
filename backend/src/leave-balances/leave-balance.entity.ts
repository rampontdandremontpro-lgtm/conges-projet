import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum LeaveBalanceCounterType {
  N_MINUS_1 = 'N-1',
  N = 'N',
  N_PLUS_1 = 'N+1',
}

const decimalTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

@Entity('leave_balances')
@Index(
  'UQ_leave_balances_employee_period_counter',
  ['employeeId', 'referencePeriod', 'counterType'],
  { unique: true },
)
export class LeaveBalance {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'reference_period', type: 'varchar', length: 20 })
  referencePeriod!: string;

  @Column({ name: 'counter_type', type: 'varchar', length: 20 })
  counterType!: LeaveBalanceCounterType;

  @Column({
    name: 'acquired_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  acquiredDays!: number;

  @Column({
    name: 'reserved_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  reservedDays!: number;

  @Column({
    name: 'consumed_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  consumedDays!: number;

  @Column({
    name: 'available_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  availableDays!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
