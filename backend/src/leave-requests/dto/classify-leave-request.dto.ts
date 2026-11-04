import { IsEnum } from 'class-validator';

import { LeaveClassification } from '../leave-request.entity';

export class ClassifyLeaveRequestDto {
  @IsEnum(LeaveClassification)
  classification!: LeaveClassification;
}
