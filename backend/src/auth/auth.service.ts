import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DefinePasswordDto } from './dto/define-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordDto } from './dto/request-password.dto';
import { JwtPayload } from './jwt-payload.interface';

interface PasswordTokenPayload {
  sub: number;
  email: string;
  purpose: 'password-reset';
  passwordFingerprint: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async requestPassword(
    requestPasswordDto: RequestPasswordDto,
  ): Promise<{ message: string }> {
    const email = requestPasswordDto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(email);

    const response = {
      message:
        'Si un compte actif correspond à cette adresse, un lien de définition du mot de passe sera envoyé.',
    };

    if (!user || !user.isActive) {
      return response;
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        purpose: 'password-reset',
        passwordFingerprint: this.passwordFingerprint(user.passwordHash),
      } satisfies PasswordTokenPayload,
      { expiresIn: '1h' },
    );

    console.log(
      [
        '',
        '==================================================',
        'LIEN TEMPORAIRE DE DÉFINITION DU MOT DE PASSE',
        `Utilisateur : ${user.prenom} ${user.nom}`,
        `E-mail : ${user.email}`,
        `Jeton : ${token}`,
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
    let payload: PasswordTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<PasswordTokenPayload>(
        definePasswordDto.token.trim(),
      );
    } catch {
      throw new BadRequestException(
        'Le lien de définition du mot de passe est invalide ou expiré.',
      );
    }

    if (payload.purpose !== 'password-reset') {
      throw new BadRequestException(
        'Le lien de définition du mot de passe est invalide ou expiré.',
      );
    }

    const user = await this.usersService.findByEmailWithPassword(
      payload.email,
    );

    if (
      !user ||
      user.id !== payload.sub ||
      this.passwordFingerprint(user.passwordHash) !==
        payload.passwordFingerprint
    ) {
      throw new BadRequestException(
        'Le lien de définition du mot de passe est invalide, expiré ou déjà utilisé.',
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

    await this.usersService.setPassword(user.id, passwordHash);

    return {
      message:
        'Votre mot de passe a été défini avec succès. Vous pouvez maintenant vous connecter.',
    };
  }

  async changePassword(
    userId: number,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByIdWithPassword(userId);

    if (!user || !user.passwordHash) {
      throw new BadRequestException(
        'Ce compte ne possède pas de mot de passe local modifiable depuis l’application.',
      );
    }

    const currentPasswordIsValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.passwordHash,
    );

    if (!currentPasswordIsValid) {
      throw new BadRequestException(
        'Le mot de passe actuel est incorrect.',
      );
    }

    const samePassword = await bcrypt.compare(
      changePasswordDto.newPassword,
      user.passwordHash,
    );

    if (samePassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent du mot de passe actuel.',
      );
    }

    const passwordHash = await bcrypt.hash(
      changePasswordDto.newPassword,
      12,
    );

    await this.usersService.setPassword(user.id, passwordHash);

    return {
      message: 'Votre mot de passe a été modifié avec succès.',
    };
  }

  async login(loginDto: LoginDto) {
    const email = loginDto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(
        'Adresse e-mail ou mot de passe incorrect.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException('Votre compte est désactivé.');
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
      purpose: 'access',
    };

    const accessToken = await this.jwtService.signAsync(payload);

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

  private passwordFingerprint(passwordHash: string | null): string {
    return createHash('sha256')
      .update(passwordHash ?? 'NO_PASSWORD_DEFINED')
      .digest('hex');
  }
}
