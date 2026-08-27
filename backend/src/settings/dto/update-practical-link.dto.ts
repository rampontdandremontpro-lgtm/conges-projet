import { PartialType } from '@nestjs/mapped-types';
import { CreatePracticalLinkDto } from './create-practical-link.dto';

export class UpdatePracticalLinkDto extends PartialType(CreatePracticalLinkDto) {}
