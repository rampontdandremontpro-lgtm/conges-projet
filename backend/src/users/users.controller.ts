import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateOwnSignatureDto } from './dto/update-own-signature.dto';
import { UpdateOwnPreferencesDto } from './dto/update-own-preferences.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './user.entity';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  getOwnProfile(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.getOwnProfile(request.user.id);
  }

  @Get('me/service-presence')
  @Roles(UserRole.RESPONSABLE_SERVICE)
  getOwnServicePresence(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.getOwnServicePresence(request.user.id);
  }

  @Get('me/service-presence/calendar')
  @Roles(UserRole.RESPONSABLE_SERVICE)
  getOwnServicePresenceCalendar(
    @Req() request: AuthenticatedRequest,
    @Query('month') month?: string,
  ) {
    return this.usersService.getOwnServicePresenceCalendar(
      request.user.id,
      month,
    );
  }

  @Get('management/global-presence')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getGlobalPresence(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.getGlobalPresence(request.user.role);
  }

  @Get('management/global-presence/calendar')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getGlobalPresenceCalendar(
    @Req() request: AuthenticatedRequest,
    @Query('month') month?: string,
  ) {
    return this.usersService.getGlobalPresenceCalendar(
      month,
      request.user,
    );
  }

  @Get('me/preferences')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  getOwnPreferences(@Req() request: AuthenticatedRequest) {
    return this.usersService.getOwnPreferences(request.user.id);
  }

  @Get('profile-images')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  getProfileImages() {
    return this.usersService.getProfileImages();
  }

  @Put('me/preferences')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  updateOwnPreferences(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateOwnPreferencesDto,
  ) {
    return this.usersService.updateOwnPreferences(request.user.id, dto);
  }

  @Get('me/signature')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getOwnSignature(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.getOwnSignature(request.user.id);
  }

  @Put('me/signature')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  updateOwnSignature(
    @Req() request: AuthenticatedRequest,
    @Body() updateOwnSignatureDto: UpdateOwnSignatureDto,
  ) {
    return this.usersService.updateOwnSignature(
      request.user.id,
      updateOwnSignatureDto.signatureType,
      updateOwnSignatureDto.signatureData,
    );
  }

  @Delete('me/signature')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  deleteOwnSignature(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.deleteOwnSignature(request.user.id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RH)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createUserDto: CreateUserDto,
  ) {
    return this.usersService.create(
      createUserDto,
      request.user.role,
    );
  }

  @Patch(':id/reset-password')
  @Roles(UserRole.ADMIN, UserRole.RH)
  resetPassword(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() resetUserPasswordDto: ResetUserPasswordDto,
  ) {
    return this.usersService.resetPassword(
      id,
      resetUserPasswordDto.temporaryPassword,
      request.user.role,
    );
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findAll(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.findAll(request.user.role);
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.findOne(id, request.user.role);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RH)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(
      id,
      updateUserDto,
      request.user.role,
    );
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  disable(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.disable(id, request.user.role);
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  enable(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.enable(id, request.user.role);
  }
}