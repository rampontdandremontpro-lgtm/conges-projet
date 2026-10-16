import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { LegalEntitiesService } from './legal-entities.service';

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
}
