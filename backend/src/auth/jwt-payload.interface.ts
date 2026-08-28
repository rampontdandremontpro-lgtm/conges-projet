import { UserRole } from '../users/user.entity';

export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
  purpose: 'access';
}

export interface AuthenticatedUser {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: UserRole;
  serviceId: number | null;
  mustChangePassword: boolean;
}
