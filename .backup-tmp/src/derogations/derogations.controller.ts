import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CreateDerogationDto } from './dto/create-derogation.dto';
import { DecideDerogationDto } from './dto/decide-derogation.dto';
import { DerogationQueryDto } from './dto/derogation-query.dto';
import { UpdateDerogationDto } from './dto/update-derogation.dto';
import { DerogationsService } from './derogations.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

const DEROGATION_REQUESTER_ROLES = [
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
];

@Controller('derogations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DerogationsController {
  constructor(
    private readonly derogationsService: DerogationsService,
  ) {}

  @Post()
  @Roles(...DEROGATION_REQUESTER_ROLES)
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateDerogationDto,
  ) {
    return this.derogationsService.createDraft(
      request.user,
      dto,
    );
  }

  @Get('my')
  @Roles(...DEROGATION_REQUESTER_ROLES)
  findMy(@Req() request: AuthenticatedRequest) {
    return this.derogationsService.findMy(request.user);
  }

  @Get('my/:id')
  @Roles(...DEROGATION_REQUESTER_ROLES)
  findMyOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.derogationsService.findMyOne(id, request.user);
  }

  @Get('management')
  @Roles(UserRole.RH)
  findForManagement(@Query() query: DerogationQueryDto) {
    return this.derogationsService.findForManagement(query);
  }

  @Get('management/:id')
  @Roles(UserRole.RH)
  findOneForManagement(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.derogationsService.findOneForManagement(id);
  }

  @Patch(':id')
  @Roles(...DEROGATION_REQUESTER_ROLES)
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateDerogationDto,
  ) {
    return this.derogationsService.updateDraft(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/submit')
  @Roles(...DEROGATION_REQUESTER_ROLES)
  @HttpCode(HttpStatus.OK)
  submitDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.derogationsService.submitDraft(
      id,
      request.user,
    );
  }

  @Patch(':id/decision')
  @Roles(UserRole.RH)
  @HttpCode(HttpStatus.OK)
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: DecideDerogationDto,
  ) {
    return this.derogationsService.decide(
      id,
      request.user,
      dto,
    );
  }

  @Delete(':id')
  @Roles(...DEROGATION_REQUESTER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.derogationsService.deleteDraft(
      id,
      request.user,
    );
  }
}
