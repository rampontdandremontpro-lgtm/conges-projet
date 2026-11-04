import { IsInt, IsISO8601, IsNotEmpty } from 'class-validator';

/**
 * JUR-025/037 — régularisation contrôlée de l'acquisition après création,
 * correction, requalification ou annulation d'une absence (idempotente).
 */
export class RegularizeAccrualDto {
  @IsInt()
  @IsNotEmpty()
  employeeId!: number;

  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;
}
