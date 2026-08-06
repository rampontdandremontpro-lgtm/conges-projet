import { IsString, Matches } from 'class-validator';

export class RunMonthlyAccrualDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Le mois d’acquisition doit respecter le format AAAA-MM.',
  })
  accrualMonth!: string;
}
