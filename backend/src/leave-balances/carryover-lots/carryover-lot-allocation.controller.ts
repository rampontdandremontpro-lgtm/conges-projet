import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
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
import { CarryoverLotAllocationService } from './carryover-lot-allocation.service';
import {
  ConsumeCarryoverAllocationDto,
  FinalizeCarryoverAllocationDto,
  PreviewCarryoverAllocationDto,
  ReleaseCarryoverAllocationDto,
  ReserveCarryoverAllocationDto,
  RestoreCarryoverAllocationDto,
} from './dto/carryover-allocation.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/**
 * JUR-027 — Lot L4 : API de test de l'allocation des reports maladie.
 * Accès RH uniquement, activée par `CARRYOVER_LOTS_ENABLED=true` ET base de
 * recette (`gestion_conges_gmes_test`). Indisponible (404) sinon.
 */
@Controller('carryover-lots')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RH)
export class CarryoverLotAllocationController {
  constructor(
    private readonly allocationService: CarryoverLotAllocationService,
  ) {}

  @Post('employee/:employeeId/preview-allocation')
  preview(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: PreviewCarryoverAllocationDto,
  ) {
    return this.allocationService.preview(employeeId, dto);
  }

  @Post('allocations/consume')
  consume(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ConsumeCarryoverAllocationDto,
  ) {
    return this.allocationService.consume(dto, request.user);
  }

  @Post('allocations/reserve')
  reserve(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReserveCarryoverAllocationDto,
  ) {
    return this.allocationService.reserve(dto, request.user);
  }

  @Post('allocations/release')
  release(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReleaseCarryoverAllocationDto,
  ) {
    return this.allocationService.release(dto, request.user);
  }

  @Post('allocations/finalize')
  finalize(
    @Req() request: AuthenticatedRequest,
    @Body() dto: FinalizeCarryoverAllocationDto,
  ) {
    return this.allocationService.finalize(dto, request.user);
  }

  @Post('allocations/restore')
  restore(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreCarryoverAllocationDto,
  ) {
    return this.allocationService.restore(dto, request.user);
  }
}
