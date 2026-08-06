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

export enum ServiceType {
  INTERNE = 'INTERNE',
  EXTERNE = 'EXTERNE',
}

export enum ValidationMode {
  RESPONSABLE_PUIS_RELAIS = 'RESPONSABLE_PUIS_RELAIS',
  DIRECTEUR_ET_RH = 'DIRECTEUR_ET_RH',
  DIRECTEUR_SEUL = 'DIRECTEUR_SEUL',
  SANS_VALIDATION = 'SANS_VALIDATION',
}

@Entity('services')
@Index('UQ_services_name_company', ['name', 'externalCompanyName'], {
  unique: true,
})
export class Service {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ name: 'service_type', type: 'enum', enum: ServiceType })
  serviceType!: ServiceType;

  @Column({
    name: 'external_company_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalCompanyName!: string | null;

  @Column({ name: 'primary_manager_id', type: 'bigint', nullable: true })
  primaryManagerId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'primary_manager_id' })
  primaryManager!: User | null;

  @Column({
    name: 'validation_mode',
    type: 'enum',
    enum: ValidationMode,
    default: ValidationMode.DIRECTEUR_ET_RH,
  })
  validationMode!: ValidationMode;

  @Column({ name: 'takeover_delay_days', type: 'int', default: 7 })
  takeoverDelayDays!: number;

  @Column({ name: 'minimum_presence', type: 'int', nullable: true })
  minimumPresence!: number | null;

  @Column({
    name: 'has_minimum_presence_rule',
    type: 'boolean',
    default: false,
  })
  hasMinimumPresenceRule!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
