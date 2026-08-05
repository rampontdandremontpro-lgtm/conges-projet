import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';

import { UsersService } from '../users/users.service';
import {
  AuthenticatedUser,
  JwtPayload,
} from './jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
  'jwt',
) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const jwtSecret =
      configService.get<string>('JWT_SECRET');

    if (!jwtSecret) {
      throw new Error(
        'La variable JWT_SECRET est absente du fichier .env.',
      );
    }

    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<AuthenticatedUser> {
    const user = await this.usersService.findOne(
      payload.sub,
    );

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Le compte utilisateur est désactivé.',
      );
    }

    return {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
      serviceId: user.serviceId,
    };
  }
}