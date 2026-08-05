import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LeaveTypeCategory {
  CONGE = 'CONGE',
  ABSENCE = 'ABSENCE',
}

export enum LeaveAccrualMode {
  NORMALE = 'NORMALE',
  REDUITE = 'REDUITE',
  AUCUNE = 'AUCUNE',
}

@Entity('leave_types')
export class LeaveType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'varchar',
    length: 120,
    unique: true,
  })
  name!: string;

  @Column({
    type: 'enum',
    enum: LeaveTypeCategory,
  })
  category!: LeaveTypeCategory;

  @Column({
    type: 'boolean',
    default: false,
  })
  deductsPaidLeaveBalance!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  documentRequired!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  documentCanBeAddedLater!: boolean;

  @Column({
    type: 'boolean',
    default: true,
  })
  employeeCanCreate!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  rhOnly!: boolean;

  @Column({
    type: 'boolean',
    default: true,
  })
  allowsDays!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  allowsHalfDays!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  allowsHours!: boolean;

  @Column({
    type: 'boolean',
    default: true,
  })
  requiresValidation!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  requiresEmployeeSignature!: boolean;

  @Column({
    type: 'enum',
    enum: LeaveAccrualMode,
    default: LeaveAccrualMode.NORMALE,
  })
  accrualMode!: LeaveAccrualMode;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 2.5,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => Number(value),
    },
  })
  monthlyAccrualDays!: number;

  @Column({
    type: 'boolean',
    default: true,
  })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
