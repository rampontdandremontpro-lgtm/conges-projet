import { IsBoolean } from 'class-validator';

export class RespondCancellationDto {
  @IsBoolean()
  consent!: boolean;
}
