import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'setting_key', type: 'varchar', length: 150, unique: true })
  settingKey!: string;

  @Column({ name: 'setting_value', type: 'text' })
  settingValue!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'updated_by_id', type: 'bigint', nullable: true })
  updatedById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: User | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
