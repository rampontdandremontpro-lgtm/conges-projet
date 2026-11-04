import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import mysql from 'mysql2/promise';

import { AuditLog } from '../src/audit/audit-log.entity';
import { AuditService } from '../src/audit/audit.service';
import { BalanceMovement } from '../src/leave-balances/balance-movement.entity';
import { CarryoverLot } from '../src/leave-balances/carryover-lot.entity';
import { CarryoverLotAllocationService } from '../src/leave-balances/carryover-lots/carryover-lot-allocation.service';
import { CarryoverLotLedgerService } from '../src/leave-balances/carryover-lots/carryover-lot-ledger.service';
import { CarryoverLotAllocation } from '../src/leave-balances/carryover-lots/carryover-lot-allocation.entity';
import { LeaveBalance } from '../src/leave-balances/leave-balance.entity';
import { LegalEntity } from '../src/legal-entities/legal-entity.entity';
import { Service } from '../src/services/service.entity';
import { User, UserRole } from '../src/users/user.entity';
import { LeaveRequest } from '../src/leave-requests/leave-request.entity';
import { LeaveType } from '../src/leave-types/leave-type.entity';
import { Holiday } from '../src/holidays/holiday.entity';
import { HolidaysService } from '../src/holidays/holidays.service';

const day = (date: string, value = 1) => ({ date, value });

describe('E3-A — unification L4/ledger (consommation directe, combiné, chemins croisés)', () => {
  let moduleRef: TestingModule;
  let ledger: CarryoverLotLedgerService;
  let l4: CarryoverLotAllocationService;
  let db: mysql.Connection;
  let rhId = 0;

  const tag = `E3A${Date.now().toString(36)}`;

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
      [`E3A-${tag}-${suffix}`, `${tag}-${suffix}@recette.fr`],
    );

  let ltCounter = 0;
  const newLeaveType = async (): Promise<number> => {
    ltCounter += 1;
    return insert(
      `INSERT INTO leave_types (name, category, deducts_paid_leave_balance) VALUES (?, 'DEMANDE_CONGE', 1)`,
      [`CP-${tag}-${ltCounter}`],
    );
  };

  const addBalance = async (emp: number, period: string, counter: string, available: number) =>
    insert(
      `INSERT INTO leave_balances (employee_id, reference_period, counter_type, acquired_days, available_days, reserved_days, consumed_days)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [emp, period, counter, available, available],
    );

  const addLot = async (emp: number, key: string, remaining: number, targetPeriod = '2025-2026'): Promise<number> =>
    insert(
      `INSERT INTO carryover_lots
         (employee_id, source_reference_period, target_reference_period, target_counter_type, days, remaining_days, origin, regime, status, information_date, information_date_certain, confirmation_status, reconciled, expires_at, expiry_basis, idempotency_key, version)
       VALUES (?, '2024-2025', ?, 'N-1', ?, ?, 'MALADIE', 'GENERAL', 'ACTIF', '2026-06-25', 1, 'CONFIRMEE', 1, '2027-12-31', 'L3141-19-1', ?, 0)`,
      [emp, targetPeriod, remaining, remaining, `${tag}-${emp}-${key}`],
    );

  const addRequest = async (emp: number, lt: number, start: string, end: string, deducted: number): Promise<number> =>
    insert(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, calendar_duration, deducted_days, status, balance_processing_status)
       VALUES (?, ?, ?, ?, ?, ?, 'VALIDEE', 'DEFINITIF')`,
      [emp, lt, start, end, deducted, deducted],
    );

  const rhActor = (id: number) => ({
    id,
    nom: 'RH',
    prenom: 'Recette',
    email: 'rh.recette@gmes.fr',
    role: UserRole.RH,
    serviceId: null,
    mustChangePassword: false,
  });

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
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ CARRYOVER_LOTS_ENABLED: 'true' })],
        }),
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
          Holiday,
        ]),
      ],
      providers: [
        CarryoverLotLedgerService,
        CarryoverLotAllocationService,
        AuditService,
        { provide: HolidaysService, useValue: { findNonDeductibleBetween: async () => [] } },
      ],
    }).compile();

    ledger = moduleRef.get(CarryoverLotLedgerService);
    l4 = moduleRef.get(CarryoverLotAllocationService);

    const rhRows = await q("SELECT id FROM users WHERE email='rh.recette@gmes.fr'");
    rhId = Number(rhRows?.[0]?.id ?? 0);
  });

  afterAll(async () => {
    await moduleRef.close();
    await db.end();
  });

  it('consommation directe L4 combinant un lot maladie + jours ordinaires', async () => {
    const emp = await newEmployee('combine');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 5);
    await addBalance(emp, '2026-2027', 'N', 10);
    const lotId = await addLot(emp, 'c1', 2); // 2 jours de lot
    const reqId = await addRequest(emp, lt, '2027-05-03', '2027-05-05', 3); // 3 jours (lot 2 + ordinaire 1)

    const result: any = await l4.consume({ leaveRequestId: reqId, referencePeriod: '2026-2027' }, rhActor(rhId));

    expect(result.totalDays).toBe(3);
    expect(result.lotAllocations).toHaveLength(1);
    expect(result.lotAllocations[0].days).toBe(2);
    expect(result.ordinaryAllocations).toEqual([{ balanceId: expect.any(Number), days: 1 }]);
    expect(result.uncovered).toEqual([{ date: '2027-05-05', value: 1 }]);

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    const bal = await one("SELECT available_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [emp]);
    expect(Number(lot.remaining_days)).toBe(0);
    expect(Number(bal.consumed_days)).toBe(3); // 2 lot + 1 ordinaire
    expect(Number(bal.available_days)).toBe(2);

    const moves = await q('SELECT movement_type, days FROM balance_movements WHERE leave_request_id=? ORDER BY id', [reqId]);
    expect(moves.map((m: any) => m.movement_type)).toEqual(['DEDUCTION', 'DEDUCTION']);
    expect(moves.reduce((s: number, m: any) => s + Number(m.days), 0)).toBe(3);
  });

  it('une même demande ne peut pas être comptabilisée deux fois par deux services distincts', async () => {
    const emp = await newEmployee('double');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 5);
    await addBalance(emp, '2026-2027', 'N', 10);
    await addLot(emp, 'd1', 4);
    const reqId = await addRequest(emp, lt, '2027-05-03', '2027-05-04', 2);

    // L4 consomme.
    await l4.consume({ leaveRequestId: reqId, referencePeriod: '2026-2027' }, rhActor(rhId));

    // Le ledger (autre service) refuse de re-consommer la même demande.
    let status = 0;
    try {
      await ledger.consumeDirect({ employeeId: emp, leaveRequestId: reqId, datedDays: [day('2027-05-03'), day('2027-05-04')] });
    } catch (e: any) {
      status = e?.getStatus?.() ?? e?.status ?? 500;
    }
    expect(status).toBe(409);

    const moves = await q("SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=? AND movement_type='DEDUCTION'", [reqId]);
    expect(Number(moves[0].n)).toBe(1);
  });

  it('concurrence croisée L4/E2 sur le même lot : pas de sur-consommation', async () => {
    const emp = await newEmployee('cross');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 5);
    await addBalance(emp, '2026-2027', 'N', 10);
    const lotId = await addLot(emp, 'x1', 4);
    const reqA = await addRequest(emp, lt, '2027-05-03', '2027-05-04', 2);
    const reqB = await addRequest(emp, lt, '2027-05-05', '2027-05-06', 2);

    const outcomes = await Promise.allSettled([
      l4.consume({ leaveRequestId: reqA, referencePeriod: '2026-2027' }, rhActor(rhId)),
      ledger.consumeDirect({ employeeId: emp, leaveRequestId: reqB, datedDays: [day('2027-05-05'), day('2027-05-06')] }),
    ]);

    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(0); // 4 jours de lot consommés exactement

    const allocs = await q("SELECT COUNT(*) AS n FROM lot_allocations WHERE operation_type='CONSUMPTION' AND lot_id=?", [lotId]);
    expect(Number(allocs[0].n)).toBe(2); // une par demande
  });

  it('L4 applique l\'invariant unifié : reliquats + réservés + gelés ≤ disponibles', async () => {
    const emp = await newEmployee('invariant');
    const lt = await newLeaveType();
    const balId = await addBalance(emp, '2025-2026', 'N-1', 10);
    await addBalance(emp, '2026-2027', 'N', 20);
    await q('UPDATE leave_balances SET reserved_days = 3 WHERE id=?', [balId]); // 3 j déjà réservés
    const lotId = await addLot(emp, 'inv1', 10); // 10 j de lots encore mobilisables
    const reqId = await addRequest(emp, lt, '2027-05-03', '2027-05-04', 2);

    let status = 0;
    try {
      await l4.consume({ leaveRequestId: reqId, referencePeriod: '2026-2027' }, rhActor(rhId));
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400); // 10 (lots) + 3 (réservés) > 10 (disponible)

    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(10); // inchangé
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
  });

  it('rollback L4 + ledger : erreur après écriture de lot, lors de l\'ordinaire → annulation conjointe', async () => {
    const emp = await newEmployee('rbcombo');
    const lt = await newLeaveType();
    await addBalance(emp, '2025-2026', 'N-1', 5);
    await addBalance(emp, '2026-2027', 'N', 10);
    const lotId = await addLot(emp, 'rbcombo', 2); // 2 j de lot
    const reqId = await addRequest(emp, lt, '2027-05-03', '2027-05-05', 3); // 2 lot + 1 ordinaire

    const trig = `trig_${tag}_rbcombo`;
    await q(
      `CREATE TRIGGER ${trig} BEFORE INSERT ON balance_movements FOR EACH ROW
       BEGIN
         IF (SELECT COUNT(*) FROM balance_movements WHERE leave_request_id = NEW.leave_request_id) >= 1 THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled rollback e3a combo';
         END IF;
       END`,
    );

    let status = 0;
    let errorCode = '';
    let errorMessage = '';
    try {
      await l4.consume({ leaveRequestId: reqId, referencePeriod: '2026-2027' }, rhActor(rhId));
    } catch (e: any) {
      status = e?.getStatus?.() ?? e?.status ?? 500;
      errorCode = String(e?.driverError?.code ?? e?.code ?? '');
      errorMessage = String(e?.driverError?.sqlMessage ?? e?.message ?? '');
    } finally {
      await q(`DROP TRIGGER ${trig}`);
    }

    expect(status).toBe(500);
    expect(errorCode).toBe('ER_SIGNAL_EXCEPTION');
    expect(errorMessage).toContain('controlled rollback e3a combo'); // preuve : erreur après l'écriture du lot
    const lot = await one('SELECT remaining_days FROM carryover_lots WHERE id=?', [lotId]);
    expect(Number(lot.remaining_days)).toBe(2); // écriture lot annulée
    const bal = await one("SELECT available_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [emp]);
    expect(Number(bal.available_days)).toBe(5); // rollback
    expect(Number(bal.consumed_days)).toBe(0);
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    const allocs = await q('SELECT COUNT(*) AS n FROM lot_allocations WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
    expect(Number(allocs[0].n)).toBe(0);
  });

  it('compteur N-1 avec jours protégés (lots) et gelés → non consommable entièrement en ordinaire', async () => {
    const emp = await newEmployee('protect');
    const lt = await newLeaveType();
    const balN1 = await addBalance(emp, '2025-2026', 'N-1', 10);
    await addBalance(emp, '2026-2027', 'N', 0); // aucun repli sur N
    const lotId = await addLot(emp, 'prot1', 6); // 6 j protégés par lot (échéance avant la demande)
    await q("UPDATE carryover_lots SET expires_at='2027-01-01' WHERE id=?", [lotId]);
    // 2 jours gelés (régularisation RH encore dans le solde).
    await q("INSERT INTO lot_allocations (lot_id, leave_request_id, movement_id, leave_balance_id, operation_type, frozen_in_balance, days, covered_dates, actor_id, reason) VALUES (?, NULL, NULL, ?, 'REGULARISATION', 1, 2, NULL, NULL, 'gel de test')", [lotId, balN1]);
    const reqId = await addRequest(emp, lt, '2027-03-01', '2027-03-03', 3); // 3 j ordinaires (après échéance du lot)

    let status = 0;
    try {
      await l4.consume({ leaveRequestId: reqId, referencePeriod: '2026-2027' }, rhActor(rhId));
    } catch (e: any) { status = e?.getStatus?.() ?? e?.status ?? 500; }
    expect(status).toBe(400); // seuls 10 − 6 (lots) − 2 (gelés) = 2 j ordinaires mobilisables < 3

    const bal = await one("SELECT available_days, consumed_days FROM leave_balances WHERE employee_id=? AND reference_period='2025-2026' AND counter_type='N-1'", [emp]);
    expect(Number(bal.available_days)).toBe(10); // rien consommé
    expect(Number(bal.consumed_days)).toBe(0);
    const moves = await q('SELECT COUNT(*) AS n FROM balance_movements WHERE leave_request_id=?', [reqId]);
    expect(Number(moves[0].n)).toBe(0);
  });
});
