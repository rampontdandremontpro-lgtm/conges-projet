import {
  Body,
  Controller,
  Get,
  Param,
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
import { UpdateSeasonalPeriodDto } from './dto/update-seasonal-period.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
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
