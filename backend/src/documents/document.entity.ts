import {
  Check,
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

const bigintTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

@Entity('documents')
@Index('IDX_documents_kind_status', ['documentKind', 'status'])
@Index('IDX_documents_leave_request', ['leaveRequestId'])
@Index('IDX_documents_absence_declaration', [
  'absenceDeclarationId',
])
@Check(
  'CHK_documents_single_parent',
  '((`leaveRequestId` IS NOT NULL AND `absenceDeclarationId` IS NULL) OR (`leaveRequestId` IS NULL AND `absenceDeclarationId` IS NOT NULL))',
)
export class Document {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', nullable: true })
  leaveRequestId!: number | null;

  @ManyToOne(() => LeaveRequest, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'leaveRequestId' })
  leaveRequest!: LeaveRequest | null;

  @Column({ type: 'int', nullable: true })
  absenceDeclarationId!: number | null;

  @ManyToOne(() => AbsenceDeclaration, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'absenceDeclarationId' })
  absenceDeclaration!: AbsenceDeclaration | null;

  @Column({
    type: 'enum',
    enum: DocumentKind,
    default: DocumentKind.JUSTIFICATIF,
  })
  documentKind!: DocumentKind;

  @Column({ type: 'varchar', length: 255 })
  originalName!: string;

  @Column({ type: 'varchar', length: 500, unique: true })
  storageKey!: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({
    type: 'bigint',
    transformer: bigintTransformer,
  })
  fileSize!: number;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.EN_ATTENTE,
  })
  status!: DocumentStatus;

  @Column({ type: 'int' })
  uploadedById!: number;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'uploadedById' })
  uploadedBy!: User;

  @Column({ type: 'int', nullable: true })
  verifiedByRhId!: number | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'verifiedByRhId' })
  verifiedByRh!: User | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'date', nullable: true })
  retentionUntil!: string | null;

  @CreateDateColumn()
  uploadedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  deletedAt!: Date | null;
}
