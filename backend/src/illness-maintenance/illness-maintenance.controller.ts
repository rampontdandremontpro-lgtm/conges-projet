import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { IllnessMaintenanceService } from './illness-maintenance.service';
import { CreateIllnessMaintenanceDecisionDto } from './dto/create-illness-maintenance-decision.dto';
import { UpdateIllnessMaintenanceDecisionDto } from './dto/update-illness-maintenance-decision.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('illness-maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IllnessMaintenanceController {
  constructor(
    private readonly illnessMaintenanceService: IllnessMaintenanceService,
  ) {}

  @Get()
  @Roles(UserRole.RH)
  findAll(@Query('employeeId') employeeId?: string) {
    return this.illnessMaintenanceService.findAll(
      employeeId ? Number(employeeId) : undefined,
    );
  }

  @Get('employee/:employeeId')
  @Roles(UserRole.RH)
  findForEmployee(@Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.illnessMaintenanceService.findActiveForEmployee(employeeId);
  }

  @Post()
  @Roles(UserRole.RH)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateIllnessMaintenanceDecisionDto,
  ) {
    return this.illnessMaintenanceService.create(dto, request.user.id);
  }

  @Patch(':id')
  @Roles(UserRole.RH)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateIllnessMaintenanceDecisionDto,
  ) {
    return this.illnessMaintenanceService.update(id, dto, request.user.id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.RH)
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.illnessMaintenanceService.cancel(id, request.user.id);
  }
}
