import {
  BadRequestException,
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
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { UpdateLeaveTypeAbsenceKindDto } from './dto/update-leave-type-absence-kind.dto';
import { LeaveTypesService } from './leave-types.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('leave-types')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveTypesController {
  constructor(
    private readonly leaveTypesService: LeaveTypesService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RH)
  create(@Body() createLeaveTypeDto: CreateLeaveTypeDto) {
    return this.leaveTypesService.create(createLeaveTypeDto);
  }

  @Get()
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  findAllActive() {
    return this.leaveTypesService.findAllActive();
  }

  @Get('management')
  @Roles(UserRole.ADMIN, UserRole.RH)
  findAllForManagement() {
    return this.leaveTypesService.findAllForManagement();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.RH)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leaveTypesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RH)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateLeaveTypeDto: UpdateLeaveTypeDto,
  ) {
    return this.leaveTypesService.update(id, updateLeaveTypeDto);
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  disable(@Param('id', ParseIntPipe) id: number) {
    return this.leaveTypesService.disable(id);
  }

  @Patch(':id/absence-kind')
  @Roles(UserRole.RH)
  updateAbsenceKind(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeaveTypeAbsenceKindDto,
  ) {
    return this.leaveTypesService.updateAbsenceKind(id, dto);
  }

  @Get(':id/family-event-rule')
  @Roles(UserRole.RH, UserRole.COLLABORATEUR)
  familyEventRule(
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date: string,
    @Query('employeeId') employeeId: string | undefined,
    @Query('lien') lien: string | undefined,
    @Query('enfantAge') enfantAge: string | undefined,
    @Query('aCharge') aCharge: string | undefined,
    @Query('nbEnfantsCharge') nbEnfantsCharge: string | undefined,
    @Query('enfantEstParent') enfantEstParent: string | undefined,
    @Query('personneChargeMoins25') personneChargeMoins25: string | undefined,
    @Query('natureAnnonce') natureAnnonce: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const VALID_ANNONCE_NATURE = [
      'HANDICAP',
      'PATHOLOGIE_CHRONIQUE',
      'CANCER',
    ];
    if (
      natureAnnonce !== undefined &&
      !VALID_ANNONCE_NATURE.includes(natureAnnonce)
    ) {
      throw new BadRequestException(
        'natureAnnonce doit être HANDICAP, PATHOLOGIE_CHRONIQUE ou CANCER.',
      );
    }

    // Sécurité : l'identité vient de la session. Un collaborateur consulte
    // uniquement SES propres règles ; la RH peut consulter un autre salarié.
    const targetEmployeeId =
      request.user.role === UserRole.RH
        ? employeeId
          ? Number(employeeId)
          : request.user.id
        : request.user.id;

    return this.leaveTypesService.familyEventRuleFor(
      id,
      date,
      targetEmployeeId,
      {
        lien: lien as never,
        enfantAge: enfantAge ? Number(enfantAge) : undefined,
        aCharge: aCharge === 'true',
        nbEnfantsCharge: nbEnfantsCharge ? Number(nbEnfantsCharge) : undefined,
        enfantEstParent: enfantEstParent === 'true',
        personneChargeMoins25: personneChargeMoins25 === 'true',
        natureAnnonce: natureAnnonce as never,
      },
    );
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  enable(@Param('id', ParseIntPipe) id: number) {
    return this.leaveTypesService.enable(id);
  }
}
