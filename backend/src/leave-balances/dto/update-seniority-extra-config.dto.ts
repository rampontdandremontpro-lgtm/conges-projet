import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class SeniorityThresholdDto {
  @IsInt()
  @Min(0)
  minYears!: number;

  @IsNumber()
  @Min(0)
  extraDays!: number;
}

export class UpdateSeniorityExtraConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'referenceMonthDay doit respecter le format MM-JJ.',
  })
  referenceMonthDay!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeniorityThresholdDto)
  thresholds!: SeniorityThresholdDto[];

  @IsArray()
  @IsString({ each: true })
  legalEntityCodes!: string[];
}
