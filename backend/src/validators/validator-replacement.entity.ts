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

import { User } from '../users/user.entity';

@Entity('validator_replacements')
@Index('IDX_validator_replacements_employee_active_dates', [
  'employeeId',
  'isActive',
  'startDate',
  'endDate',
])
export class ValidatorReplacement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'replacement_validator_id', type: 'bigint' })
  replacementValidatorId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'replacement_validator_id' })
  replacementValidator!: User;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'created_by_rh_id', type: 'bigint' })
  createdByRhId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_rh_id' })
  createdByRh!: User;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
