import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum AccrualAnomalyType {
  ABSENCE_OVERLAP_CONFLICT = 'ABSENCE_OVERLAP_CONFLICT',
  HISTORICAL_PENDING = 'HISTORICAL_PENDING',
  AMBIGUOUS_LEGACY = 'AMBIGUOUS_LEGACY',
}

export enum AccrualAnomalyStatus {
  OPEN = 'OPEN',
  /** Cause présente, mais analyse RH réalisée (décision justifiée, classification retenue appliquée). */
  RH_DECIDED = 'RH_DECIDED',
  /** Cause réellement disparue (recalcul automatique à 0). */
  RESOLVED = 'RESOLVED',
}

/**
 * Mode de résolution : VERIFIED = la cause a réellement disparu (recalcul
 * automatique à 0 jour) ; RH_DECISION = la RH clôture explicitement une
 * anomalie dont la cause subsiste, avec une justification historisée.
 */
export enum AccrualAnomalyResolutionMode {
  VERIFIED = 'VERIFIED',
  RH_DECISION = 'RH_DECISION',
}

/**
 * JUR-025/037 — anomalie d'acquisition PERSISTANTE, retrouvable et résolvable
 * par la RH : chevauchement contradictoire d'absences, journées historiques à
 * valider, ou ancien mouvement d'acquisition ambigu. Chaque anomalie est
 * identifiée par (salarié, type, période, mois) — jamais dupliquée.
 */
/**
 * L'unicité SQL est garantie par la migration
 * 20261031240000-fix-anomaly-uniqueness via des colonnes générées
 * (COALESCE(NULL → '')) : un index UNIQUE sur des colonnes NULL autoriserait
 * des doublons. Aucun @Index décoratif ici pour ne pas recréer un index laxiste.
 */
@Entity('accrual_anomalies')
export class AccrualAnomaly {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ type: 'enum', enum: AccrualAnomalyType })
  type!: AccrualAnomalyType;

  @Column({ name: 'reference_period', type: 'varchar', length: 20 })
  referencePeriod!: string;

  @Column({ name: 'accrual_month', type: 'varchar', length: 7, nullable: true })
  accrualMonth!: string | null;

  /**
   * Identifiant stable du conflit concerné (identifiants triés des déclarations
   * chevauchantes, séparés par des virgules). Permet de scoper une décision RH
   * à UN conflit précis, sans affecter un autre conflit du même mois.
   * Null pour les anomalies non liées à un chevauchement.
   */
  @Column({ name: 'conflict_key', type: 'varchar', length: 200, nullable: true })
  conflictKey!: string | null;

  @Column({ type: 'int', default: 0 })
  days!: number;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({
    type: 'enum',
    enum: AccrualAnomalyStatus,
    default: AccrualAnomalyStatus.OPEN,
  })
  status!: AccrualAnomalyStatus;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by_id', type: 'bigint', nullable: true })
  resolvedById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_id' })
  resolvedBy!: User | null;

  @Column({
    name: 'resolution_mode',
    type: 'enum',
    enum: AccrualAnomalyResolutionMode,
    nullable: true,
  })
  resolutionMode!: AccrualAnomalyResolutionMode | null;

  @Column({ name: 'resolution_reason', type: 'text', nullable: true })
  resolutionReason!: string | null;

  /**
   * Classification d'absence RETENUE par la RH pour résoudre une contradiction
   * (ABSENCE_OVERLAP_CONFLICT). Réellement appliquée par le moteur et
   * historisée. Null si le conflit reste non résolu ou n'est pas un conflit.
   */
  @Column({ name: 'retained_kind', type: 'varchar', length: 40, nullable: true })
  retainedKind!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
