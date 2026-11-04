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

import { Document } from '../documents/document.entity';
import { User } from '../users/user.entity';

export enum IllnessMaintenanceBasis {
  SYNTEC_5_5 = 'SYNTEC_5_5',
  ACCORD_ENTREPRISE = 'ACCORD_ENTREPRISE',
  CONTRACTUEL = 'CONTRACTUEL',
  AUTRE = 'AUTRE',
}

/**
 * Statut de validation du fondement :
 *  - PROPOSED = proposition RH à examiner (validité non vérifiable) — jamais
 *    appliquée au calcul.
 *  - VALIDATED = décision applicable (fondement effectivement enregistré et
 *    valide sur la période).
 *  - LEGACY_PENDING = décision antérieure à la structuration des fondements :
 *    validité indéterminée. Les droits déjà acquis sont CONSERVÉS (pas de
 *    régularisation négative automatique) et une vérification RH traçable est
 *    attendue (validation explicite → VALIDATED, ou invalidation → PROPOSED).
 */
export enum IllnessMaintenanceBasisStatus {
  PROPOSED = 'PROPOSED',
  VALIDATED = 'VALIDATED',
  LEGACY_PENDING = 'LEGACY_PENDING',
}

/**
 * JUR-025/037 — décision RH individuelle, contrôlée et historisée, sur le
 * maintien de salaire conventionnel d'un arrêt maladie/accident non
 * professionnel (Syntec 5.5). Elle précise le SALARIÉ, la PÉRIODE réelle
 * couverte, le FONDEMENT, la JUSTIFICATION et le DÉCIDEUR. C'est cette décision
 * (et non le simple paramétrage de l'entité) qui prouve l'assimilation au
 * travail effectif pour les jours couverts.
 */
@Entity('illness_maintenance_decisions')
@Index('IDX_illness_maintenance_employee_dates', [
  'employeeId',
  'startDate',
  'endDate',
])
export class IllnessMaintenanceDecision {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'employee_id', type: 'bigint' })
  employeeId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: User;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: IllnessMaintenanceBasis,
    default: IllnessMaintenanceBasis.SYNTEC_5_5,
  })
  basis!: IllnessMaintenanceBasis;

  @Column({ type: 'text' })
  justification!: string;

  /**
   * Référence du fondement réellement applicable (disposition contractuelle,
   * conventionnelle ou accord précis, avec période d'application). Obligatoire
   * pour ACCORD_ENTREPRISE et AUTRE : un simple intitulé (accord_name) ou une
   * justification libre ne suffit pas à établir un droit.
   */
  @Column({ name: 'basis_reference', type: 'varchar', length: 500, nullable: true })
  basisReference!: string | null;

  @Column({ name: 'basis_valid_from', type: 'date', nullable: true })
  basisValidFrom!: string | null;

  @Column({ name: 'basis_valid_to', type: 'date', nullable: true })
  basisValidTo!: string | null;

  @Column({
    name: 'basis_validation_status',
    type: 'enum',
    enum: IllnessMaintenanceBasisStatus,
    default: IllnessMaintenanceBasisStatus.PROPOSED,
  })
  basisValidationStatus!: IllnessMaintenanceBasisStatus;

  @Column({ name: 'basis_document_id', type: 'bigint', nullable: true })
  basisDocumentId!: number | null;

  @ManyToOne(() => Document, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'basis_document_id' })
  basisDocument!: Document | null;

  @Column({ name: 'decided_by_id', type: 'bigint', nullable: true })
  decidedById!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_id' })
  decidedBy!: User | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
