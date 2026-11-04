import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * JUR-024 — convention de branche applicable par entité juridique.
 * NON_RENSEIGNEE par défaut : aucune convention n'est présumée. LEGAL = légal
 * supplétif confirmé. L'accord d'entreprise est un champ SÉPARÉ (accordType) :
 * il ne remplace pas la convention de branche (les deux peuvent coexister).
 */
export enum LegalEntityConventionType {
  NON_RENSEIGNEE = 'NON_RENSEIGNEE',
  LEGAL = 'LEGAL',
  SYNTEC = 'SYNTEC',
}

export enum LegalEntityAccordType {
  NONE = 'NONE',
  ACCORD_ENTREPRISE = 'ACCORD_ENTREPRISE',
}

/**
 * JUR-025/037 — décision RH contrôlée et historisée sur le maintien de salaire
 * conventionnel en cas d'arrêt maladie/accident non professionnel (Syntec 5.5).
 * UNKNOWN par défaut : aucune règle plus favorable n'est présumée.
 */
export enum IllnessWageMaintenance {
  UNKNOWN = 'UNKNOWN',
  MAINTIEN_CONVENTIONNEL = 'MAINTIEN_CONVENTIONNEL',
  SANS_MAINTIEN = 'SANS_MAINTIEN',
}

@Entity('legal_entities')
export class LegalEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  // Clé de logo optionnelle. « gmes-logo » correspond au logo historique GMES.
  // Les logos des autres entités pourront être ajoutés plus tard sous une clé dédiée.
  @Column({ name: 'logo_key', type: 'varchar', length: 60, nullable: true })
  logoKey!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({
    name: 'convention_type',
    type: 'enum',
    enum: LegalEntityConventionType,
    default: LegalEntityConventionType.NON_RENSEIGNEE,
  })
  conventionType!: LegalEntityConventionType;

  @Column({ name: 'idcc', type: 'varchar', length: 20, nullable: true })
  idcc!: string | null;

  @Column({
    name: 'convention_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  conventionName!: string | null;

  @Column({
    name: 'accord_type',
    type: 'enum',
    enum: LegalEntityAccordType,
    default: LegalEntityAccordType.NONE,
  })
  accordType!: LegalEntityAccordType;

  @Column({
    name: 'accord_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  accordName!: string | null;

  @Column({ name: 'accord_idcc', type: 'varchar', length: 20, nullable: true })
  accordIdcc!: string | null;

  /**
   * Période de validité ENREGISTRÉE de l'accord d'entreprise : source de
   * vérité pour l'applicabilité d'un maintien de salaire fondé sur l'accord.
   * Les dates fournies librement sur une décision ne suffisent pas.
   */
  @Column({ name: 'accord_valid_from', type: 'date', nullable: true })
  accordValidFrom!: string | null;

  @Column({ name: 'accord_valid_to', type: 'date', nullable: true })
  accordValidTo!: string | null;

  /**
   * Document justificatif VÉRIFIÉ de l'accord (rattaché à l'entité) : les dates
   * de validité de l'accord ne valent preuve que si elles sont adossées à ce
   * document validé par la RH.
   */
  @Column({ name: 'accord_document_id', type: 'bigint', nullable: true })
  accordDocumentId!: number | null;

  @Column({
    name: 'illness_wage_maintenance',
    type: 'enum',
    enum: IllnessWageMaintenance,
    default: IllnessWageMaintenance.UNKNOWN,
  })
  illnessWageMaintenance!: IllnessWageMaintenance;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
