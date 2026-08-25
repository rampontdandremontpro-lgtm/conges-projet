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
import { UpdateOwnSignatureDto } from './dto/update-own-signature.dto';
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
  getGlobalPresence() {
    return this.usersService.getGlobalPresence();
  }

  @Get('management/global-presence/calendar')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getGlobalPresenceCalendar(
    @Query('month') month?: string,
  ) {
    return this.usersService.getGlobalPresenceCalendar(month);
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

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.RH,
  )
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(
      id,
      updateUserDto,
    );
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN)
  disable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.disable(id);
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN)
  enable(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.enable(id);
  }
}