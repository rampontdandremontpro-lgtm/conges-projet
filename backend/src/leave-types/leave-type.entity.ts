import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LeaveTypeCategory {
  DEMANDE_CONGE = 'DEMANDE_CONGE',
  DECLARATION_ABSENCE = 'DECLARATION_ABSENCE',
}

/**
 * JUR-028 — classification métier explicite des absences (persistante et
 * paramétrable par la RH). NON_CLASSIFIE par défaut : aucune déduction ou
 * restitution automatique ne repose sur une simple correspondance de mots.
 */
export enum LeaveTypeAbsenceKind {
  NON_CLASSIFIE = 'NON_CLASSIFIE',
  NON_MEDICAL = 'NON_MEDICAL',
  ARRET_MALADIE = 'ARRET_MALADIE',
  ENFANT_MALADE = 'ENFANT_MALADE',
  AT_MP = 'AT_MP',
  MARIAGE_PACS = 'MARIAGE_PACS',
  MARIAGE_ENFANT = 'MARIAGE_ENFANT',
  PATERNITE_ACCUEIL = 'PATERNITE_ACCUEIL',
  NAISSANCE = 'NAISSANCE',
  ADOPTION = 'ADOPTION',
  DECES = 'DECES',
  DECES_ENFANT = 'DECES_ENFANT',
  DEUIL_ENFANT = 'DEUIL_ENFANT',
  ANNONCE_HANDICAP_ENFANT = 'ANNONCE_HANDICAP_ENFANT',
}

@Entity('leave_types')
export class LeaveType {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 160, unique: true })
  name!: string;

  @Column({ type: 'enum', enum: LeaveTypeCategory })
  category!: LeaveTypeCategory;

  @Column({
    name: 'absence_kind',
    type: 'enum',
    enum: LeaveTypeAbsenceKind,
    default: LeaveTypeAbsenceKind.NON_CLASSIFIE,
  })
  absenceKind!: LeaveTypeAbsenceKind;

  @Column({
    name: 'deducts_paid_leave_balance',
    type: 'boolean',
    default: false,
  })
  deductsPaidLeaveBalance!: boolean;

  @Column({ name: 'document_required', type: 'boolean', default: false })
  documentRequired!: boolean;

  @Column({
    name: 'document_can_be_added_later',
    type: 'boolean',
    default: true,
  })
  documentCanBeAddedLater!: boolean;

  @Column({ name: 'employee_can_create', type: 'boolean', default: true })
  employeeCanCreate!: boolean;

  @Column({ name: 'rh_only', type: 'boolean', default: false })
  rhOnly!: boolean;

  @Column({ name: 'allows_days', type: 'boolean', default: true })
  allowsDays!: boolean;

  @Column({ name: 'allows_half_days', type: 'boolean', default: true })
  allowsHalfDays!: boolean;

  @Column({ name: 'allows_hours', type: 'boolean', default: false })
  allowsHours!: boolean;

  @Column({ name: 'requires_validation', type: 'boolean', default: true })
  requiresValidation!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
