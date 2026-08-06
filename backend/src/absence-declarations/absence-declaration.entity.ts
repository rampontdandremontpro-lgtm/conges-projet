import {
  Column,
  CreateDateColumn,
  Entity,
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
  ENREGISTREE = 'ENREGISTREE',
  ANNULEE = 'ANNULEE',
}

const nullableDecimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('absence_declarations')
export class AbsenceDeclaration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  employeeId!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employeeId' })
  employee!: User;

  @Column({ type: 'int' })
  createdById!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User;

  @Column({ type: 'int' })
  leaveTypeId!: number;

  @ManyToOne(() => LeaveType, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'leaveTypeId' })
  leaveType!: LeaveType;

  @Column({ type: 'int' })
  serviceId!: number;

  @ManyToOne(() => Service, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'serviceId' })
  service!: Service;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
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
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  durationDays!: number | null;

  @Column({
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

  @Column({ type: 'datetime', nullable: true })
  declaredAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  verifiedByRhId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'verifiedByRhId' })
  verifiedByRh!: User | null;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
