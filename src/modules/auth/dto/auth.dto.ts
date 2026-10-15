import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../../domain';

const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PasswordField {
  @ApiProperty({ minLength: PASSWORD_MIN, example: 'SenhaForte123' })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `A senha deve ter pelo menos ${PASSWORD_MIN} caracteres` })
  @MaxLength(PASSWORD_MAX)
  @Matches(/[A-Za-z]/, { message: 'A senha deve conter letras' })
  @Matches(/\d/, { message: 'A senha deve conter números' })
  password: string;
}

export class RegisterDto extends PasswordField {
  @ApiProperty({ example: 'João da Silva' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'joao@exemplo.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;
}

export class LoginDto {
  @ApiProperty({ example: 'joao@exemplo.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class SwitchCompanyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Empresa inválida' })
  companyId: string;
}

export class TokenResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() expiresIn: number;
  @ApiProperty({ nullable: true, type: String }) activeCompanyId: string | null;
}
