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

import { Service } from '../services/service.entity';
import { User } from '../users/user.entity';

@Entity('service_backup_validators')
@Index(
  'UQ_service_backup_validators_service_validator',
  ['serviceId', 'validatorId'],
  { unique: true },
)
@Index('IDX_service_backup_validators_service_active', [
  'serviceId',
  'isActive',
])
export class ServiceBackupValidator {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'service_id', type: 'bigint' })
  serviceId!: number;

  @ManyToOne(() => Service, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_id' })
  service!: Service;

  @Column({ name: 'validator_id', type: 'bigint' })
  validatorId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'validator_id' })
  validator!: User;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
