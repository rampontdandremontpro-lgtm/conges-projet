import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { User } from '../users/user.entity';

export enum GeneratedDocumentType {
  VALIDATION_PDF = 'VALIDATION_PDF',
  CANCELLATION_PDF = 'CANCELLATION_PDF',
}

@Entity('generated_documents')
export class GeneratedDocument {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'int',
  })
  leaveRequestId!: number;

  @ManyToOne(() => LeaveRequest, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'leaveRequestId',
  })
  leaveRequest!: LeaveRequest;

  @Column({
    type: 'int',
    nullable: true,
  })
  leaveCancellationId!: number | null;

  @Column({
    type: 'enum',
    enum: GeneratedDocumentType,
  })
  documentType!: GeneratedDocumentType;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  referenceNumber!: string;

  @Column({
    type: 'varchar',
    length: 500,
    unique: true,
  })
  storageKey!: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  checksum!: string | null;

  @CreateDateColumn()
  generatedAt!: Date;

  @Column({
    type: 'int',
    nullable: true,
  })
  generatedByUserId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'generatedByUserId',
  })
  generatedByUser!: User | null;
}
