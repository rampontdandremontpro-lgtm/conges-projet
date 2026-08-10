import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveTypesService } from './leave-types.service';

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

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN, UserRole.RH)
  enable(@Param('id', ParseIntPipe) id: number) {
    return this.leaveTypesService.enable(id);
  }
}
