import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const START_SELECTION_EMOJIS = [
  '😊', '😃', '😀', '😁', '🥳', '😎', '🤩', '🙂',
];

export const END_SELECTION_EMOJIS = [
  '😔', '🙁', '☹️', '😢', '🥺', '😞', '😩', '😭',
];

export class UpdateOwnPreferencesDto {
  @IsOptional()
  @IsString()
  @MaxLength(58000)
  profileImageData?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(START_SELECTION_EMOJIS)
  startEmoji?: string;

  @IsOptional()
  @IsString()
  @IsIn(END_SELECTION_EMOJIS)
  endEmoji?: string;
}
