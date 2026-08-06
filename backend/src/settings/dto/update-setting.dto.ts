import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @Length(1, 2000)
  settingValue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
