import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
import { ImportLeaveBalancesDto } from './dto/import-leave-balances.dto';
import { LeaveBalanceProjectionQueryDto } from './dto/leave-balance-projection-query.dto';
import { LeaveBalanceQueryDto } from './dto/leave-balance-query.dto';
import { RunMonthlyAccrualDto } from './dto/run-monthly-accrual.dto';
import { RegularizeAccrualDto } from './dto/regularize-accrual.dto';
import { CloseReferencePeriodDto } from './dto/close-reference-period.dto';
import { ExceptionalCarryoverDto } from './dto/exceptional-carryover.dto';
import { LeaveBalancesService } from './leave-balances.service';
import { MonthlyAccrualService } from './monthly-accrual.service';
import { ReferencePeriodService } from './reference-period.service';
import { SeniorityExtraDaysService } from './seniority-extra-days.service';
import { FractionnementService } from './fractionnement.service';
import { TakePeriodService } from './take-period.service';
import { ApplySeniorityExtraDto } from './dto/apply-seniority-extra.dto';
import { UpdateSeniorityExtraConfigDto } from './dto/update-seniority-extra-config.dto';
import { ApplyFractionnementDto } from './dto/apply-fractionnement.dto';
import { UpdateFractionnementConfigDto } from './dto/update-fractionnement-config.dto';
import { CreateTakePeriodReportDto } from './dto/create-take-period-report.dto';
import { UpdateTakePeriodReportDto } from './dto/update-take-period-report.dto';
import { ArreteChevauchementService } from './arrete-chevauchement.service';
import { AccrualAnomalyService } from './accrual-anomaly.service';
import {
  AccrualAnomalyResolutionMode,
  AccrualAnomalyStatus,
} from './accrual-anomaly.entity';
import { NotFoundException } from '@nestjs/common';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Controller('leave-balances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveBalancesController {
  constructor(
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly monthlyAccrualService: MonthlyAccrualService,
    private readonly referencePeriodService: ReferencePeriodService,
    private readonly seniorityExtraDaysService: SeniorityExtraDaysService,
    private readonly fractionnementService: FractionnementService,
    private readonly takePeriodService: TakePeriodService,
    private readonly arreteChevauchementService: ArreteChevauchementService,
    private readonly accrualAnomalyService: AccrualAnomalyService,
  ) {}

  @Get('management')
  @Roles(UserRole.RH)
  getManagementOverview(@Query() query: LeaveBalanceQueryDto) {
    return this.leaveBalancesService.getManagementOverview(query);
  }


  @Get('my/summary')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getMyPeriodSummaries(@Req() request: AuthenticatedRequest) {
    return this.leaveBalancesService.getEmployeePeriodSummaries(request.user.id);
  }

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


  @Get('my/projection')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getMyBalanceProjection(
    @Req() request: AuthenticatedRequest,
    @Query() query: LeaveBalanceProjectionQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeBalanceProjection(request.user.id, query);
  }

  @Get('employee/:employeeId/projection')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getEmployeeBalanceProjection(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query() query: LeaveBalanceProjectionQueryDto,
  ) {
    return this.leaveBalancesService.getEmployeeBalanceProjection(employeeId, query);
  }

  @Get('employee/:employeeId/summary')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  getEmployeePeriodSummaries(
    @Param('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.leaveBalancesService.getEmployeePeriodSummaries(employeeId);
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

  @Get('period/:referencePeriod/preview')
  @Roles(UserRole.RH)
  previewReferencePeriod(
    @Param('referencePeriod') referencePeriod: string,
  ): Promise<unknown> {
    return this.referencePeriodService.previewClosure(referencePeriod);
  }

  @Post('period/carryover')
  @Roles(UserRole.RH)
  approveExceptionalCarryover(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ExceptionalCarryoverDto,
  ) {
    return this.referencePeriodService.approveExceptionalCarryover(
      request.user,
      dto,
    );
  }

  @Post('period/close')
  @Roles(UserRole.RH)
  closeReferencePeriod(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CloseReferencePeriodDto,
  ) {
    return this.referencePeriodService.closeReferencePeriod(
      request.user,
      dto,
    );
  }

  @Post('import/preview')
  @Roles(UserRole.RH)
  previewBalanceImport(@Body() dto: ImportLeaveBalancesDto) {
    return this.leaveBalancesService.previewBalanceImport(dto);
  }

  @Post('import/confirm')
  @Roles(UserRole.RH)
  importBalances(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ImportLeaveBalancesDto,
  ) {
    return this.leaveBalancesService.importBalances(request.user, dto);
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

  @Post('accrual/regularize')
  @Roles(UserRole.RH)
  regularizeAccrual(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RegularizeAccrualDto,
  ) {
    return this.monthlyAccrualService.regularizeAbsenceImpact(
      dto.employeeId,
      dto.startDate,
      dto.endDate,
      request.user.id,
    );
  }

  @Get('accrual-anomalies')
  @Roles(UserRole.RH)
  listAccrualAnomalies(@Query('status') status?: string) {
    const normalized = status === 'RESOLVED' ? AccrualAnomalyStatus.RESOLVED
      : status === 'OPEN' ? AccrualAnomalyStatus.OPEN
      : status === 'RH_DECIDED' ? AccrualAnomalyStatus.RH_DECIDED
      : undefined;
    return this.accrualAnomalyService.list(normalized);
  }

  @Post('accrual-anomalies/:id/resolve')
  @Roles(UserRole.RH)
  async resolveAccrualAnomaly(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() body?: { decisionReason?: string; retainedKind?: string },
  ) {
    const anomaly = await this.accrualAnomalyService.findById(id);
    if (!anomaly) {
      throw new NotFoundException(`L’anomalie ${id} est introuvable.`);
    }

    // Vérification de l'état RÉEL des déclarations avant toute clôture.
    const actualDays = await this.monthlyAccrualService.recomputeAnomalyDays({
      employeeId: anomaly.employeeId,
      type: anomaly.type,
      referencePeriod: anomaly.referencePeriod,
      accrualMonth: anomaly.accrualMonth,
      conflictKey: anomaly.conflictKey,
    });

    // Incohérence technique (salarié introuvable, période incohérente…) :
    // jamais de clôture VERIFIED automatique ; décision RH justifiée requise.
    if (actualDays === null || actualDays > 0) {
      return this.accrualAnomalyService.resolve(id, request.user.id, {
        mode: AccrualAnomalyResolutionMode.RH_DECISION,
        decisionReason: body?.decisionReason,
        retainedKind: body?.retainedKind,
      });
    }

    return this.accrualAnomalyService.resolve(id, request.user.id, {
      mode: AccrualAnomalyResolutionMode.VERIFIED,
    });
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

  // ── JUR-019 / JUR-020 — Congés d'ancienneté (Syntec 5.1) ────────────────

  @Get('seniority-extra/config')
  @Roles(UserRole.RH)
  getSeniorityExtraConfig() {
    return this.seniorityExtraDaysService.getConfig();
  }

  @Put('seniority-extra/config')
  @Roles(UserRole.RH)
  updateSeniorityExtraConfig(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSeniorityExtraConfigDto,
  ) {
    return this.seniorityExtraDaysService.updateConfig(
      dto,
      request.user.id,
    );
  }

  @Get('seniority-extra/preview/:referencePeriod')
  @Roles(UserRole.RH)
  previewSeniorityExtra(
    @Param('referencePeriod') referencePeriod: string,
  ) {
    return this.seniorityExtraDaysService.preview(referencePeriod);
  }

  @Post('seniority-extra/apply')
  @Roles(UserRole.RH)
  applySeniorityExtra(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ApplySeniorityExtraDto,
  ) {
    return this.seniorityExtraDaysService.apply(
      dto.referencePeriod,
      request.user.id,
    );
  }

  // ── JUR-021 / JUR-022 — Fractionnement (Syntec 5.1 / L3141-23) ──────────

  @Get('fractionnement/config')
  @Roles(UserRole.RH)
  getFractionnementConfig() {
    return this.fractionnementService.getConfig();
  }

  @Put('fractionnement/config')
  @Roles(UserRole.RH)
  updateFractionnementConfig(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateFractionnementConfigDto,
  ) {
    return this.fractionnementService.updateConfig(
      dto,
      request.user.id,
    );
  }

  @Get('fractionnement/preview/:referencePeriod')
  @Roles(UserRole.RH)
  previewFractionnement(
    @Param('referencePeriod') referencePeriod: string,
  ) {
    return this.fractionnementService.preview(referencePeriod);
  }

  @Post('fractionnement/apply')
  @Roles(UserRole.RH)
  applyFractionnement(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ApplyFractionnementDto,
  ) {
    return this.fractionnementService.apply(
      dto.referencePeriod,
      request.user.id,
    );
  }

  @Post('fractionnement/recompute')
  @Roles(UserRole.RH)
  recomputeFractionnement(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ApplyFractionnementDto,
  ) {
    return this.fractionnementService.recomputeAll(
      dto.referencePeriod,
      request.user.id,
    );
  }

  // ── JUR-023 — Période de prise (13 mois) ─────────────────────────────────

  @Get('take-period/:referencePeriod')
  @Roles(UserRole.RH)
  getTakePeriodOverview(
    @Param('referencePeriod') referencePeriod: string,
  ) {
    return this.takePeriodService.getOverview(referencePeriod);
  }

  @Get('take-period/:referencePeriod/reports')
  @Roles(UserRole.RH)
  listTakePeriodReports(
    @Param('referencePeriod') referencePeriod: string,
  ) {
    return this.takePeriodService.listReports(referencePeriod);
  }

  @Post('take-period/report')
  @Roles(UserRole.RH)
  createTakePeriodReport(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTakePeriodReportDto,
  ) {
    return this.takePeriodService.createReport(request.user, dto);
  }

  @Patch('take-period/report/:id')
  @Roles(UserRole.RH)
  updateTakePeriodReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateTakePeriodReportDto,
  ) {
    return this.takePeriodService.updateReport(request.user, id, dto);
  }

  // ── JUR-028 — Interaction arrêt maladie / congés posés ──────────────────

  @Get('arret-chevauchement/:absenceDeclarationId')
  @Roles(UserRole.RH)
  previewArreteChevauchement(
    @Param('absenceDeclarationId', ParseIntPipe)
    absenceDeclarationId: number,
  ) {
    return this.arreteChevauchementService.preview(absenceDeclarationId);
  }

  @Post('arret-chevauchement/:absenceDeclarationId/restore')
  @Roles(UserRole.RH)
  restoreArreteChevauchement(
    @Param('absenceDeclarationId', ParseIntPipe)
    absenceDeclarationId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arreteChevauchementService.restoreForAbsence(
      absenceDeclarationId,
      request.user.id,
    );
  }

  @Post('arret-chevauchement/:absenceDeclarationId/reverse')
  @Roles(UserRole.RH)
  reverseArreteChevauchement(
    @Param('absenceDeclarationId', ParseIntPipe)
    absenceDeclarationId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arreteChevauchementService.reverseForAbsence(
      absenceDeclarationId,
      request.user.id,
    );
  }
}
