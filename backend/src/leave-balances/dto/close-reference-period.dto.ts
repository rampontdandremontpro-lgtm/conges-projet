import { Equals, IsBoolean, Matches } from 'class-validator';

export class CloseReferencePeriodDto {
  @Matches(/^\d{4}-\d{4}$/)
  referencePeriod!: string;

  @IsBoolean()
  @Equals(true, {
    message: 'La confirmation explicite est obligatoire pour clôturer la période.',
  })
  confirm!: true;
}
