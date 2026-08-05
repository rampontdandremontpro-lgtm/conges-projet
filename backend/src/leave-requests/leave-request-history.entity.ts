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
import {
  LeaveRequest,
  LeaveRequestStatus,
} from './leave-request.entity';

export enum LeaveRequestHistoryAction {
  BROUILLON_CREE = 'BROUILLON_CREE',
  BROUILLON_MODIFIE = 'BROUILLON_MODIFIE',
  DEMANDE_SOUMISE = 'DEMANDE_SOUMISE',
}

@Entity('leave_request_history')
@Index('IDX_leave_request_history_request_created', [
  'leaveRequestId',
  'createdAt',
])
export class LeaveRequestHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    name: 'leave_request_id',
    type: 'int',
  })
  leaveRequestId!: number;

  @ManyToOne(() => LeaveRequest, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest;

  @Column({
    type: 'varchar',
    length: 80,
  })
  action!: LeaveRequestHistoryAction;

  @Column({
    name: 'actor_id',
    type: 'int',
  })
  actorId!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'actor_id' })
  actor!: User;

  @Column({
    name: 'old_status',
    type: 'enum',
    enum: LeaveRequestStatus,
    nullable: true,
  })
  oldStatus!: LeaveRequestStatus | null;

  @Column({
    name: 'new_status',
    type: 'enum',
    enum: LeaveRequestStatus,
    nullable: true,
  })
  newStatus!: LeaveRequestStatus | null;

  @Column({
    type: 'text',
    nullable: true,
  })
  comment!: string | null;

  @Column({
    type: 'json',
    nullable: true,
  })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt!: Date;
}
