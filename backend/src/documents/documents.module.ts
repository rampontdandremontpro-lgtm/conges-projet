import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbsenceDeclaration } from '../absence-declarations/absence-declaration.entity';
import { AbsenceDeclarationsModule } from '../absence-declarations/absence-declarations.module';
import { LeaveRequest } from '../leave-requests/leave-request.entity';
import { Document } from './document.entity';
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
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService, TypeOrmModule],
})
export class DocumentsModule {}
