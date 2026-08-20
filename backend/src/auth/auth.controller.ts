import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DefinePasswordDto } from './dto/define-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordDto } from './dto/request-password.dto';
import { ValidatePasswordTokenDto } from './dto/validate-password-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './jwt-payload.interface';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('request-password')
  @HttpCode(HttpStatus.OK)
  requestPassword(
    @Body() requestPasswordDto: RequestPasswordDto,
  ) {
    return this.authService.requestPassword(
      requestPasswordDto,
    );
  }


  @Post('validate-password-token')
  @HttpCode(HttpStatus.OK)
  validatePasswordToken(
    @Body() validatePasswordTokenDto: ValidatePasswordTokenDto,
  ) {
    return this.authService.validatePasswordToken(
      validatePasswordTokenDto,
    );
  }

  @Post('define-password')
  @HttpCode(HttpStatus.OK)
  definePassword(
    @Body() definePasswordDto: DefinePasswordDto,
  ) {
    return this.authService.definePassword(
      definePasswordDto,
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      request.user.id,
      changePasswordDto,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(
    @Req() request: AuthenticatedRequest,
  ): AuthenticatedUser {
    return request.user;
  }
}