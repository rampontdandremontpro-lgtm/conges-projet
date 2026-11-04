import {
  Controller,
  Get,
  Param,
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
import { CarryoverLotClosureService } from './carryover-lot-closure.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/**
 * JUR-027 — Lot L5 : prévisualisation et exécution de la clôture des reports
 * maladie. RH uniquement, activée par `CARRYOVER_LOTS_ENABLED=true` ET base de
 * recette. Indisponible (404) sinon.
 */
@Controller('carryover-lots')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RH)
export class CarryoverLotClosureController {
  constructor(private readonly closureService: CarryoverLotClosureService) {}

  @Get('closure/:referencePeriod/preview')
  preview(@Param('referencePeriod') referencePeriod: string) {
    return this.closureService.preview(referencePeriod);
  }

  @Post('closure/:referencePeriod/execute')
  execute(
    @Param('referencePeriod') referencePeriod: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.closureService.execute(referencePeriod, request.user);
  }
}
