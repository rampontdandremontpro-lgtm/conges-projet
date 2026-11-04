import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export interface BirthEventCorrection {
  reason: string;
  source: string;
  previous: { dateNaissance?: string; nbEnfants?: number };
  next: { dateNaissance?: string; nbEnfants?: number };
  decidedBy: number;
  decidedAt: string;
}

/**
 * JUR-031 — événement de naissance géré par le backend : identifiant fiable et
 * persistant auquel sont rattachées toutes les périodes d'un même congé de
 * paternité. Les informations essentielles (date, nombre d'enfants) ne sont
 * modifiables que par une correction RH justifiée et historisée.
 */
@Entity('birth_events')
@Index('IDX_birth_events_employee_date', ['employeeId', 'dateNaissance'])
export class BirthEvent {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  id!: string;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'date_naissance', type: 'date' })
  dateNaissance!: string;

  @Column({ name: 'nb_enfants', type: 'int' })
  nbEnfants!: number;

  @Column({ name: 'created_by_id', type: 'bigint', nullable: true })
  createdById!: number | null;

  @Column({ name: 'corrections', type: 'json', nullable: true })
  corrections!: BirthEventCorrection[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
