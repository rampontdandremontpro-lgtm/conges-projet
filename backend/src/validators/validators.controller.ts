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

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { AssignBackupValidatorDto } from './dto/assign-backup-validator.dto';
import { CreateValidatorReplacementDto } from './dto/create-validator-replacement.dto';
import { ValidatorReplacementQueryDto } from './dto/validator-replacement-query.dto';
import { ValidatorsService } from './validators.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ValidatorsController {
  constructor(
    private readonly validatorsService: ValidatorsService,
  ) {}

  @Get('services/:id/validators')
  @Roles(UserRole.ADMIN, UserRole.RH)
  getServiceValidators(@Param('id', ParseIntPipe) id: number) {
    return this.validatorsService.getServiceValidators(id);
  }

  @Post('services/:id/validators')
  @Roles(UserRole.ADMIN, UserRole.RH)
  assignBackupValidator(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignBackupValidatorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.validatorsService.assignBackupValidator(
      id,
      dto.validatorId,
      request.user,
    );
  }

  @Patch('services/:id/validators/:validatorId/disable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  disableBackupValidator(
    @Param('id', ParseIntPipe) id: number,
    @Param('validatorId', ParseIntPipe) validatorId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.validatorsService.disableBackupValidator(
      id,
      validatorId,
      request.user,
    );
  }

  @Patch('services/:id/validators/:validatorId/enable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  enableBackupValidator(
    @Param('id', ParseIntPipe) id: number,
    @Param('validatorId', ParseIntPipe) validatorId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.validatorsService.enableBackupValidator(
      id,
      validatorId,
      request.user,
    );
  }

  @Post('validator-replacements')
  @Roles(UserRole.ADMIN, UserRole.RH)
  createReplacement(
    @Body() dto: CreateValidatorReplacementDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.validatorsService.createReplacement(
      dto,
      request.user,
    );
  }

  @Get('validator-replacements')
  @Roles(UserRole.ADMIN, UserRole.RH)
  listReplacements(
    @Query() query: ValidatorReplacementQueryDto,
  ) {
    return this.validatorsService.listReplacements(query);
  }

  @Get('validator-replacements/:id')
  @Roles(UserRole.ADMIN, UserRole.RH)
  findReplacement(@Param('id', ParseIntPipe) id: number) {
    return this.validatorsService.findReplacement(id);
  }

  @Patch('validator-replacements/:id/disable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  disableReplacement(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.validatorsService.disableReplacement(
      id,
      request.user,
    );
  }
}
