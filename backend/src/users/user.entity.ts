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
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'varchar',
    length: 100,
  })
  nom!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  prenom!: string;

  @Column({
    type: 'varchar',
    length: 180,
    unique: true,
  })
  email!: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  passwordResetTokenHash!: string | null;

  @Column({
    type: 'datetime',
    nullable: true,
    select: false,
  })
  passwordResetTokenExpiresAt!: Date | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  microsoftId!: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: EmploymentType,
  })
  employmentType!: EmploymentType;

  @Column({
    type: 'date',
  })
  hireDate!: string;

  @Column({
    type: 'enum',
    enum: PresenceStatus,
    default: PresenceStatus.PRESENT,
  })
  presenceStatus!: PresenceStatus;

  @Column({
    type: 'boolean',
    default: true,
  })
  isActive!: boolean;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
