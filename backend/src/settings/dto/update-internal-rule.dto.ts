import { PartialType } from '@nestjs/mapped-types';

import { CreateInternalRuleDto } from './create-internal-rule.dto';

export class UpdateInternalRuleDto extends PartialType(CreateInternalRuleDto) {}
