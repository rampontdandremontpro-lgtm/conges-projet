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
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.entity';
import { DocumentQueryDto } from './dto/document-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import {
  DocumentsService,
  type UploadedDocumentFile,
} from './documents.service';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.COLLABORATEUR,
  UserRole.RESPONSABLE_SERVICE,
  UserRole.RH,
  UserRole.DIRECTEUR,
)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
  ) {}

  @Post('absence/:absenceDeclarationId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  uploadForAbsence(
    @Param('absenceDeclarationId', ParseIntPipe)
    absenceDeclarationId: number,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.documentsService.uploadForAbsence(
      absenceDeclarationId,
      request.user,
      file,
    );
  }

  @Post('request/:leaveRequestId')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  uploadForLeaveRequest(
    @Param('leaveRequestId', ParseIntPipe)
    leaveRequestId: number,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.documentsService.uploadForLeaveRequest(
      leaveRequestId,
      request.user,
      file,
    );
  }

  @Get('my')
  findMy(@Req() request: AuthenticatedRequest) {
    return this.documentsService.findMy(request.user);
  }

  @Get('management')
  @Roles(UserRole.RH)
  findForManagement(@Query() query: DocumentQueryDto) {
    return this.documentsService.findForManagement(query);
  }

  @Get('absence/:absenceDeclarationId')
  findForAbsence(
    @Param('absenceDeclarationId', ParseIntPipe)
    absenceDeclarationId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documentsService.findForAbsence(
      absenceDeclarationId,
      request.user,
    );
  }

  @Get('request/:leaveRequestId')
  findForLeaveRequest(
    @Param('leaveRequestId', ParseIntPipe)
    leaveRequestId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documentsService.findForLeaveRequest(
      leaveRequestId,
      request.user,
    );
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.documentsService.openForUser(
      id,
      request.user,
    );
    const originalName =
      result.document.originalName ?? `justificatif-${result.document.id}`;
    const mimeType =
      result.document.mimeType ?? 'application/octet-stream';
    const encodedName = encodeURIComponent(originalName);

    response.setHeader('Content-Type', mimeType);

    if (result.document.fileSize !== null) {
      response.setHeader(
        'Content-Length',
        result.document.fileSize.toString(),
      );
    }
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="justificatif"; filename*=UTF-8''${encodedName}`,
    );
    response.setHeader(
      'Cache-Control',
      'private, no-store, max-age=0',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = this.documentsService.createReadStream(
      result.absolutePath,
    );

    stream.on('error', () => {
      if (!response.headersSent) {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
      } else {
        response.end();
      }
    });

    stream.pipe(response);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.RH)
  accept(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documentsService.accept(id, request.user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.RH)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RejectDocumentDto,
  ) {
    return this.documentsService.reject(
      id,
      request.user,
      dto.reason,
    );
  }

  @Patch(':id/replace')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  replace(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.documentsService.replace(
      id,
      request.user,
      file,
    );
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documentsService.remove(id, request.user);
  }
}
