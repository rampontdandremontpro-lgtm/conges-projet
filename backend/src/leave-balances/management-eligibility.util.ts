import type { UserRole } from '../users/user.entity';

type ManagementBalanceUser = {
  role: UserRole;
  isActive: boolean;
};

export function isManagedBalanceEmployee(user: ManagementBalanceUser): boolean {
  return Boolean(
    user.isActive &&
      user.role !== 'ADMIN' &&
      user.role !== 'DIRECTEUR',
  );
}
