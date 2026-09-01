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
