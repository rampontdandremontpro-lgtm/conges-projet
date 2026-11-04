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
import { BirthEventsService } from './birth-events.service';
import { CorrectBirthEventDto } from './dto/correct-birth-event.dto';
import { CreateBirthEventDto } from './dto/create-birth-event.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('birth-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
)
export class BirthEventsController {
  constructor(private readonly birthEventsService: BirthEventsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBirthEventDto,
    @Query('employeeId') employeeId?: string,
  ) {
    const parsedEmployeeId =
      employeeId === undefined ? undefined : Number(employeeId);
    if (
      employeeId !== undefined &&
      (!Number.isInteger(parsedEmployeeId) || (parsedEmployeeId as number) < 1)
    ) {
      throw new BadRequestException(
        'employeeId doit être un identifiant entier positif.',
      );
    }
    return this.birthEventsService.create(
      request.user,
      dto,
      parsedEmployeeId,
    );
  }

  @Get('my')
  findMy(@Req() request: AuthenticatedRequest) {
    return this.birthEventsService.findForEmployee(request.user.id);
  }

  @Get()
  @Roles(UserRole.RH)
  findForEmployee(
    @Query('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.birthEventsService.findForEmployee(employeeId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.birthEventsService.findOneFor(
      id,
      request.user,
    );
  }

  @Patch(':id')
  @Roles(UserRole.RH)
  correct(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CorrectBirthEventDto,
  ) {
    return this.birthEventsService.correctByRh(
      id,
      request.user,
      dto,
    );
  }
}
