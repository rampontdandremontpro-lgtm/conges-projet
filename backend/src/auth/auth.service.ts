import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  createHash,
  randomBytes,
} from 'node:crypto';

import { UsersService } from '../users/users.service';
import { DefinePasswordDto } from './dto/define-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordDto } from './dto/request-password.dto';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly passwordTokenLifetimeInMilliseconds =
    60 * 60 * 1000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async requestPassword(
    requestPasswordDto: RequestPasswordDto,
  ): Promise<{ message: string }> {
    const email = requestPasswordDto.email
      .trim()
      .toLowerCase();

    const user =
      await this.usersService.findByEmail(email);

    /*
     * La réponse reste volontairement identique,
     * que le compte existe ou non.
     *
     * Cela évite de permettre à une personne
     * de vérifier quelles adresses possèdent
     * un compte dans l'application.
     */
    const response = {
      message:
        'Si un compte actif correspond à cette adresse, un lien de définition du mot de passe sera envoyé.',
    };

    if (!user || !user.isActive) {
      return response;
    }

    const rawToken = randomBytes(32).toString('hex');

    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date(
      Date.now() +
        this.passwordTokenLifetimeInMilliseconds,
    );

    await this.usersService.setPasswordResetToken(
      user.id,
      tokenHash,
      expiresAt,
    );

    /*
     * Temporaire, tant que Microsoft Graph
     * et l'envoi des e-mails ne sont pas intégrés.
     *
     * Le jeton apparaîtra dans le terminal NestJS
     * afin de pouvoir tester la définition du mot de passe.
     *
     * Ce console.log devra être supprimé lorsque
     * l'e-mail sécurisé sera mis en place.
     */
    console.log(
      [
        '',
        '==================================================',
        'LIEN TEMPORAIRE DE DÉFINITION DU MOT DE PASSE',
        `Utilisateur : ${user.prenom} ${user.nom}`,
        `E-mail : ${user.email}`,
        `Jeton : ${rawToken}`,
        `Expiration : ${expiresAt.toISOString()}`,
        '==================================================',
        '',
      ].join('\n'),
    );

    return response;
  }

  async definePassword(
    definePasswordDto: DefinePasswordDto,
  ): Promise<{ message: string }> {
    const rawToken = definePasswordDto.token
      .trim()
      .toLowerCase();

    const tokenHash = this.hashToken(rawToken);

    const user =
      await this.usersService.findByValidPasswordResetToken(
        tokenHash,
      );

    if (!user) {
      throw new BadRequestException(
        'Le lien de définition du mot de passe est invalide ou expiré.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Le compte utilisateur est désactivé.',
      );
    }

    const passwordHash = await bcrypt.hash(
      definePasswordDto.password,
      12,
    );

    await this.usersService.setPasswordAndClearResetToken(
      user.id,
      passwordHash,
    );

    return {
      message:
        'Votre mot de passe a été défini avec succès. Vous pouvez maintenant vous connecter.',
    };
  }

  async login(loginDto: LoginDto) {
    const email = loginDto.email
      .trim()
      .toLowerCase();

    const user =
      await this.usersService.findByEmailWithPassword(
        email,
      );

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(
        'Adresse e-mail ou mot de passe incorrect.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Votre compte est désactivé.',
      );
    }

    const passwordIsValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException(
        'Adresse e-mail ou mot de passe incorrect.',
      );
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken =
      await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role,
        employmentType: user.employmentType,
        presenceStatus: user.presenceStatus,
        serviceId: user.serviceId,
        service: user.service,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }
}