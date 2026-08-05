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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { LeaveRequestsService } from './leave-requests.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
)
export class LeaveRequestsController {
  constructor(
    private readonly leaveRequestsService: LeaveRequestsService,
  ) {}

  @Post()
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Body() createLeaveRequestDto: CreateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.createDraft(
      request.user,
      createLeaveRequestDto,
    );
  }

  @Get('my')
  findMyRequests(@Req() request: AuthenticatedRequest) {
    return this.leaveRequestsService.findMyRequests(request.user);
  }

  @Get(':id')
  findMyRequest(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findMyRequest(
      id,
      request.user,
    );
  }

  @Patch(':id')
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() updateLeaveRequestDto: UpdateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.updateDraft(
      id,
      request.user,
      updateLeaveRequestDto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.deleteDraft(
      id,
      request.user,
    );
  }
}
