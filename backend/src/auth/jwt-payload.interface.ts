import { UserRole } from '../users/user.entity';

export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: UserRole;
  serviceId: number;
}