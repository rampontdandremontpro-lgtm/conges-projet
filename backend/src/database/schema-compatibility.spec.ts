import { assertDatabaseSchemaCompatible } from './schema-compatibility';

describe('assertDatabaseSchemaCompatible', () => {
  function fakeDataSource({
    leaveClassification = [{ Type: 'varchar(20)' }],
    movementType = "enum('ACQUISITION','SENIORITY_EXTRA','FRACTIONNEMENT')",
  } = {}) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('leave_classification')) return leaveClassification;
      if (sql.includes('movement_type')) return [{ Type: movementType }];
      return [];
    });
    return { query } as never;
  }

  it('passe quand le schéma est compatible', async () => {
    await expect(
      assertDatabaseSchemaCompatible(fakeDataSource()),
    ).resolves.toBeUndefined();
  });

  it('échoue quand leave_classification est absente', async () => {
    await expect(
      assertDatabaseSchemaCompatible(
        fakeDataSource({ leaveClassification: [] }),
      ),
    ).rejects.toThrow(/leave_classification/);
  });

  it('échoue quand les valeurs de mouvement manquent', async () => {
    await expect(
      assertDatabaseSchemaCompatible(
        fakeDataSource({
          movementType: "enum('ACQUISITION','DEDUCTION')",
        }),
      ),
    ).rejects.toThrow(/SENIORITY_EXTRA/);
  });
});
