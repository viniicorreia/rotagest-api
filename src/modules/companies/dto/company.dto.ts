import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { BRAZILIAN_STATES, isValidDocument, onlyDigits, type PersonType } from '../../../domain';

const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

@ValidatorConstraint({ name: 'documentMatchesPersonType' })
class DocumentMatchesPersonType implements ValidatorConstraintInterface {
  validate(document: unknown, args: ValidationArguments): boolean {
    const personType = (args.object as { personType?: PersonType }).personType;
    return typeof document === 'string' && !!personType && isValidDocument(personType, document);
  }

  defaultMessage(args: ValidationArguments): string {
    const personType = (args.object as { personType?: PersonType }).personType;
    return personType === 'INDIVIDUAL' ? 'CPF inválido' : 'CNPJ inválido';
  }
}

export class CreateCompanyDto {
  @ApiProperty({ example: 'Transportes Silva' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  tradeName: string;

  @ApiPropertyOptional({ example: 'Transportes Silva LTDA' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'] })
  @IsEnum(['INDIVIDUAL', 'COMPANY'])
  personType: PersonType;

  @ApiProperty({ description: 'CPF (pessoa física) ou CNPJ (pessoa jurídica)', example: '11.222.333/0001-81' })
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) : value))
  @Validate(DocumentMatchesPersonType)
  document: string;

  @ApiPropertyOptional({ example: '(11) 99999-0000' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value))
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: BRAZILIAN_STATES })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsIn(BRAZILIAN_STATES as unknown as string[], { message: 'UF inválida' })
  state?: string;

  @ApiPropertyOptional({ example: '01001-000' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  postalCode?: string;
}

/** personType e document andam juntos: o validador de documento exige ambos. */
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
