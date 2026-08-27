export interface RawBalanceImportRow {
  employeeId: unknown;
  acquiredDays: unknown;
  takenDays: unknown;
  balanceDays: unknown;
}

export interface NormalizedBalanceImportRow {
  employeeId: number;
  acquiredDays: number;
  takenDays: number;
  balanceDays: number;
}

function numberFrom(value: unknown, label: string): number {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} doit être un nombre.`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function normalizeBalanceImportRow(row: RawBalanceImportRow): NormalizedBalanceImportRow {
  const employeeId = Number(row.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('Identifiant collaborateur invalide.');
  }
  const acquiredDays = numberFrom(row.acquiredDays, 'Acquis');
  const takenDays = numberFrom(row.takenDays, 'Pris');
  const balanceDays = numberFrom(row.balanceDays, 'Solde');
  if (acquiredDays < 0) {
    throw new Error('Acquis ne peut pas être négatif.');
  }
  if (takenDays < 0) {
    throw new Error('Pris ne peut pas être négatif.');
  }
  const expected = Math.round(((acquiredDays - takenDays) + Number.EPSILON) * 100) / 100;
  if (Math.abs(expected - balanceDays) > 0.001) {
    throw new Error(`Le solde doit respecter Acquis - Pris (${expected.toFixed(2)}).`);
  }
  return { employeeId, acquiredDays, takenDays, balanceDays };
}
