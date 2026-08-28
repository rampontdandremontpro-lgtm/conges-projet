import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Service } from '../services/service.entity';

export enum UserRole {
  COLLABORATEUR = 'COLLABORATEUR',
  RESPONSABLE_SERVICE = 'RESPONSABLE_SERVICE',
  RH = 'RH',
  DIRECTEUR = 'DIRECTEUR',
  ADMIN = 'ADMIN',
}

export enum EmploymentType {
  INTERNE = 'INTERNE',
  EXTERNE = 'EXTERNE',
}

export enum PresenceStatus {
  PRESENT = 'PRESENT',
  EN_VACANCES = 'EN_VACANCES',
  ABSENT = 'ABSENT',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  nom!: string;

  @Column({ type: 'varchar', length: 100 })
  prenom!: string;

  @Column({ type: 'varchar', length: 190, unique: true })
  email!: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;

  @Column({
    name: 'microsoft_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  microsoftId!: string | null;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Column({
    name: 'employment_type',
    type: 'enum',
    enum: EmploymentType,
    default: EmploymentType.INTERNE,
  })
  employmentType!: EmploymentType;

  @Column({ name: 'service_id', type: 'bigint', nullable: true })
  serviceId!: number | null;

  @ManyToOne(() => Service, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'service_id' })
  service!: Service | null;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate!: string | null;

  @Column({
    name: 'presence_status',
    type: 'enum',
    enum: PresenceStatus,
    default: PresenceStatus.PRESENT,
  })
  presenceStatus!: PresenceStatus;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Column({
    name: 'signature_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  signatureType!: string | null;

  @Column({
    name: 'signature_data',
    type: 'longtext',
    nullable: true,
    select: false,
  })
  signatureData!: string | null;

  @Column({
    name: 'signature_updated_at',
    type: 'datetime',
    nullable: true,
  })
  signatureUpdatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
