import { ROLES_KEY } from '../auth/roles.decorator';
import { UserRole } from '../users/user.entity';
import { SettingsController } from './settings.controller';

describe('SettingsController practical links permissions', () => {
  const methods = ['createPracticalLink', 'updatePracticalLink', 'deletePracticalLink'] as const;

  for (const method of methods) {
    it(`${method} autorise RH et ADMIN`, () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype[method]) as UserRole[];
      expect(roles).toEqual(expect.arrayContaining([UserRole.RH, UserRole.ADMIN]));
    });
  }
});

describe('SettingsController internal rules permissions', () => {
  const writeMethods = ['createInternalRule', 'updateInternalRule', 'deleteInternalRule'] as const;

  for (const method of writeMethods) {
    it(`${method} autorise uniquement RH et ADMIN`, () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype[method]) as UserRole[];
      expect(roles).toEqual([UserRole.RH, UserRole.ADMIN]);
    });
  }

  it('getInternalRules autorise la lecture pour tous les rôles', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.getInternalRules) as UserRole[];
    expect(roles).toEqual(
      expect.arrayContaining([
        UserRole.COLLABORATEUR,
        UserRole.RESPONSABLE_SERVICE,
        UserRole.RH,
        UserRole.DIRECTEUR,
        UserRole.ADMIN,
      ]),
    );
  });
});
