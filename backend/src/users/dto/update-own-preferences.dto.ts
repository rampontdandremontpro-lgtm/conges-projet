import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CALENDAR_EMOJIS = [
  '🏖️', '🌴', '☀️', '✈️', '🧳', '😎', '🌊', '⛱️',
  '📍', '🚫', '⏰', '🏠', '🩺', '📌', '🌙', '⚠️',
];

export class UpdateOwnPreferencesDto {
  @IsOptional()
  @IsString()
  @MaxLength(58000)
  profileImageData?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(CALENDAR_EMOJIS)
  leaveEmoji?: string;

  @IsOptional()
  @IsString()
  @IsIn(CALENDAR_EMOJIS)
  unavailabilityEmoji?: string;
}
