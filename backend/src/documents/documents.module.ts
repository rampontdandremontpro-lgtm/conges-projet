import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { AbsenceDeclarationsModule } from '../absence-declarations/absence-declarations.module';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Document } from './document.entity';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      AbsenceDeclaration,
      LeaveRequest,
    ]),
    AbsenceDeclarationsModule,
    NotificationsModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentPdfService],
  exports: [DocumentsService, DocumentPdfService, TypeOrmModule],
})
export class DocumentsModule {}
