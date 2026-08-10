import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum AuditAction {
  BROUILLON_CREE = 'BROUILLON_CREE',
  BROUILLON_MODIFIE = 'BROUILLON_MODIFIE',
  DEMANDE_MODIFIEE_AVANT_DECISION = 'DEMANDE_MODIFIEE_AVANT_DECISION',
  DEMANDE_SOUMISE = 'DEMANDE_SOUMISE',
  DEMANDE_VALIDEE = 'DEMANDE_VALIDEE',
  DEMANDE_REFUSEE = 'DEMANDE_REFUSEE',
  DEMANDE_ANNULEE = 'DEMANDE_ANNULEE',
  CONGE_DIRECTEUR_ENREGISTRE = 'CONGE_DIRECTEUR_ENREGISTRE',
  DEROGATION_DEMANDEE = 'DEROGATION_DEMANDEE',
  DEROGATION_ACCORDEE = 'DEROGATION_ACCORDEE',
  DEROGATION_REFUSEE = 'DEROGATION_REFUSEE',
  DEROGATION_UTILISEE = 'DEROGATION_UTILISEE',
  REPRISE_PAR_RELAIS = 'REPRISE_PAR_RELAIS',
  INTERVENTION_URGENCE = 'INTERVENTION_URGENCE',
  SERVICE_BACKUP_VALIDATOR_ASSIGNED = 'SERVICE_BACKUP_VALIDATOR_ASSIGNED',
  SERVICE_BACKUP_VALIDATOR_DISABLED = 'SERVICE_BACKUP_VALIDATOR_DISABLED',
  SERVICE_BACKUP_VALIDATOR_ENABLED = 'SERVICE_BACKUP_VALIDATOR_ENABLED',
  VALIDATOR_REPLACEMENT_CREATED = 'VALIDATOR_REPLACEMENT_CREATED',
  VALIDATOR_REPLACEMENT_DISABLED = 'VALIDATOR_REPLACEMENT_DISABLED',
  ANNULATION_APRES_VALIDATION_DEMANDEE = 'ANNULATION_APRES_VALIDATION_DEMANDEE',
  ANNULATION_ACCEPTEE_PAR_COLLABORATEUR = 'ANNULATION_ACCEPTEE_PAR_COLLABORATEUR',
  ANNULATION_REFUSEE_PAR_COLLABORATEUR = 'ANNULATION_REFUSEE_PAR_COLLABORATEUR',
  ANNULATION_APRES_VALIDATION_TERMINEE = 'ANNULATION_APRES_VALIDATION_TERMINEE',
}

@Entity('audit_logs')
@Index('IDX_audit_resource', ['resourceType', 'resourceId', 'createdAt'])
@Index('IDX_audit_actor', ['actorId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  @Column({ type: 'varchar', length: 120 })
  action!: AuditAction | string;

  @Column({ name: 'resource_type', type: 'varchar', length: 100 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'bigint', nullable: true })
  resourceId!: number | null;

  @Column({ name: 'old_value', type: 'json', nullable: true })
  oldValue!: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'json', nullable: true })
  newValue!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
