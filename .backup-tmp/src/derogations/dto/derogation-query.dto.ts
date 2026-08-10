import { IsEnum, IsOptional } from 'class-validator';

import { DerogationStatus } from '../derogation.entity';

export class DerogationQueryDto {
  @IsOptional()
  @IsEnum(DerogationStatus)
  status?: DerogationStatus;
}
