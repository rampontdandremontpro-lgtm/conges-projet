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

import { User } from '../../users/user.entity';
import { CarryoverNotification } from './carryover-notification.entity';

export enum CarryoverReceptionProofMode {
  MAIN_PROPRE = 'MAIN_PROPRE',
  COURRIER_RECOMMANDE = 'COURRIER_RECOMMANDE',
  ELECTRONIQUE_FIABLE = 'ELECTRONIQUE_FIABLE',
  BULLETIN_PAIE = 'BULLETIN_PAIE',
  AUTRE = 'AUTRE',
  /** Strictement réservé aux fixtures de recette (jamais un raccourci métier). */
  SIMULATION = 'SIMULATION',
}

export enum CarryoverReceptionProofStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  VERIFIE = 'VERIFIE',
  REJETE = 'REJETE',
  INVALIDE = 'INVALIDE',
}

export interface CarryoverReceptionProofHistoryEntry {
  at: string;
  action: string;
  actorId: number | null;
  detail: string;
}

/**
 * JUR-027 — Lot L6 : preuve de réception d'une notification individuelle.
 * Chaque mode possède ses propres contrôles ; une preuve n'est jamais
 * considérée comme suffisante sans vérification RH explicite.
 */
@Entity('carryover_reception_proofs')
@Index('IDX_carryover_reception_proofs_notification', ['notificationId'])
@Index('IDX_carryover_reception_proofs_employee', ['employeeId'])
export class CarryoverReceptionProof {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'notification_id', type: 'bigint' })
  notificationId!: number;

  @ManyToOne(() => CarryoverNotification, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_id' })
  notification!: CarryoverNotification;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ type: 'varchar', length: 40 })
  mode!: CarryoverReceptionProofMode;

  @Column({ name: 'received_at', type: 'datetime', precision: 6, nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'proof_reference', type: 'varchar', length: 255, nullable: true })
  proofReference!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum!: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: true })
  storageKey!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize!: number | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: CarryoverReceptionProofStatus.EN_ATTENTE,
  })
  status!: CarryoverReceptionProofStatus;

  @Column({ name: 'verified_by_id', type: 'bigint', nullable: true })
  verifiedById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_by_id' })
  verifiedBy!: User | null;

  @Column({ name: 'verified_at', type: 'datetime', precision: 6, nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'verification_result', type: 'varchar', length: 30, nullable: true })
  verificationResult!: string | null;

  @Column({ name: 'verification_note', type: 'text', nullable: true })
  verificationNote!: string | null;

  @Column({ name: 'simulation', type: 'tinyint', nullable: true })
  simulation!: boolean | null;

  @Column({ name: 'history_json', type: 'json', nullable: true })
  historyJson!: CarryoverReceptionProofHistoryEntry[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
