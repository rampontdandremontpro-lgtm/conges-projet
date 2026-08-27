import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { UpdateSeasonalPeriodDto } from './dto/update-seasonal-period.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { CreatePracticalLinkDto } from './dto/create-practical-link.dto';
import { UpdatePracticalLinkDto } from './dto/update-practical-link.dto';
import { SettingsService } from './settings.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  findPublic() {
    return this.settingsService.findPublic();
  }


  @Get('practical-links')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  getPracticalLinks() {
    return this.settingsService.getPracticalLinks();
  }

  @Post('practical-links')
  @Roles(UserRole.RH)
  createPracticalLink(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePracticalLinkDto,
  ) {
    return this.settingsService.createPracticalLink(dto, request.user);
  }

  @Patch('practical-links/:id')
  @Roles(UserRole.RH)
  updatePracticalLink(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePracticalLinkDto,
  ) {
    return this.settingsService.updatePracticalLink(id, dto, request.user);
  }

  @Delete('practical-links/:id')
  @Roles(UserRole.RH)
  deletePracticalLink(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settingsService.deletePracticalLink(id, request.user);
  }

  @Get('seasonal-period')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  async findSeasonalPeriod() {
    const rules = await this.settingsService.getSubmissionRules();
    return {
      summerPeriodStart: rules.summerPeriodStart,
      summerPeriodEnd: rules.summerPeriodEnd,
    };
  }

  @Patch('seasonal-period')
  @Roles(UserRole.ADMIN, UserRole.RH)
  updateSeasonalPeriod(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSeasonalPeriodDto,
  ) {
    return this.settingsService.updateSeasonalPeriod(
      dto.summerPeriodStart,
      dto.summerPeriodEnd,
      request.user,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.RH)
  findAll() {
    return this.settingsService.findAll();
  }

  @Get(':key')
  @Roles(UserRole.ADMIN, UserRole.RH)
  findOne(@Param('key') key: string) {
    return this.settingsService.findOne(key);
  }

  @Patch(':key')
  @Roles(UserRole.ADMIN, UserRole.RH)
  update(
    @Param('key') key: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSettingDto,
  ) {
    return this.settingsService.update(key, dto, request.user);
  }
}
