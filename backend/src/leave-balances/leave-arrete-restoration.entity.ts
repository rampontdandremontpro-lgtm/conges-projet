import {
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
import { LeaveBalance } from './leave-balance.entity';

const decimalTransformer = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

/**
 * JUR-028 — restitution des jours de congé couverts par un arrêt maladie.
 *
 * Trace, pour chaque couple (arrêt maladie, congé validé), le nombre de jours
 * de congé restitués (non perdus) et l'état de restitution (éventuellement
 * annulée). Idempotent grâce à l'unicité (absence, demande de congé).
 */
@Entity('leave_arrete_restaurations')
@Index('UQ_arrete_rest_absence_leave', ['absenceDeclarationId', 'leaveRequestId'], {
  unique: true,
})
export class LeaveArreteRestoration {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'absence_declaration_id', type: 'bigint' })
  absenceDeclarationId!: number;

  @ManyToOne(() => AbsenceDeclaration, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'absence_declaration_id' })
  absenceDeclaration!: AbsenceDeclaration;

  @Column({ name: 'leave_request_id', type: 'bigint' })
  leaveRequestId!: number;

  @ManyToOne(() => LeaveRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest;

  @Column({ name: 'leave_balance_id', type: 'bigint' })
  leaveBalanceId!: number;

  @ManyToOne(() => LeaveBalance, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_balance_id' })
  leaveBalance!: LeaveBalance;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 2,
    transformer: decimalTransformer,
  })
  days!: number;

  /** Liste datée des journées restituées (trace déterministe, JSON). */
  @Column({ name: 'dates_json', type: 'text' })
  datesJson!: string;

  @Column({ name: 'reversed_at', type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
