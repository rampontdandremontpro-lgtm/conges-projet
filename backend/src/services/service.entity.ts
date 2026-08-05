import {
  Column,
  CreateDateColumn,
  Entity,
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
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'varchar',
    length: 150,
    unique: true,
  })
  name!: string;

  @Column({
    type: 'enum',
    enum: ServiceType,
  })
  serviceType!: ServiceType;

  @Column({
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  externalCompanyName!: string | null;

  @Column({
    type: 'int',
    nullable: true,
  })
  primaryManagerId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'primaryManagerId' })
  primaryManager!: User | null;

  @Column({
    type: 'enum',
    enum: ValidationMode,
    default: ValidationMode.DIRECTEUR_ET_RH,
  })
  validationMode!: ValidationMode;

  @Column({
    type: 'int',
    default: 7,
  })
  takeoverDelayDays!: number;

  @Column({
    type: 'int',
    default: 0,
  })
  minimumPresence!: number;

  @Column({
    type: 'boolean',
    default: false,
  })
  hasMinimumPresenceRule!: boolean;

  @Column({
    type: 'boolean',
    default: true,
  })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
