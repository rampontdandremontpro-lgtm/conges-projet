import { Matches } from 'class-validator';

export class ApplyFractionnementDto {
  @Matches(/^\d{4}-\d{4}$/, {
    message: 'referencePeriod doit respecter le format AAAA-AAAA.',
  })
  referencePeriod!: string;
}
