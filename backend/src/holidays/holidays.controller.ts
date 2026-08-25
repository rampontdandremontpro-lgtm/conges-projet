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
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { SyncHolidaysDto } from './dto/sync-holidays.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { UpdateHolidayWorkStatusDto } from './dto/update-holiday-work-status.dto';
import { HolidaysService } from './holidays.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('holidays')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RH)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createHolidayDto: CreateHolidayDto,
  ) {
    return this.holidaysService.create(
      request.user,
      createHolidayDto,
    );
  }

  @Patch('work-status')
  @Roles(UserRole.ADMIN, UserRole.RH)
  updateWorkStatus(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateHolidayWorkStatusDto,
  ) {
    return this.holidaysService.updateWorkStatus(request.user, dto);
  }

  @Post('sync/martinique')
  @Roles(UserRole.ADMIN, UserRole.RH)
  syncMartinique(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SyncHolidaysDto,
  ) {
    return this.holidaysService.syncMartinique(dto.year, request.user);
  }

  @Get('management')
  @Roles(UserRole.ADMIN, UserRole.RH)
  findAllForManagement(@Query('year') year?: string) {
    return this.holidaysService.findAllForManagement(
      this.parseOptionalYear(year),
    );
  }

  @Get()
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  findAllActive(@Query('year') year?: string) {
    return this.holidaysService.findAllActive(
      this.parseOptionalYear(year),
    );
  }

  @Get(':id')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
    UserRole.ADMIN,
  )
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.holidaysService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RH)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateHolidayDto: UpdateHolidayDto,
  ) {
    return this.holidaysService.update(id, updateHolidayDto);
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  disable(@Param('id', ParseIntPipe) id: number) {
    return this.holidaysService.disable(id);
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  enable(@Param('id', ParseIntPipe) id: number) {
    return this.holidaysService.enable(id);
  }

  private parseOptionalYear(value?: string): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const year = Number(value);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException(
        'Le paramètre year doit être une année comprise entre 2000 et 2100.',
      );
    }

    return year;
  }
}
