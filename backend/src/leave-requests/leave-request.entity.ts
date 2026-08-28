import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

export enum BalanceProcessingStatus {
  DEMANDE_ACTUELLE = 'DEMANDE_ACTUELLE',
  CONGE_PREVISIONNEL = 'CONGE_PREVISIONNEL',
  A_CONSOLIDER = 'A_CONSOLIDER',
  DEFINITIF = 'DEFINITIF',
}

export enum DayPeriod {
  MATIN = 'MATIN',
  APRES_MIDI = 'APRES_MIDI',
}

export enum SignatureType {
  DRAWN = 'DRAWN',
  INITIALS = 'INITIALS',
}

const decimalTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

const nullableDecimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('leave_requests')
@Index('IDX_leave_requests_employee_dates', ['employeeId', 'startDate', 'endDate'])
@Index('IDX_leave_requests_service_status', ['serviceId', 'status'])
@Index('IDX_leave_requests_status_submitted', ['status', 'submittedAt'])
@Index('IDX_leave_requests_balance_processing', ['status', 'balanceProcessingStatus', 'startDate'])
export class LeaveRequest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'created_by_id', type: 'bigint' })
  createdById!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User;

  @Column({ name: 'leave_type_id', type: 'bigint' })
  leaveTypeId!: number;

  @ManyToOne(() => LeaveType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType!: LeaveType;

  @Column({ name: 'service_id', type: 'bigint' })
  serviceId!: number;

  @ManyToOne(() => Service, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_id' })
  service!: Service;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({
    name: 'start_period',
    type: 'enum',
    enum: DayPeriod,
    default: DayPeriod.MATIN,
  })
  startPeriod!: DayPeriod;

  @Column({
    name: 'end_period',
    type: 'enum',
    enum: DayPeriod,
    default: DayPeriod.APRES_MIDI,
  })
  endPeriod!: DayPeriod;

  @Column({ name: 'calendar_duration', type: 'int' })
  calendarDuration!: number;

  @Column({
    name: 'deducted_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  deductedDays!: number;

  @Column({
    type: 'enum',
    enum: LeaveRequestStatus,
    default: LeaveRequestStatus.BROUILLON,
  })
  status!: LeaveRequestStatus;

  @Column({
    name: 'balance_processing_status',
    type: 'enum',
    enum: BalanceProcessingStatus,
    default: BalanceProcessingStatus.DEMANDE_ACTUELLE,
  })
  balanceProcessingStatus!: BalanceProcessingStatus;

  @Column({ name: 'is_anticipated_leave', type: 'boolean', default: false })
  isAnticipatedLeave!: boolean;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'modification_deadline', type: 'date', nullable: true })
  modificationDeadline!: string | null;

  @Column({
    name: 'real_balance_before',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  realBalanceBefore!: number | null;

  @Column({
    name: 'potential_balance_before',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  potentialBalanceBefore!: number | null;

  @Column({
    name: 'real_balance_after',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  realBalanceAfter!: number | null;

  @Column({ name: 'final_decider_id', type: 'bigint', nullable: true })
  finalDeciderId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'final_decider_id' })
  finalDecider!: User | null;

  @Column({
    name: 'final_decider_role',
    type: 'enum',
    enum: UserRole,
    nullable: true,
  })
  finalDeciderRole!: UserRole | null;

  @Column({ name: 'decision_at', type: 'datetime', nullable: true })
  decisionAt!: Date | null;

  @Column({ name: 'refusal_comment', type: 'text', nullable: true })
  refusalComment!: string | null;

  @Column({
    name: 'employee_signature_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  employeeSignatureType!: SignatureType | null;

  @Column({
    name: 'employee_signature_data',
    type: 'longtext',
    nullable: true,
    select: false,
  })
  employeeSignatureData!: string | null;

  @Column({ name: 'employee_signed_at', type: 'datetime', nullable: true })
  employeeSignedAt!: Date | null;

  @Column({
    name: 'validator_signature_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  validatorSignatureType!: SignatureType | null;

  @Column({
    name: 'validator_signature_data',
    type: 'longtext',
    nullable: true,
    select: false,
  })
  validatorSignatureData!: string | null;

  @Column({ name: 'validator_signed_at', type: 'datetime', nullable: true })
  validatorSignedAt!: Date | null;

  @Column({
    name: 'rh_confirmed_director_agreement',
    type: 'boolean',
    default: false,
  })
  rhConfirmedDirectorAgreement!: boolean;

  @Column({
    name: 'rh_director_agreement_confirmed_at',
    type: 'datetime',
    nullable: true,
  })
  rhDirectorAgreementConfirmedAt!: Date | null;

  @Column({ name: 'is_urgent', type: 'boolean', default: false })
  isUrgent!: boolean;

  @Column({ name: 'urgent_reason', type: 'text', nullable: true })
  urgentReason!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'locked_at', type: 'datetime', nullable: true })
  lockedAt!: Date | null;

  @Column({
    name: 'cancellation_requested_by_id',
    type: 'bigint',
    nullable: true,
  })
  cancellationRequestedById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cancellation_requested_by_id' })
  cancellationRequestedBy!: User | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason!: string | null;

  @Column({
    name: 'employee_cancellation_consent',
    type: 'boolean',
    nullable: true,
  })
  employeeCancellationConsent!: boolean | null;

  @Column({
    name: 'employee_cancellation_response_at',
    type: 'datetime',
    nullable: true,
  })
  employeeCancellationResponseAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
