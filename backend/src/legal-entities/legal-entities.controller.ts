import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { LegalEntitiesService } from './legal-entities.service';
import { UpdateLegalEntityConventionDto } from './dto/update-legal-entity-convention.dto';
import { UpdateLegalEntityIllnessRegimeDto } from './dto/update-legal-entity-illness-regime.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('legal-entities')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LegalEntitiesController {
  constructor(
    private readonly legalEntitiesService: LegalEntitiesService,
  ) {}

  @Get()
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  findAll() {
    return this.legalEntitiesService.findAllActive();
  }

  @Patch(':id/convention')
  @Roles(UserRole.RH)
  updateConvention(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateLegalEntityConventionDto,
  ) {
    return this.legalEntitiesService.updateConvention(
      id,
      dto,
      request.user.id,
    );
  }

  @Get(':id/illness-regime')
  @Roles(UserRole.RH)
  getIllnessRegime(@Param('id', ParseIntPipe) id: number) {
    return this.legalEntitiesService.getIllnessRegime(id);
  }

  @Patch(':id/illness-regime')
  @Roles(UserRole.RH)
  updateIllnessRegime(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateLegalEntityIllnessRegimeDto,
  ) {
    return this.legalEntitiesService.updateIllnessRegime(
      id,
      dto,
      request.user.id,
    );
  }
}
