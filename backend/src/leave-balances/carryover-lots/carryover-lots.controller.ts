import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { UserRole } from '../../users/user.entity';
import { CarryoverLotsService } from './carryover-lots.service';
import { CreateCarryoverLotDto } from './dto/create-carryover-lot.dto';
import { ConfirmCarryoverLotDto } from './dto/confirm-carryover-lot.dto';
import { UpdateCarryoverLotDto } from './dto/update-carryover-lot.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/**
 * JUR-027 — Lot L3 : API de gestion individualisée des reports maladie.
 *
 * Accès limité au rôle RH. Sur l'environnement normal (sans le flag
 * `CARRYOVER_LOTS_ENABLED=true`), toutes les routes répondent 404 via le
 * garde-fou du service : la fonctionnalité n'y est jamais accessible.
 */
@Controller('carryover-lots')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RH)
export class CarryoverLotsController {
  constructor(private readonly carryoverLotsService: CarryoverLotsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCarryoverLotDto,
  ) {
    return this.carryoverLotsService.create(dto, request.user);
  }

  @Get('employee/:employeeId')
  listByEmployee(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.carryoverLotsService.listByEmployee(employeeId, request.user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.carryoverLotsService.findOne(id, request.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateCarryoverLotDto,
  ) {
    return this.carryoverLotsService.update(id, dto, request.user);
  }

  @Post(':id/confirm')
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ConfirmCarryoverLotDto,
  ) {
    return this.carryoverLotsService.confirm(id, dto, request.user);
  }
}
