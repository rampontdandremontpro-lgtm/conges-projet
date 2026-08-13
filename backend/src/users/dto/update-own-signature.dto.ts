import { IsIn, IsString, MaxLength } from 'class-validator';

export class UpdateOwnSignatureDto {
  @IsIn(['DRAWN', 'INITIALS'])
  signatureType!: 'DRAWN' | 'INITIALS';

  @IsString()
  @MaxLength(700000)
  signatureData!: string;
}
