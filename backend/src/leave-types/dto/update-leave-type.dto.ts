import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateLeaveTypeDto } from './create-leave-type.dto';

export class UpdateLeaveTypeDto extends PartialType(
  CreateLeaveTypeDto,
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
