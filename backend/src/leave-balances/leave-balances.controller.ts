import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { AddBalanceAccrualDto } from './dto/add-balance-accrual.dto';
import { CorrectLeaveBalanceDto } from './dto/correct-leave-balance.dto';
import { InitializeLeaveBalanceDto } from './dto/initialize-leave-balance.dto';
import { LeaveBalanceQueryDto } from './dto/leave-balance-query.dto';
import { RunMonthlyAccrualDto } from './dto/run-monthly-accrual.dto';
import { LeaveBalancesService } from './leave-balances.service';
import { MonthlyAccrualService } from './monthly-accrual.service';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('leave-balances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveBalancesController {
  constructor(
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly monthlyAccrualService: MonthlyAccrualService,
  ) {}

  @Get('my/history')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getMyHistory(
    @Req() request: AuthenticatedRequest,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeHistory(
      request.user.id,
      query,
    );
  }

  @Get('my')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getMyBalances(
    @Req() request: AuthenticatedRequest,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeBalances(
      request.user.id,
      query,
    );
  }

  @Get('employee/:employeeId/history')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getEmployeeHistory(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeHistory(
      employeeId,
      query,
    );
  }

  @Get('employee/:employeeId')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getEmployeeBalances(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeBalances(
      employeeId,
      query,
    );
  }

  @Post('initialize')
  @Roles(UserRole.RH)
  initializeBalance(
    @Req() request: AuthenticatedRequest,
    @Body() dto: InitializeLeaveBalanceDto,
  ) {
    return this.leaveBalancesService.initializeBalance(
      request.user,
      dto,
    );
  }

  @Post('accrual/run')
  @Roles(UserRole.RH)
  runMonthlyAccrual(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RunMonthlyAccrualDto,
  ) {
    return this.monthlyAccrualService.runForMonth(
      dto.accrualMonth,
      request.user.id,
    );
  }

  @Post(':id/accrual')
  @Roles(UserRole.RH)
  addAccrual(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddBalanceAccrualDto,
  ) {
    return this.leaveBalancesService.addAccrual(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/correction')
  @Roles(UserRole.RH)
  correctBalance(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CorrectLeaveBalanceDto,
  ) {
    return this.leaveBalancesService.correctBalance(
      id,
      request.user,
      dto,
    );
  }
}
