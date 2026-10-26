import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Campos do multipart (além do arquivo). Exatamente um dono. */
export class UploadAttachmentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  payableId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receivableId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Comprovante de um pagamento/recebimento' })
  @IsOptional()
  @IsUUID()
  settlementId?: string;
}
