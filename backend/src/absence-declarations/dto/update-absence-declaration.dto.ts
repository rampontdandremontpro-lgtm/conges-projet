import { PartialType, OmitType } from '@nestjs/mapped-types';

import { CreateAbsenceDeclarationDto } from './create-absence-declaration.dto';

export class UpdateAbsenceDeclarationDto extends PartialType(
  OmitType(CreateAbsenceDeclarationDto, ['employeeId'] as const),
) {}
