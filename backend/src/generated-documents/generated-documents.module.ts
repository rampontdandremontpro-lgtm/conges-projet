import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Document } from '../documents/document.entity';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { GeneratedDocumentsService } from './generated-documents.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, LeaveRequest])],
  providers: [GeneratedDocumentsService],
  exports: [GeneratedDocumentsService, TypeOrmModule],
})
export class GeneratedDocumentsModule {}
