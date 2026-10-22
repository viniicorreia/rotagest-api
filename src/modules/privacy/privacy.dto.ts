import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Senha atual, para confirmar' })
  @IsString()
  @MaxLength(200)
  password: string;
}

/** Exportação dos dados pessoais do titular (LGPD art. 18, II e V). Formato livre por seção. */
export class PersonalDataExportDto {
  @ApiProperty({ format: 'date-time' }) generatedAt: Date;
  @ApiProperty({ type: Object, description: 'Cadastro do usuário' }) user: Record<string, unknown>;
  @ApiProperty({ type: [Object], description: 'Vínculos com empresas' }) memberships: Record<string, unknown>[];
  @ApiProperty({ type: [Object], description: 'Cadastros de motorista ligados ao usuário' }) driverProfiles: Record<string, unknown>[];
  @ApiProperty({ type: [Object], description: 'Sessões (aparelhos e IPs)' }) sessions: Record<string, unknown>[];
  @ApiProperty({ type: [Object], description: 'Convites recebidos' }) invitations: Record<string, unknown>[];
  @ApiProperty({ type: [Object], description: 'Ações registradas na auditoria (últimas 1000)' }) activity: Record<string, unknown>[];
}
