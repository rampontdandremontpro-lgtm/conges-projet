import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import mysql from 'mysql2/promise';
import { DataSource } from 'typeorm';

import { AuditLog } from '../src/audit/audit-log.entity';
import { AuditService } from '../src/audit/audit.service';
import { BalanceMovement } from '../src/leave-balances/balance-movement.entity';
import { CarryoverLot } from '../src/leave-balances/carryover-lot.entity';
import { CarryoverLotLedgerService } from '../src/leave-balances/carryover-lots/carryover-lot-ledger.service';
import { CarryoverLotAllocation } from '../src/leave-balances/carryover-lots/carryover-lot-allocation.entity';
import { LeaveBalance } from '../src/leave-balances/leave-balance.entity';
import { LegalEntity } from '../src/legal-entities/legal-entity.entity';
import { Service } from '../src/services/service.entity';
import { User } from '../src/users/user.entity';
import { LeaveRequest } from '../src/leave-requests/leave-request.entity';
import { LeaveType } from '../src/leave-types/leave-type.entity';

const day = (date: string, value = 1) => ({ date, value });

describe('CarryoverLotLedgerService (e2e — gestion transactionnelle des lots)', () => {
  let moduleRef: TestingModule;
  let ledger: CarryoverLotLedgerService;
  let db: mysql.Connection;

  const tag = `E2${Date.now().toString(36)}`;

  const q = async (sql: string, params: unknown[] = []): Promise<any> => {
    const [rows] = await db.query(sql, params);
    return rows;
  };
  const one = async (sql: string, params: unknown[] = []) => {
    const rows = await q(sql, params);
    return Array.isArray(rows) ? rows[0] : undefined;
  };
  const insert = async (sql: string, params: unknown[] = []): Promise<number> => {
    const rows = await q(sql, params);
    return Number(rows?.insertId);
  };

  const newEmployee = async (suffix: string): Promise<number> =>
    insert(
      `INSERT INTO users (nom, prenom, email, password_hash, role, employment_type, presence_status, is_active, must_change_password)
       VALUES (?, 'Recette', ?, 'x', 'COLLABORATEUR', 'INTERNE', 'PRESENT', 1, 0)`,
      [`E2-${tag}-${suffix}`, `${tag}-${suffix}@recette.fr`],
    );

  let leaveTypeCounter = 0;
  const newLeaveType = async (): Promise<number> => {
    leaveTypeCounter += 1;
    return insert(
      `INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)`,
      [`CP-${tag}-${leaveTypeCounter}`],
    );
  };

  const addBalance = async (emp: number, period: string, counter: string, available: number) =>
    insert(
      `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [emp, period, counter, available, available],
    );

  const addLot = async (emp: number, opts: {
    key: string; days: number; remaining: number | null; status: string;
    expires: string | null; confirmation: string; reconciled: number; targetPeriod: string;
  }): Promise<number> =>
    insert(
      `INSERT INTO carryover_lots
         (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version)
       VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', ?, '2026-06-25', 1, ?, ?, ?, 'L3141-19-1', ?, 0)`,
      [emp, opts.targetPeriod, opts.days, opts.remaining, opts.status, opts.confirmation, opts.reconciled, opts.expires, `${tag}-${emp}-${opts.key}`],
    );

  const addRequest = async (emp: number, lt: number, deducted = 2): Promise<number> =>
    insert(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status)
       VALUES (?, ?, '2027-05-01', '2027-05-02', ?, ?, 'VALIDEE', 'DEFINITIF')`,
      [emp, lt, deducted, deducted],
    );

  beforeAll(async () => {
    db = await mysql.createConnection({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USERNAME ?? 'root',
      password: process.env.DB_PASSWORD ?? 'root',
      database: process.env.DB_DATABASE ?? 'gestion_conges_gmes_test',
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'mysql',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 3306),
          username: process.env.DB_USERNAME ?? 'root',
          password: process.env.DB_PASSWORD ?? 'root',
          database: process.env.DB_DATABASE ?? 'gestion_conges_gmes_test',
          autoLoadEntities: true,
          synchronize: false,
          supportBigNumbers: true,
          bigNumberStrings: false,
        }),
        TypeOrmModule.forFeature([
          CarryoverLot,
          CarryoverLotAllocation,
          LeaveBalance,
          BalanceMovement,
          LeaveRequest,
          LeaveType,
          User,
          Service,
          LegalEntity,
          AuditLog,
        ]),
      ],
      providers: [CarryoverLotLedgerService, AuditService],
    }).compile();

    ledger = moduleRef.get(CarryoverLotLedgerService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await db.end();
  });

  it('réservation valide (lot décrémenté, compteur réservé, mouvement unique)', async () => {
    const emp = await newEmployee('reserve');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'r1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({
      employeeId: emp,
      leaveRequestId: reqId,
      datedDays: [day('2027-05-01'), day('2027-05-02')],
    });

    expect(result.operation).toBe('RESERVE');
    expect(result.totalLotDays).toBe(2);
    expect(result.uncovered).toHaveLength(0);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days, available_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0);
    expect(Number(bal.reserved_days)).toBe(2);
    expect(Number(bal.available_days)).toBe(10);
    expect(Number(bal.consumed_days)).toBe(0);

    const movements = await q('SELECT movement_type FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(movements).toHaveLength(1);
    expect(movements[0].movement_type).toBe('RESERVATION');
  });

  it('consommation valide d’une réservation (débit effectif)', async () => {
    const emp = await newEmployee('consume');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'c1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    const result = await ledger.consume({ leaveRequestId: reqId });

    expect(result.operation).toBe('CONSUME');
    expect(result.totalLotDays).toBe(2);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days, available_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0); // déjà réservé, non redécrémenté
    expect(Number(bal.reserved_days)).toBe(0);
    expect(Number(bal.available_days)).toBe(8);
    expect(Number(bal.consumed_days)).toBe(2);

    const moves = await q('SELECT movement_type FROM balance_movements WHERE leave_request_id=? ORDER BY id', [reqId]);
    expect(moves.map((m: any) => m.movement_type)).toEqual(['RESERVATION', 'DEDUCTION']);
  });

  it('libération d’une réservation (lot restitué)', async () => {
    const emp = await newEmployee('release');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'rel1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    const result = await ledger.release({ leaveRequestId: reqId });

    expect(result.operation).toBe('RELEASE');
    expect(result.totalLotDays).toBe(2);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days, available_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(2);
    expect(Number(bal.reserved_days)).toBe(0);
    expect(Number(bal.available_days)).toBe(10);
  });

  it('restitution des jours consommés (recrédit)', async () => {
    const emp = await newEmployee('restore');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'rst1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    await ledger.consume({ leaveRequestId: reqId });
    const result = await ledger.restore({ leaveRequestId: reqId });

    expect(result.operation).toBe('RESTORE');
    expect(result.totalLotDays).toBe(2);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days, available_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(2);
    expect(Number(bal.available_days)).toBe(10);
    expect(Number(bal.consumed_days)).toBe(0);

    const moves = await q('SELECT movement_type FROM balance_movements WHERE leave_request_id=? ORDER BY id', [reqId]);
    expect(moves.map((m: any) => m.movement_type)).toEqual(['RESERVATION', 'DEDUCTION', 'RECREDIT']);
  });

  it('opération répétée → refusée (aucun doublon)', async () => {
    const emp = await newEmployee('repeat');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'rp1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    let status = 0;
    try {
      await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    } catch (error: any) {
      status = error?.getStatus?.() ?? error?.status ?? 0;
    }
    expect(status).toBe(409);

    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    const allocs = await q('SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(1);
    expect(Number(allocs[0].n)).toBe(1);
  });

  it('deux opérations simultanées sur le même lot → une seule gagnante', async () => {
    const emp = await newEmployee('concurrent');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'cc1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const outcomes = await Promise.allSettled([
      ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] }),
      ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled').length;
    const rejected = outcomes.filter((o) => o.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);

    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=? AND movement_type=?', [reqId, 'RESERVATION']);
    expect(Number(moves[0].n)).toBe(1);
  });

  it('solde insuffisant → pas de dépassement, jours non couverts signalés', async () => {
    const emp = await newEmployee('insufficient');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'ins1', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(1);
    expect(result.uncovered).toEqual([{ date: '2027-05-02', value: 1 }]);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(0); // jamais négatif
  });

  it('lot expiré → jamais mobilisé', async () => {
    const emp = await newEmployee('expired');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'exp1', days: 2, remaining: 2, status: 'EXPIRE', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.uncovered).toHaveLength(2);
    expect(result.skipped.map((s) => s.reason)).toEqual(['STATUT_EXPIRE']);
  });

  it('lot suspendu → jamais mobilisé', async () => {
    const emp = await newEmployee('suspended');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'sus1', days: 2, remaining: 2, status: 'SUSPENDU', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['STATUT_SUSPENDU']);
  });

  it('lot gelé (à vérifier) → jamais mobilisé', async () => {
    const emp = await newEmployee('frozen');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'frz1', days: 2, remaining: 2, status: 'A_VERIFIER', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['STATUT_A_VERIFIER']);
  });

  it('reliquat inconnu → jamais mobilisé', async () => {
    const emp = await newEmployee('unknown');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'unk1', days: 2, remaining: null, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['RELIQUAT_INCONNU']);
  });

  it('plusieurs lots, échéances différentes → FIFO sans mélange', async () => {
    const emp = await newEmployee('fifo');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lot1 = await addLot(emp, { key: 'f1', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-08-01', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const lot2 = await addLot(emp, { key: 'f2', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-08-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-08-01'), day('2027-08-02')] });

    expect(result.allocations.map((a) => a.lotId)).toEqual([lot1, lot2]);
    expect(result.uncovered).toHaveLength(0);
  });

  it('demi-journée → découpe exacte', async () => {
    const emp = await newEmployee('half');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'h1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 0.5);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01', 0.5)] });

    expect(result.totalLotDays).toBe(0.5);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(1.5);
  });

  it('compteur absent → refus avant toute écriture (aucune écriture partielle)', async () => {
    const emp = await newEmployee('rollback');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10); // pas de compteur pour 2024-2025
    const lot1 = await addLot(emp, { key: 'rb1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const lot2 = await addLot(emp, { key: 'rb2', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2024-2025' });
    const reqId = await addRequest(emp, lt, 3);

    let status = 0;
    try {
      await ledger.reserve({
        employeeId: emp,
        leaveRequestId: reqId,
        datedDays: [day('2027-05-01'), day('2027-05-02'), day('2027-05-03')],
      });
    } catch (error: any) {
      status = error?.getStatus?.() ?? error?.status ?? 500;
    }
    expect(status).toBe(400); // compteur absent → BadRequestException

    const lot1After = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1]);
    const lot2After = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2]);
    expect(Number(lot1After.remaining_days)).toBe(2); // rollback
    expect(Number(lot2After.remaining_days)).toBe(2);

    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    const allocs = await q('SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
    expect(Number(allocs[0].n)).toBe(0);
  });

  // ── E2-bis · Section 2 : droits disponibles réels ────────────────────────
  it('lot possédant plus de jours que le compteur disponible → refus (400), aucune écriture', async () => {
    const emp = await newEmployee('cap1');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 3);
    const lotId = await addLot(emp, { key: 'cap1', days: 5, remaining: 5, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    let status = 0;
    try {
      await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(5);
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
  });

  it('compteur déjà réservé : la capacité restante est respectée (pas de sur-réservation)', async () => {
    const emp = await newEmployee('cap2');
    const lt = await newLeaveType();
    const balId = await addBalance(emp, '2025-2026', 'N-1', 10);
    await q('UPDATE leave_balances SET reserved_days = 7 WHERE id=?', [balId]);
    const lotId = await addLot(emp, { key: 'cap2', days: 5, remaining: 5, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 5);

    let status = 0;
    try {
      await ledger.reserve({
        employeeId: emp,
        leaveRequestId: reqId,
        datedDays: [day('2027-05-01'), day('2027-05-02'), day('2027-05-03'), day('2027-05-04'), day('2027-05-05')],
      });
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one('SELECT reserved_days, available_days FROM leave_balances WHERE id=?', [balId]);
    expect(Number(lot.remaining_days)).toBe(5);
    expect(Number(bal.reserved_days)).toBe(7);
    expect(Number(bal.available_days)).toBe(10);
  });

  it('plusieurs demandes sur le même compteur : pas de sur-réservation', async () => {
    const emp = await newEmployee('cap3');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 4);
    const lotId = await addLot(emp, { key: 'cap3', days: 4, remaining: 4, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqA = await addRequest(emp, lt, 3);
    const reqB = await addRequest(emp, lt, 3);

    const a = await ledger.reserve({ employeeId: emp, leaveRequestId: reqA, datedDays: [day('2027-05-01'), day('2027-05-02'), day('2027-05-03')] });
    const b = await ledger.reserve({ employeeId: emp, leaveRequestId: reqB, datedDays: [day('2027-06-01'), day('2027-06-02'), day('2027-06-03')] });

    expect(a.totalLotDays).toBe(3);
    expect(b.totalLotDays).toBe(1);
    expect(b.uncovered).toHaveLength(2);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days, available_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0);
    expect(Number(bal.reserved_days)).toBe(4); // jamais > disponible
    expect(Number(bal.available_days)).toBe(4);
  });

  it('allocation partielle : jours non couverts ne créent aucun droit ordinaire artificiel', async () => {
    const emp = await newEmployee('cap4');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'cap4', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(1);
    expect(result.uncovered).toEqual([{ date: '2027-05-02', value: 1 }]);
    const moves = await q('SELECT movement_type, days FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(moves).toHaveLength(1);
    expect(moves[0].movement_type).toBe('RESERVATION');
    expect(Number(moves[0].days)).toBe(1);
    const bal = await one("SELECT available_days, reserved_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(bal.available_days)).toBe(10); // inchangé
    expect(Number(bal.reserved_days)).toBe(1);
  });

  // ── E2-bis · Section 3 : concurrence renforcée ───────────────────────────
  it('deux demandes différentes réservent simultanément les mêmes lots', async () => {
    const emp = await newEmployee('conc2');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 4);
    const lotId = await addLot(emp, { key: 'cc2', days: 4, remaining: 4, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqA = await addRequest(emp, lt, 2);
    const reqB = await addRequest(emp, lt, 2);

    const outcomes = await Promise.allSettled([
      ledger.reserve({ employeeId: emp, leaveRequestId: reqA, datedDays: [day('2027-05-01'), day('2027-05-02')] }),
      ledger.reserve({ employeeId: emp, leaveRequestId: reqB, datedDays: [day('2027-06-01'), day('2027-06-02')] }),
    ]);

    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT reserved_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0);
    expect(Number(bal.reserved_days)).toBe(4);
  });

  it('deux consommations simultanées → une seule gagnante', async () => {
    const emp = await newEmployee('conc3');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'cc3', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);
    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    const outcomes = await Promise.allSettled([
      ledger.consume({ leaveRequestId: reqId }),
      ledger.consume({ leaveRequestId: reqId }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBe(1);

    const moves = await q("SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=? AND movement_type='DEDUCTION'", [reqId]);
    expect(Number(moves[0].n)).toBe(1);
  });

  it('consommation concurrente avec libération → un seul gagnant, état cohérent', async () => {
    const emp = await newEmployee('conc4');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'cc4', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);
    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    const outcomes = await Promise.allSettled([
      ledger.consume({ leaveRequestId: reqId }),
      ledger.release({ leaveRequestId: reqId }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBe(1);

    const moves = await q("SELECT movement_type FROM balance_movements WHERE leave_request_id=? AND movement_type IN ('DEDUCTION','LIBERATION_RESERVATION')", [reqId]);
    expect(moves).toHaveLength(1);
    const bal = await one("SELECT reserved_days, consumed_days, available_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const consumed = moves[0].movement_type === 'DEDUCTION';
    if (consumed) {
      expect(Number(bal.reserved_days)).toBe(0);
      expect(Number(bal.consumed_days)).toBe(2);
      expect(Number(bal.available_days)).toBe(8);
      expect(Number(lot.remaining_days)).toBe(0);
    } else {
      expect(Number(bal.reserved_days)).toBe(0);
      expect(Number(bal.consumed_days)).toBe(0);
      expect(Number(bal.available_days)).toBe(10);
      expect(Number(lot.remaining_days)).toBe(2);
    }
  });

  it('deux restitutions simultanées → une seule gagnante', async () => {
    const emp = await newEmployee('conc5');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'cc5', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);
    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    await ledger.consume({ leaveRequestId: reqId });

    const outcomes = await Promise.allSettled([
      ledger.restore({ leaveRequestId: reqId }),
      ledger.restore({ leaveRequestId: reqId }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBe(1);

    const moves = await q("SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [reqId]);
    expect(Number(moves[0].n)).toBe(1);
  });

  // ── E2-bis · Section 4 : protections métier ──────────────────────────────
  it('lot expiré à la date de l\'opération (statut encore ACTIF) → EXPIRE_A_LA_DATE_OPERATION', async () => {
    const emp = await newEmployee('prot1');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'p1', days: 2, remaining: 2, status: 'ACTIF', expires: '2026-01-01', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['EXPIRE_A_LA_DATE_OPERATION']);
  });

  it('échéance qui précède seulement la journée de congé → jour non couvert (lot non expiré)', async () => {
    const emp = await newEmployee('prot2');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    await addLot(emp, { key: 'p2', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-08-01', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 1);

    const result = await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-08-02')] });

    expect(result.totalLotDays).toBe(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.uncovered).toEqual([{ date: '2027-08-02', value: 1 }]);
  });

  it('droits gelés via frozen_in_balance → comptés dans la capacité (pas de sur-réservation)', async () => {
    const emp = await newEmployee('prot3');
    const lt = await newLeaveType();
    const balId = await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'p3', days: 10, remaining: 10, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    await q("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, frozen_in_balance, days, covered_dates, actor_id, reason) VALUES (?, NULL, NULL, ?, 'REGULARISATION', 1, 2, NULL, NULL, 'gel de test')", [lotId, balId]);
    const reqId = await addRequest(emp, lt, 2);

    let status = 0;
    try {
      await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(10);
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
  });

  it('restitution après expiration du lot → régularisation RH, sans recrédit ni restitution de lot', async () => {
    const emp = await newEmployee('prot4');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'p4', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);
    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    await ledger.consume({ leaveRequestId: reqId });
    await q("UPDATE carryover_lots SET status='EXPIRE' WHERE id=?", [lotId]);

    const result = await ledger.restore({ leaveRequestId: reqId });

    expect(result.totalLotDays).toBe(0);
    expect(result.regularisationDays).toBe(2);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT available_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0);
    expect(Number(bal.available_days)).toBe(8);
    expect(Number(bal.consumed_days)).toBe(2);
    const reg = await q("SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=? AND operation_type='REGULARISATION'", [reqId]);
    expect(Number(reg[0].n)).toBe(1);
    const recredits = await q("SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=? AND movement_type='RECREDIT'", [reqId]);
    expect(Number(recredits[0].n)).toBe(0);
  });

  // ── E3-A · tests obligatoires complémentaires ────────────────────────────
  it('demi-journées réparties entre plusieurs lots', async () => {
    const emp = await newEmployee('halfmulti');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lot1 = await addLot(emp, { key: 'hm1', days: 0.5, remaining: 0.5, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const lot2 = await addLot(emp, { key: 'hm2', days: 0.5, remaining: 0.5, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 1);

    const result = await ledger.reserve({
      employeeId: emp,
      leaveRequestId: reqId,
      datedDays: [day('2027-05-01', 0.5), day('2027-05-02', 0.5)],
    });

    expect(result.totalLotDays).toBe(1);
    expect(result.allocations.map((a) => a.lotId)).toEqual([lot1, lot2]);
    expect(result.allocations[0].days).toBe(0.5);
    expect(result.allocations[1].days).toBe(0.5);
    expect(result.uncovered).toHaveLength(0);
  });

  it('erreur après écriture SQL réelle → rollback complet (trigger)', async () => {
    const emp = await newEmployee('rollback2');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lot1 = await addLot(emp, { key: 'rb2a', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const lot2 = await addLot(emp, { key: 'rb2b', days: 1, remaining: 1, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    const trig = `trig_${tag}_rb2`;
    await q(
      `CREATE TRIGGER ${trig} BEFORE INSERT ON lot_allocations FOR EACH ROW
       BEGIN
         IF (SELECT COUNT(*) FROM lot_allocations WHERE leave_request_id = NEW.leave_request_id) >= 1 THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled rollback e3a';
         END IF;
       END`,
    );

    let status = 0;
    let errorCode = '';
    let errorMessage = '';
    try {
      await ledger.reserve({
        employeeId: emp,
        leaveRequestId: reqId,
        datedDays: [day('2027-05-01'), day('2027-05-02')],
      });
    } catch (e: any) {
      status = e?.getStatus?.() ?? e?.status ?? 500;
      errorCode = String(e?.driverError?.code ?? e?.code ?? '');
      errorMessage = String(e?.driverError?.sqlMessage ?? e?.message ?? '');
    }
    await q(`DROP TRIGGER ${trig}`);

    expect(status).toBe(500);
    expect(errorCode).toBe('ER_SIGNAL_EXCEPTION');
    expect(errorMessage).toContain('controlled rollback e3a'); // preuve : erreur après l'écriture du 1er lot
    const lot1After = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot1]);
    const lot2After = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lot2]);
    expect(Number(lot1After.remaining_days)).toBe(1);
    expect(Number(lot2After.remaining_days)).toBe(1);
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    const allocs = await q('SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
    expect(Number(allocs[0].n)).toBe(0);
  });

  it('gel réel : lot expiré pendant la réservation → régularisation gelée comptée ensuite', async () => {
    const emp = await newEmployee('frozenreal');
    const lt = await newLeaveType();
    const balId = await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'fr1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-08-01', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const reqId = await addRequest(emp, lt, 2);

    await ledger.reserve({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-07-30'), day('2027-07-31')] });
    await q("UPDATE carryover_lots SET status='EXPIRE' WHERE id=?", [lotId]);
    const release = await ledger.release({ leaveRequestId: reqId });
    expect(release.regularisationDays).toBe(2);

    const frozen = await one("SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=? AND operation_type='REGULARISATION' AND frozen_in_balance=1", [reqId]);
    expect(Number(frozen.n)).toBe(1);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(0); // non restitué

    // Nouveau lot frais (10 j) : les 2 j gelés sont comptés dans la capacité.
    await addLot(emp, { key: 'fr2', days: 10, remaining: 10, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const req2 = await addRequest(emp, lt, 2);
    let status = 0;
    try {
      await ledger.reserve({ employeeId: emp, leaveRequestId: req2, datedDays: [day('2027-07-30'), day('2027-07-31')] });
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400); // 10 (lot frais) + 2 (gelés) > 10 (disponible)
    const bal = await one('SELECT available_days, reserved_days FROM leave_balances WHERE id=?', [balId]);
    expect(Number(bal.available_days)).toBe(10);
    expect(Number(bal.reserved_days)).toBe(0);
  });

  it('restitution concurrente avec une nouvelle réservation sur le même lot — état final cohérent', async () => {
    const emp = await newEmployee('restoreconcurrent');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 10);
    const lotId = await addLot(emp, { key: 'rc1', days: 2, remaining: 2, status: 'ACTIF', expires: '2027-12-31', confirmation: 'CONFIRMEE', reconciled: 1, targetPeriod: '2025-2026' });
    const req1 = await addRequest(emp, lt, 2);
    await ledger.reserve({ employeeId: emp, leaveRequestId: req1, datedDays: [day('2027-05-01'), day('2027-05-02')] });
    await ledger.consume({ leaveRequestId: req1 }); // lot 2→0

    const req2 = await addRequest(emp, lt, 2);

    const outcomes = await Promise.allSettled([
      ledger.restore({ leaveRequestId: req1 }),
      ledger.reserve({ employeeId: emp, leaveRequestId: req2, datedDays: [day('2027-05-01'), day('2027-05-02')] }),
    ]);

    // Capturé pour l'audit : codes d'échec éventuels (deadlock, conflit).
    // eslint-disable-next-line no-console
    console.log('RESTORE_CONCURRENT:', outcomes.map((o: any) => o.status === 'fulfilled' ? 'ok' : (o.reason?.code ?? o.reason?.getStatus?.() ?? o.reason?.message ?? 'rejected')));

    // Quel que soit l'ordre, l'état final reste cohérent (reliquat ≥ 0, réservés ≤ disponibles).
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT available_days, reserved_days, consumed_days FROM leave_balances WHERE employee_id=? AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBeGreaterThanOrEqual(0);
    expect(Number(bal.reserved_days)).toBeLessThanOrEqual(Number(bal.available_days));
    expect(Number(bal.consumed_days)).toBeLessThanOrEqual(Number(bal.available_days));
  });
});
