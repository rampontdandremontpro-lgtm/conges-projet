import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum DerogationDecision {
  ACCORDER = 'ACCORDER',
  REFUSER = 'REFUSER',
}

export class DecideDerogationDto {
  @IsEnum(DerogationDecision)
  decision!: DerogationDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  decisionComment?: string;
}
