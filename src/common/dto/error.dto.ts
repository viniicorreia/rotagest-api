import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Formato único de erro de toda a API (AllExceptionsFilter). */
export class ApiErrorDto {
  @ApiProperty({ example: 403 }) statusCode: number;
  @ApiProperty({ example: 'COMPANY_ACCESS_DENIED' }) code: string;
  @ApiProperty({ example: 'Você não tem acesso a esta empresa' }) message: string;
  @ApiPropertyOptional({ type: [String] }) details?: string[];
  @ApiPropertyOptional() requestId?: string;
}
