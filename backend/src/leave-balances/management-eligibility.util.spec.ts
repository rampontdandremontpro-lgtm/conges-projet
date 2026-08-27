import { UserRole } from '../users/user.entity';
import { isManagedBalanceEmployee } from './management-eligibility.util';

describe('isManagedBalanceEmployee', () => {
  it('exclut Administrateur et Directeur des soldes collaborateurs RH', () => {
    expect(isManagedBalanceEmployee({ role: UserRole.ADMIN, isActive: true })).toBe(false);
    expect(isManagedBalanceEmployee({ role: UserRole.DIRECTEUR, isActive: true })).toBe(false);
  });

  it('conserve les autres utilisateurs actifs', () => {
    expect(isManagedBalanceEmployee({ role: UserRole.COLLABORATEUR, isActive: true })).toBe(true);
    expect(isManagedBalanceEmployee({ role: UserRole.RESPONSABLE_SERVICE, isActive: true })).toBe(true);
    expect(isManagedBalanceEmployee({ role: UserRole.RH, isActive: true })).toBe(true);
  });

  it('exclut les utilisateurs inactifs', () => {
    expect(isManagedBalanceEmployee({ role: UserRole.COLLABORATEUR, isActive: false })).toBe(false);
  });
});
