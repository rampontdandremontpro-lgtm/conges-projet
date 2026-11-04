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

export enum CarryoverLotOrigin {
  MALADIE = 'MALADIE',
  AT_MP = 'AT_MP',
  AUTRE = 'AUTRE',
}

export enum CarryoverLotRegime {
  GENERAL = 'GENERAL',
  ARRET_LONG = 'ARRET_LONG',
}

export enum CarryoverLotStatus {
  ACTIF = 'ACTIF',
  SUSPENDU = 'SUSPENDU',
  EXPIRE = 'EXPIRE',
  A_VERIFIER = 'A_VERIFIER',
}

export enum CarryoverLotTargetCounter {
  N_MINUS_1 = 'N-1',
  N = 'N',
  N_PLUS_1 = 'N+1',
}

export enum CarryoverLotAbsenceStatus {
  ABSENT = 'ABSENT',
  REPRIS = 'REPRIS',
  INCONNU = 'INCONNU',
}

export enum CarryoverLotConfirmationStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  CONFIRMEE = 'CONFIRMEE',
  REFUSEE = 'REFUSEE',
}

const decimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

const nullableBooleanTransformer = {
  to: (value: boolean | null): boolean | null => value,
  from: (value: number | boolean | null): boolean | null =>
    value === null || value === undefined ? null : Boolean(value),
};

/**
 * JUR-027 — Lot L3 : entité `carryover_lots` (enregistrement, consultation,
 * traçabilité). Structure additive uniquement ; aucune règle de consommation
 * ou d'expiration n'est encore branchée.
 *
 * `remainingDays = null` signifie « quantité inconnue » (jamais zéro jour).
 */
@Entity('carryover_lots')
@Index('IDX_carryover_lots_employee_status', ['employeeId', 'status'])
@Index('IDX_carryover_lots_target', ['targetReferencePeriod', 'targetCounterType'])
@Index('IDX_carryover_lots_expires', ['expiresAt'])
@Index('IDX_carryover_lots_idempotency', ['idempotencyKey'], { unique: true })
export class CarryoverLot {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'source_reference_period', type: 'varchar', length: 20 })
  sourceReferencePeriod!: string;

  @Column({ name: 'target_reference_period', type: 'varchar', length: 20 })
  targetReferencePeriod!: string;

  @Column({
    name: 'target_counter_type',
    type: 'varchar',
    length: 20,
    default: CarryoverLotTargetCounter.N_MINUS_1,
  })
  targetCounterType!: CarryoverLotTargetCounter;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  days!: number;

  @Column({
    name: 'remaining_days',
    type: 'decimal',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  remainingDays!: number | null;

  @Column({ type: 'varchar', length: 20, default: CarryoverLotOrigin.AUTRE })
  origin!: CarryoverLotOrigin;

  @Column({ type: 'varchar', length: 20, default: CarryoverLotRegime.GENERAL })
  regime!: CarryoverLotRegime;

  @Column({ type: 'varchar', length: 20, default: CarryoverLotStatus.A_VERIFIER })
  status!: CarryoverLotStatus;

  @Column({
    name: 'absence_status',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  absenceStatus!: CarryoverLotAbsenceStatus | null;

  @Column({ name: 'absence_start_date', type: 'date', nullable: true })
  absenceStartDate!: string | null;

  @Column({ name: 'absence_end_date', type: 'date', nullable: true })
  absenceEndDate!: string | null;

  @Column({ name: 'reprise_date', type: 'date', nullable: true })
  repriseDate!: string | null;

  @Column({ name: 'information_date', type: 'date', nullable: true })
  informationDate!: string | null;

  @Column({ name: 'information_mode', type: 'varchar', length: 40, nullable: true })
  informationMode!: string | null;

  @Column({
    name: 'information_date_certain',
    type: 'tinyint',
    nullable: true,
    transformer: nullableBooleanTransformer,
  })
  informationDateCertain!: boolean | null;

  @Column({
    name: 'acquired_during_l3141_5_5or7',
    type: 'tinyint',
    nullable: true,
    transformer: nullableBooleanTransformer,
  })
  acquiredDuringL3141_5_5or7!: boolean | null;

  @Column({
    name: 'suspension_at_least_one_year_at_period_end',
    type: 'tinyint',
    nullable: true,
    transformer: nullableBooleanTransformer,
  })
  suspensionAtLeastOneYearAtPeriodEnd!: boolean | null;

  @Column({
    name: 'reconciled',
    type: 'tinyint',
    nullable: true,
    transformer: nullableBooleanTransformer,
  })
  reconciled!: boolean | null;

  @Column({ name: 'proof_id', type: 'bigint', nullable: true })
  proofId!: number | null;

  @Column({
    name: 'confirmation_status',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  confirmationStatus!: CarryoverLotConfirmationStatus | null;

  @Column({ name: 'reference_period_end_date', type: 'date', nullable: true })
  referencePeriodEndDate!: string | null;

  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt!: string | null;

  @Column({ name: 'indicative_expires_at', type: 'date', nullable: true })
  indicativeExpiresAt!: string | null;

  @Column({ name: 'expiry_basis', type: 'text', nullable: true })
  expiryBasis!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 190, nullable: true })
  idempotencyKey!: string | null;

  @Column({ name: 'source_movement_id', type: 'bigint', nullable: true })
  sourceMovementId!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy!: User | null;

  /** Compteur de version pour les mises à jour conditionnelles (anti-écrasement). */
  @Column({ name: 'version', type: 'int', default: 0 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
