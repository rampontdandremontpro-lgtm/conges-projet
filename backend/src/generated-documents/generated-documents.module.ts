import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { GeneratedDocument } from './generated-document.entity';
import { GeneratedDocumentsService } from './generated-documents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedDocument,
      LeaveRequest,
    ]),
  ],
  providers: [GeneratedDocumentsService],
  exports: [GeneratedDocumentsService, TypeOrmModule],
})
export class GeneratedDocumentsModule {}
