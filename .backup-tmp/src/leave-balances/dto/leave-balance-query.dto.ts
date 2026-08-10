import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import { LeaveBalanceCounterType } from '../leave-balance.entity';

export class LeaveBalanceQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, {
    message:
      'La période de référence doit respecter le format AAAA-AAAA.',
  })
  referencePeriod?: string;

  @IsOptional()
  @IsEnum(LeaveBalanceCounterType)
  counterType?: LeaveBalanceCounterType;
}
