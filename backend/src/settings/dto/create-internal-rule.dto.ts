import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInternalRuleDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;
}
