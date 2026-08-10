import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { Derogation } from '../derogations/derogation.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { User } from '../users/user.entity';

export enum NotificationChannel {
  APPLICATION = 'APPLICATION',
  EMAIL = 'EMAIL',
  LES_DEUX = 'LES_DEUX',
}

@Entity('notifications')
@Index('IDX_notifications_user_read', ['userId', 'readAt'])
@Index('IDX_notifications_type_created', ['type', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    default: NotificationChannel.LES_DEUX,
  })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'leave_request_id', type: 'bigint', nullable: true })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest | null;

  @Column({
    name: 'absence_declaration_id',
    type: 'bigint',
    nullable: true,
  })
  absenceDeclarationId!: number | null;

  @ManyToOne(() => AbsenceDeclaration, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'absence_declaration_id' })
  absenceDeclaration!: AbsenceDeclaration | null;

  @Column({ name: 'derogation_id', type: 'bigint', nullable: true })
  derogationId!: number | null;

  @ManyToOne(() => Derogation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'derogation_id' })
  derogation!: Derogation | null;

  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'email_sent_at', type: 'datetime', nullable: true })
  emailSentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
