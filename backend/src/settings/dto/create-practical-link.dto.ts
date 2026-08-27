import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreatePracticalLinkDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @MaxLength(1000)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}
