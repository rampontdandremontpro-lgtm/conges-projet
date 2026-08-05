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
import { User } from '../users/user.entity';

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
    precision: 6,
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
    type: 'int',
    default: 1,
  })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
