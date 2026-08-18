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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentPdfService } from '../documents/document-pdf.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { CancelLeaveRequestDto } from './dto/cancel-leave-request.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RefuseLeaveRequestDto } from './dto/refuse-leave-request.dto';
import { RequestCancellationAfterValidationDto } from './dto/request-cancellation-after-validation.dto';
import { RespondCancellationDto } from './dto/respond-cancellation.dto';
import { SubmitLeaveRequestDto } from './dto/submit-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { ValidateLeaveRequestDto } from './dto/validate-leave-request.dto';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveRequestSchedulerService } from './leave-request-scheduler.service';

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
    private readonly documentPdfService: DocumentPdfService,
    private readonly leaveRequestSchedulerService: LeaveRequestSchedulerService,
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

  @Post('director')
  @Roles(UserRole.DIRECTEUR)
  createDirectorRequest(
    @Req() request: AuthenticatedRequest,
    @Body() createLeaveRequestDto: CreateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.createDirectorRequest(
      request.user,
      createLeaveRequestDto,
    );
  }

  @Get('my')
  findMyRequests(@Req() request: AuthenticatedRequest) {
    return this.leaveRequestsService.findMyRequests(request.user);
  }

  @Get('director/pending')
  @Roles(UserRole.DIRECTEUR)
  findPendingForDirector(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findPendingForDirector(
      request.user,
    );
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() submitLeaveRequestDto: SubmitLeaveRequestDto,
  ) {
    return this.leaveRequestsService.submit(
      id,
      request.user,
      submitLeaveRequestDto,
    );
  }

  @Get('management/all')
  @Roles(UserRole.RH, UserRole.DIRECTEUR)
  findAllForRh() {
    return this.leaveRequestsService.findAllForRh();
  }

  @Get('pending')
  @Roles(
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  findPendingForDecision(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findPendingForDecision(
      request.user,
    );
  }

  @Post('maintenance/run')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.RH)
  runMaintenance() {
    return this.leaveRequestSchedulerService.runMaintenance();
  }

  @Get('management/:id/alerts')
  @Roles(
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  getServiceAvailability(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.getServiceAvailability(
      id,
      request.user,
    );
  }

  @Get('management/:id')
  @Roles(
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  findRequestForDecision(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findRequestForDecision(
      id,
      request.user,
    );
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  validateRequest(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ValidateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.validateRequest(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  refuseRequest(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RefuseLeaveRequestDto,
  ) {
    return this.leaveRequestsService.refuseRequest(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelBeforeDecision(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CancelLeaveRequestDto,
  ) {
    return this.leaveRequestsService.cancelBeforeDecision(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/cancellation-request')
  @HttpCode(HttpStatus.OK)
  requestCancellationAfterValidation(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestCancellationAfterValidationDto,
  ) {
    return this.leaveRequestsService.requestCancellationAfterValidation(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/cancellation-consent')
  @HttpCode(HttpStatus.OK)
  respondToCancellation(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RespondCancellationDto,
  ) {
    return this.leaveRequestsService.respondToCancellation(
      id,
      request.user,
      dto,
    );
  }

  @Post(':id/cancellation-complete')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.RH)
  completeCancellationAfterValidation(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.completeCancellationAfterValidation(
      id,
      request.user,
    );
  }

  @Get(':id/cancellation')
  findCancellation(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findCancellationRequest(
      id,
      request.user,
    );
  }

  @Get(':id/pending-summary-pdf')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  async downloadPendingSummaryPdf(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file =
      await this.documentPdfService.getPendingSummaryPdf(
        id,
        request.user,
      );

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'X-Document-Reference',
      file.referenceNumber,
    );
    response.setHeader('X-Document-Checksum', file.checksum);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');

    return new StreamableFile(file.buffer);
  }

  @Get(':id/cancellation-pdf')
  async downloadCancellationPdf(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file =
      await this.documentPdfService.getCancellationPdf(
        id,
        request.user,
      );

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader(
      'X-Document-Reference',
      file.referenceNumber,
    );
    response.setHeader('X-Document-Checksum', file.checksum);

    return new StreamableFile(file.buffer);
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.COLLABORATEUR,
    UserRole.RESPONSABLE_SERVICE,
    UserRole.RH,
    UserRole.DIRECTEUR,
  )
  async downloadValidationPdf(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file =
      await this.documentPdfService.getValidationPdf(
        id,
        request.user,
      );

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader(
      'Content-Length',
      String(file.buffer.length),
    );
    response.setHeader(
      'X-Document-Reference',
      file.referenceNumber,
    );
    response.setHeader(
      'X-Document-Checksum',
      file.checksum,
    );

    return new StreamableFile(file.buffer);
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
  updateRequest(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() updateLeaveRequestDto: UpdateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.updateRequest(
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
