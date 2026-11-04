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

export enum CarryoverNotificationStatus {
  BROUILLON = 'BROUILLON',
  VALIDEE_PAR_RH = 'VALIDEE_PAR_RH',
  TRANSMISSION_ENREGISTREE = 'TRANSMISSION_ENREGISTREE',
  RECEPTION_A_JUSTIFIER = 'RECEPTION_A_JUSTIFIER',
  RECEPTION_VERIFIEE = 'RECEPTION_VERIFIEE',
  A_CORRIGER = 'A_CORRIGER',
  ANNULEE = 'ANNULEE',
}

export enum CarryoverNotificationTransmissionMode {
  MAIN_PROPRE = 'MAIN_PROPRE',
  COURRIER_RECOMMANDE = 'COURRIER_RECOMMANDE',
  ELECTRONIQUE_FIABLE = 'ELECTRONIQUE_FIABLE',
  BULLETIN_PAIE = 'BULLETIN_PAIE',
  AUTRE = 'AUTRE',
  SIMULATION = 'SIMULATION',
}

export interface CarryoverNotificationRight {
  lotId: number;
  sourceReferencePeriod: string;
  regime: 'GENERAL' | 'ARRET_LONG';
  days: number;
  deadlinePrevisionnel: string | null;
  deadlineDefinitif: string | null;
  needsReview: boolean;
  status: string;
}

export interface CarryoverNotificationContent {
  employeeId: number;
  employeeName: string;
  establishedAt: string;
  repriseDate: string | null;
  rights: CarryoverNotificationRight[];
  totals: { confirmedDays: number; toReviewDays: number };
  emittedBy: string;
}

/**
 * JUR-027 — Lot L6 : notification individuelle d'information des salariés
 * (droits reportés pour maladie). La transmission n'implique jamais la
 * réception : la réception n'est confirmée que par une preuve contrôlée.
 */
@Entity('carryover_notifications')
@Index('IDX_carryover_notifications_employee', ['employeeId'])
@Index('IDX_carryover_notifications_status', ['status'])
export class CarryoverNotification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 80, unique: true })
  reference!: string;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({
    type: 'varchar',
    length: 30,
    default: CarryoverNotificationStatus.BROUILLON,
  })
  status!: CarryoverNotificationStatus;

  @Column({ name: 'established_at', type: 'date', nullable: true })
  establishedAt!: string | null;

  @Column({ name: 'reprise_date', type: 'date', nullable: true })
  repriseDate!: string | null;

  @Column({ name: 'content_json', type: 'json', nullable: true })
  contentJson!: CarryoverNotificationContent | null;

  @Column({ name: 'transmission_mode', type: 'varchar', length: 40, nullable: true })
  transmissionMode!: CarryoverNotificationTransmissionMode | null;

  @Column({ name: 'transmitted_at', type: 'datetime', precision: 6, nullable: true })
  transmittedAt!: Date | null;

  @Column({ name: 'expected_receipt_date', type: 'date', nullable: true })
  expectedReceiptDate!: string | null;

  /** Clé d'unicité des notifications actives : `A:<employeeId>` (NULL si inactive). */
  @Column({ name: 'active_key', type: 'varchar', length: 60, nullable: true, unique: true })
  activeKey!: string | null;

  @Column({ name: 'document_reference', type: 'varchar', length: 80, nullable: true })
  documentReference!: string | null;

  @Column({ name: 'document_checksum', type: 'varchar', length: 64, nullable: true })
  documentChecksum!: string | null;

  @Column({ name: 'transmitted_content_json', type: 'json', nullable: true })
  transmittedContentJson!: CarryoverNotificationContent | null;

  @Column({ name: 'coherence_anomaly', type: 'tinyint', nullable: true })
  coherenceAnomaly!: boolean | null;

  @Column({ name: 'coherence_note', type: 'text', nullable: true })
  coherenceNote!: string | null;

  @Column({ name: 'corrected_from_id', type: 'bigint', nullable: true })
  correctedFromId!: number | null;

  @Column({ name: 'version', type: 'int', default: 0 })
  version!: number;

  @Column({ name: 'created_by_id', type: 'bigint', nullable: true })
  createdById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
