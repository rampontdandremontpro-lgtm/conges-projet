import { IsString, Length } from 'class-validator';

export class RejectDocumentDto {
  @IsString()
  @Length(3, 1000, {
    message:
      'Le motif du rejet doit contenir entre 3 et 1 000 caractères.',
  })
  reason!: string;
}
