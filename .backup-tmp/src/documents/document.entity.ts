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
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { User } from '../users/user.entity';

export enum DocumentKind {
  JUSTIFICATIF = 'JUSTIFICATIF',
  PDF_VALIDATION = 'PDF_VALIDATION',
  PDF_ANNULATION = 'PDF_ANNULATION',
}

export enum DocumentStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  ACCEPTE = 'ACCEPTE',
  REJETE = 'REJETE',
  ARCHIVE = 'ARCHIVE',
  SUPPRIME = 'SUPPRIME',
}

const nullableBigintTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('documents')
@Index('IDX_documents_leave_request', ['leaveRequestId'])
@Index('IDX_documents_absence_declaration', ['absenceDeclarationId'])
@Index('IDX_documents_kind_status', ['documentKind', 'status'])
export class Document {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

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

  @Column({ name: 'document_kind', type: 'enum', enum: DocumentKind })
  documentKind!: DocumentKind;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalName!: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 500, unique: true })
  storageKey!: string;

  @Column({
    name: 'mime_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  mimeType!: string | null;

  @Column({
    name: 'file_size',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintTransformer,
  })
  fileSize!: number | null;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.EN_ATTENTE,
  })
  status!: DocumentStatus;

  @Column({ name: 'uploaded_by_id', type: 'bigint' })
  uploadedById!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy!: User;

  @Column({ name: 'verified_by_rh_id', type: 'bigint', nullable: true })
  verifiedByRhId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_by_rh_id' })
  verifiedByRh!: User | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'retention_until', type: 'date', nullable: true })
  retentionUntil!: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'datetime' })
  uploadedAt!: Date;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt!: Date | null;
}
