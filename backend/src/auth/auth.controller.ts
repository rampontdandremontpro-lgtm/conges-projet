import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { DefinePasswordDto } from './dto/define-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordDto } from './dto/request-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedUser } from './jwt-payload.interface';

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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(
    @Req() request: AuthenticatedRequest,
  ): AuthenticatedUser {
    return request.user;
  }
}