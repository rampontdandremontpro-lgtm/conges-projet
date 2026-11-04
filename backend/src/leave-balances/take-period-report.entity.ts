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

import { Document } from '../documents/document.entity';
import { User } from '../users/user.entity';

/**
 * JUR-023 — report ordinaire de la période de prise (demande écrite de
 * l'employeur). Les reports après maladie utilisent les mécanismes JUR-027
 * (report exceptionnel), sans doublon avec cette table.
 */
@Entity('take_period_reports')
@Index('UQ_take_period_reports_emp_period', ['employeeId', 'referencePeriod'], {
  unique: true,
})
export class TakePeriodReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'reference_period', type: 'varchar', length: 20 })
  referencePeriod!: string;

  @Column({ name: 'requested_by_id', type: 'bigint' })
  requestedById!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy!: User;

  @Column({ type: 'text' })
  justification!: string;

  /** Preuve de la demande écrite : document réellement conservé dans l'application. */
  @Column({ name: 'document_id', type: 'bigint', nullable: true })
  documentId!: number | null;

  @ManyToOne(() => Document, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document!: Document | null;

  @Column({ name: 'new_deadline', type: 'date' })
  newDeadline!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
