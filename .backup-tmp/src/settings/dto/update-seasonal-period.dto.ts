import { Matches } from 'class-validator';

export class UpdateSeasonalPeriodDto {
  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'summerPeriodStart doit respecter le format MM-JJ.',
  })
  summerPeriodStart!: string;

  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'summerPeriodEnd doit respecter le format MM-JJ.',
  })
  summerPeriodEnd!: string;
}
