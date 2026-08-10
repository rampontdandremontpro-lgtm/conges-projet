import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum HolidayType {
  NATIONAL = 'NATIONAL',
  MARTINIQUE = 'MARTINIQUE',
  FERMETURE_GMES = 'FERMETURE_GMES',
}

@Entity('holidays')
@Index('UQ_holidays_date_type', ['date', 'holidayType'], { unique: true })
export class Holiday {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ name: 'holiday_type', type: 'enum', enum: HolidayType })
  holidayType!: HolidayType;

  @Column({ type: 'boolean', default: false })
  deductible!: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  source!: string | null;

  @Column({ name: 'created_by_id', type: 'bigint', nullable: true })
  createdById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
