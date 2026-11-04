import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { UserRole } from '../../users/user.entity';
import {
  CarryoverNotificationTransmissionMode,
} from './carryover-notification.entity';
import {
  CarryoverReceptionProofMode,
} from './carryover-reception-proof.entity';
import { CarryoverNotificationService } from './carryover-notification.service';
import {
  AttachProofDto,
  PrepareNotificationDto,
  ReasonDto,
  TransmitNotificationDto,
  VerifyProofDto,
} from './carryover-notification.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/**
 * JUR-027 — Lot L6 : notification individuelle d'information des salariés et
 * preuves de réception. RH + consultation individuelle du salarié.
 * Aucun envoi réel (e-mail/SMS) : les API enregistrent uniquement la
 * transmission et les preuves en recette.
 */
@Controller('carryover-notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CarryoverNotificationController {
  constructor(private readonly service: CarryoverNotificationService) {}

  @Get('candidates')
  @Roles(UserRole.RH)
  candidates(@Req() request: AuthenticatedRequest) {
    return this.service.listCandidates(request.user);
  }

  @Get('my')
  my(@Req() request: AuthenticatedRequest) {
    return this.service.getMine(request.user);
  }

  @Post('prepare')
  @Roles(UserRole.RH)
  prepare(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PrepareNotificationDto,
  ) {
    return this.service.prepare(dto.employeeId, request.user);
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getOne(Number(id), request.user);
  }

  @Post(':id/validate')
  @Roles(UserRole.RH)
  validate(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.validate(Number(id), request.user);
  }

  @Post(':id/transmit')
  @Roles(UserRole.RH)
  transmit(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: TransmitNotificationDto,
  ) {
    return this.service.transmit(
      Number(id),
      request.user,
      dto.mode as CarryoverNotificationTransmissionMode,
    );
  }

  @Post(':id/proofs')
  @Roles(UserRole.RH)
  attachProof(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AttachProofDto,
  ) {
    return this.service.attachProof(Number(id), request.user, {
      mode: dto.mode as CarryoverReceptionProofMode,
      receivedAt: dto.receivedAt,
      proofReference: dto.proofReference,
      mimeType: dto.mimeType,
      contentBase64: dto.contentBase64,
    });
  }

  @Post(':id/proofs/:proofId/verify')
  @Roles(UserRole.RH)
  verifyProof(
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyProofDto,
  ) {
    return this.service.verifyProof(Number(id), Number(proofId), request.user, {
      result: dto.result,
      note: dto.note,
      recipientIdentityConfirmed: dto.recipientIdentityConfirmed,
      requiredInfoPresent: dto.requiredInfoPresent,
    });
  }

  @Get(':id/proofs/:proofId/download')
  @Roles(UserRole.RH)
  downloadProof(
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.downloadProof(Number(id), Number(proofId), request.user);
  }

  @Get(':id/history')
  @Roles(UserRole.RH)
  history(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.history(Number(id), request.user);
  }

  @Post(':id/correct')
  @Roles(UserRole.RH)
  correct(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReasonDto,
  ) {
    return this.service.correct(Number(id), request.user, dto.reason);
  }

  @Post(':id/cancel')
  @Roles(UserRole.RH)
  cancel(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReasonDto,
  ) {
    return this.service.cancel(Number(id), request.user, dto.reason);
  }

  @Post(':id/corrected')
  @Roles(UserRole.RH)
  createCorrected(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReasonDto,
  ) {
    return this.service.createCorrected(Number(id), request.user, dto.reason);
  }
}
