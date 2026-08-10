import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { LeaveType } from '../leave-types/leave-type.entity';
import { User } from '../users/user.entity';

export enum DerogationStatus {
  EN_ATTENTE_RH = 'EN_ATTENTE_RH',
  ACCORDEE = 'ACCORDEE',
  REFUSEE = 'REFUSEE',
  UTILISEE = 'UTILISEE',
  EXPIREE = 'EXPIREE',
}

@Entity('derogations')
@Index('IDX_derogations_employee_status', ['employeeId', 'status'])
@Index('IDX_derogations_status_requested', ['status', 'requestedAt'])
export class Derogation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'leave_type_id', type: 'bigint' })
  leaveTypeId!: number;

  @ManyToOne(() => LeaveType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType!: LeaveType;

  @Column({
    name: 'leave_request_id',
    type: 'bigint',
    nullable: true,
    unique: true,
  })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest | null;

  @Column({ name: 'requested_start_date', type: 'date' })
  requestedStartDate!: string;

  @Column({ name: 'requested_end_date', type: 'date' })
  requestedEndDate!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({
    type: 'enum',
    enum: DerogationStatus,
    default: DerogationStatus.EN_ATTENTE_RH,
  })
  status!: DerogationStatus;

  @Column({
    name: 'requested_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  requestedAt!: Date;

  @Column({ name: 'decided_by_rh_id', type: 'bigint', nullable: true })
  decidedByRhId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_rh_id' })
  decidedByRh!: User | null;

  @Column({ name: 'decision_comment', type: 'text', nullable: true })
  decisionComment!: string | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;
}
