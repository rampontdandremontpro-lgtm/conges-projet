import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LeaveType } from '../leave-types/leave-type.entity';
import { Service } from '../services/service.entity';
import { User, UserRole } from '../users/user.entity';

export enum LeaveRequestStatus {
  BROUILLON = 'BROUILLON',
  EN_ATTENTE_VALIDATION = 'EN_ATTENTE_VALIDATION',
  VALIDEE = 'VALIDEE',
  REFUSEE = 'REFUSEE',
  ANNULEE = 'ANNULEE',
  ANNULATION_EN_ATTENTE_ACCORD = 'ANNULATION_EN_ATTENTE_ACCORD',
  ANNULEE_APRES_VALIDATION = 'ANNULEE_APRES_VALIDATION',
  EXPIREE_NON_VALIDEE = 'EXPIREE_NON_VALIDEE',
}

export enum DayPeriod {
  MATIN = 'MATIN',
  APRES_MIDI = 'APRES_MIDI',
}

export enum SignatureType {
  DRAWN = 'DRAWN',
  INITIALS = 'INITIALS',
}

const nullableDecimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'int',
  })
  employeeId!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'employeeId',
  })
  employee!: User;

  @Column({
    type: 'int',
  })
  createdById!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'createdById',
  })
  createdBy!: User;

  @Column({
    type: 'int',
  })
  leaveTypeId!: number;

  @ManyToOne(() => LeaveType, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'leaveTypeId',
  })
  leaveType!: LeaveType;

  @Column({
    type: 'int',
  })
  serviceId!: number;

  @ManyToOne(() => Service, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'serviceId',
  })
  service!: Service;

  @Column({
    type: 'date',
  })
  startDate!: string;

  @Column({
    type: 'date',
  })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: DayPeriod,
    default: DayPeriod.MATIN,
  })
  startPeriod!: DayPeriod;

  @Column({
    type: 'enum',
    enum: DayPeriod,
    default: DayPeriod.APRES_MIDI,
  })
  endPeriod!: DayPeriod;

  @Column({
    type: 'int',
  })
  calendarDuration!: number;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => Number(value),
    },
  })
  deductedDays!: number;

  @Column({
    type: 'enum',
    enum: LeaveRequestStatus,
    default: LeaveRequestStatus.BROUILLON,
  })
  status!: LeaveRequestStatus;

  @Column({
    type: 'text',
    nullable: true,
  })
  comment!: string | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  submittedAt!: Date | null;

  @Column({
    type: 'date',
    nullable: true,
  })
  modificationDeadline!: string | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  realBalanceBefore!: number | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  potentialBalanceBefore!: number | null;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  realBalanceAfter!: number | null;

  @Column({
    type: 'int',
    nullable: true,
  })
  finalDeciderId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'finalDeciderId' })
  finalDecider!: User | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    nullable: true,
  })
  finalDeciderRole!: UserRole | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  decisionAt!: Date | null;

  @Column({
    type: 'text',
    nullable: true,
  })
  refusalComment!: string | null;

  @Column({
    type: 'enum',
    enum: SignatureType,
    nullable: true,
  })
  employeeSignatureType!: SignatureType | null;

  @Column({
    type: 'longtext',
    nullable: true,
    select: false,
  })
  employeeSignatureData!: string | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  employeeSignedAt!: Date | null;

  @Column({
    type: 'enum',
    enum: SignatureType,
    nullable: true,
  })
  validatorSignatureType!: SignatureType | null;

  @Column({
    type: 'longtext',
    nullable: true,
    select: false,
  })
  validatorSignatureData!: string | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  validatorSignedAt!: Date | null;

  @Column({
    type: 'boolean',
    default: false,
  })
  rhConfirmedDirectorAgreement!: boolean;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  rhDirectorAgreementConfirmedAt!: Date | null;

  @Column({
    type: 'int',
    default: 1,
  })
  version!: number;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  lockedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
