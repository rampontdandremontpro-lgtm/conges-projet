import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { ReportsService } from './reports.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('director/statistics')
  @Roles(UserRole.DIRECTEUR)
  getDirectorStatistics(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatisticsQueryDto,
  ) {
    return this.reportsService.getDirectorStatistics(query, request.user);
  }

  @Get('rh/statistics')
  @Roles(UserRole.RH)
  getRhStatistics(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatisticsQueryDto,
  ) {
    return this.reportsService.getDirectorStatistics(query, request.user);
  }
}
