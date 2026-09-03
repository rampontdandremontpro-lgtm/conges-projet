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

import { DayPeriod } from '../leave-requests/leave-request.entity';
import { LeaveType } from '../leave-types/leave-type.entity';
import { Service } from '../services/service.entity';
import { User } from '../users/user.entity';

export enum AbsenceDeclarationStatus {
  BROUILLON = 'BROUILLON',
  DECLAREE = 'DECLAREE',
  JUSTIFICATIF_EN_ATTENTE = 'JUSTIFICATIF_EN_ATTENTE',
  A_VERIFIER_PAR_RH = 'A_VERIFIER_PAR_RH',
  JUSTIFICATIF_REJETE = 'JUSTIFICATIF_REJETE',
  JUSTIFICATIF_ATTENDU = 'JUSTIFICATIF_ATTENDU',
  ENREGISTREE = 'ENREGISTREE',
  ANNULEE = 'ANNULEE',
}

const nullableDecimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('absence_declarations')
@Index('IDX_absence_employee_dates', ['employeeId', 'startDate', 'endDate'])
@Index('IDX_absence_status_declared', ['status', 'declaredAt'])
export class AbsenceDeclaration {
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
    nullable: true,
  })
  startPeriod!: DayPeriod | null;

  @Column({
    name: 'end_period',
    type: 'enum',
    enum: DayPeriod,
    nullable: true,
  })
  endPeriod!: DayPeriod | null;

  @Column({
    name: 'duration_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  durationDays!: number | null;

  @Column({
    name: 'duration_hours',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  durationHours!: number | null;

  @Column({
    type: 'enum',
    enum: AbsenceDeclarationStatus,
    default: AbsenceDeclarationStatus.BROUILLON,
  })
  status!: AbsenceDeclarationStatus;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'declared_at', type: 'datetime', nullable: true })
  declaredAt!: Date | null;

  @Column({ name: 'verified_by_rh_id', type: 'bigint', nullable: true })
  verifiedByRhId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_by_rh_id' })
  verifiedByRh!: User | null;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
