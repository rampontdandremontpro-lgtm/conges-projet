import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
