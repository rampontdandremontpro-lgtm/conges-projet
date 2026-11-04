import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class NotificationQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  /**
   * 'COLLABORATOR' : n'expose que les notifications PERSONNELLES du salarié
   * (celles où il est le titulaire de la demande/absence/dérogation liée),
   * jamais celles destinées à son profil RH/Responsable.
   */
  @IsOptional()
  @IsIn(['COLLABORATOR'])
  scope?: string;
}
