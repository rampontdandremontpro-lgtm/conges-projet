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

export enum HolidayType {
  NATIONAL = 'NATIONAL',
  MARTINIQUE = 'MARTINIQUE',
  FERMETURE_GMES = 'FERMETURE_GMES',
}

@Entity('holidays')
@Index(['date', 'holidayType'], { unique: true })
export class Holiday {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column({
    type: 'varchar',
    length: 180,
  })
  name!: string;

  @Column({
    type: 'enum',
    enum: HolidayType,
  })
  holidayType!: HolidayType;

  @Column({
    type: 'boolean',
    default: false,
  })
  deductible!: boolean;

  @Column({
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  source!: string | null;

  @Column({
    type: 'int',
    nullable: true,
  })
  createdById!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User | null;

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
