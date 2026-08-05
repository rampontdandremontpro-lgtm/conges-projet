import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { UserRole } from '../users/user.entity';
import type { AuthenticatedUser } from './jwt-payload.interface';
import { ROLES_KEY } from './roles.decorator';

type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<UserRole[]>(
        ROLES_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

    /*
     * Lorsqu'aucun rôle n'est indiqué sur une route,
     * le guard ne bloque pas l'accès.
     *
     * Le JwtAuthGuard peut toutefois continuer à
     * imposer une authentification.
     */
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request =
      context
        .switchToHttp()
        .getRequest<AuthenticatedRequest>();

    const user = request.user;

    if (!user) {
      throw new UnauthorizedException(
        'Vous devez être connecté pour accéder à cette ressource.',
      );
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        'Vous ne disposez pas des autorisations nécessaires.',
      );
    }

    return true;
  }
}