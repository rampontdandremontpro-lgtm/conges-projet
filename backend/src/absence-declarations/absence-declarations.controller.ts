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
import { AbsenceDeclarationsService } from './absence-declarations.service';
import { AbsenceDeclarationQueryDto } from './dto/absence-declaration-query.dto';
import { CreateAbsenceDeclarationDto } from './dto/create-absence-declaration.dto';
import { SubmitAbsenceDeclarationDto } from './dto/submit-absence-declaration.dto';
import { UpdateAbsenceDeclarationDto } from './dto/update-absence-declaration.dto';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('absence-declarations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
)
export class AbsenceDeclarationsController {
  constructor(
    private readonly absenceDeclarationsService: AbsenceDeclarationsService,
  ) {}

  @Post()
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAbsenceDeclarationDto,
  ) {
    return this.absenceDeclarationsService.createDraft(
      request.user,
      dto,
    );
  }

  @Get('my')
  findMy(@Req() request: AuthenticatedRequest) {
    return this.absenceDeclarationsService.findMy(request.user);
  }

  @Get('management')
  @Roles(UserRole.RH)
  findForManagement(
    @Query() query: AbsenceDeclarationQueryDto,
  ) {
    return this.absenceDeclarationsService.findForManagement(
      query,
    );
  }

  @Get('management/:id')
  @Roles(UserRole.RH)
  findOneForManagement(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.absenceDeclarationsService.findOneForManagement(
      id,
    );
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SubmitAbsenceDeclarationDto,
  ) {
    return this.absenceDeclarationsService.submit(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/register')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.RH)
  registerByRh(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.absenceDeclarationsService.registerByRh(
      id,
      request.user,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.absenceDeclarationsService.deleteDraft(
      id,
      request.user,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.absenceDeclarationsService.cancel(
      id,
      request.user,
    );
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.absenceDeclarationsService.findAccessibleOne(
      id,
      request.user,
    );
  }

  @Patch(':id')
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateAbsenceDeclarationDto,
  ) {
    return this.absenceDeclarationsService.updateDraft(
      id,
      request.user,
      dto,
    );
  }
}
