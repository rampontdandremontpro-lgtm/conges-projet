import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class FractionnementEntityDto {
  @IsString()
  code!: string;

  @IsIn(['SYNTEC', 'LEGAL', 'NONE'])
  regime!: 'SYNTEC' | 'LEGAL' | 'NONE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  oneDayMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  twoDaysMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  mainLeaveCap?: number;
}

export class UpdateFractionnementConfigDto {
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'eligiblePeriodStart doit respecter le format MM-JJ.',
  })
  eligiblePeriodStart!: string;

  @IsString()
  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'eligiblePeriodEnd doit respecter le format MM-JJ.',
  })
  eligiblePeriodEnd!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FractionnementEntityDto)
  entities!: FractionnementEntityDto[];
}
