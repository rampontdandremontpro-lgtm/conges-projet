import {
  Controller,
  Get,
  Res,
  StreamableFile,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { ExportQueryDto } from './dto/export-query.dto';
import { ExportsService } from './exports.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RH)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('leave-requests')
  async exportLeaveRequests(
    @Req() request: AuthenticatedRequest,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportsService.exportLeaveRequests(
      query,
      request.user,
    );
    this.setDownloadHeaders(response, file.contentType, file.fileName);
    return new StreamableFile(file.buffer);
  }

  @Get('absence-declarations')
  async exportAbsenceDeclarations(
    @Req() request: AuthenticatedRequest,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportsService.exportAbsenceDeclarations(
      query,
      request.user,
    );
    this.setDownloadHeaders(response, file.contentType, file.fileName);
    return new StreamableFile(file.buffer);
  }

  private setDownloadHeaders(
    response: Response,
    contentType: string,
    fileName: string,
  ): void {
    response.setHeader('Content-Type', contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
  }
}
