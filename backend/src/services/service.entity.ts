import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ServiceType {
  INTERNE = 'INTERNE',
  EXTERNE = 'EXTERNE',
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