import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NotificationPreferenceItemDto {
  @IsString()
  @MaxLength(100)
  key!: string;

  @IsBoolean()
  application!: boolean;

  @IsBoolean()
  email!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences!: NotificationPreferenceItemDto[];
}
