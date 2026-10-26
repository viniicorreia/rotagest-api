import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min, ValidateBy, ValidationOptions, buildMessage } from 'class-validator';
import { DATE_PATTERN, MONEY_PATTERN, MONTH_PATTERN, isValidDate, toCents } from '../../domain';

export const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** Trim que mantém string vazia como null (para limpar campos opcionais no PATCH). */
export const trimOrNull = ({ value }: { value: unknown }) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Valor monetário positivo em texto ("1234.56"). Nunca number, para não perder precisão. */
export function IsMoney(options: { allowZero?: boolean } = {}, validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isMoney',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && MONEY_PATTERN.test(value) && (options.allowZero ? toCents(value) >= 0 : toCents(value) > 0),
        defaultMessage: buildMessage(
          (each) => `${each}$property deve ser um valor ${options.allowZero ? 'maior ou igual a zero' : 'maior que zero'} no formato 1234.56`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

export function IsDateOnly(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && DATE_PATTERN.test(value) && isValidDate(value),
        defaultMessage: buildMessage((each) => `${each}$property deve ser uma data no formato AAAA-MM-DD`, validationOptions),
      },
    },
    validationOptions,
  );
}

export function IsMonth(validationOptions?: ValidationOptions) {
  return applyDecorators(Matches(MONTH_PATTERN, { message: '$property deve estar no formato AAAA-MM', ...validationOptions }));
}

export const MoneyProperty = (description?: string, example = '1500.00') =>
  ApiProperty({ type: String, example, pattern: MONEY_PATTERN.source, description });
export const OptionalMoneyProperty = (description?: string, example = '1500.00') =>
  ApiPropertyOptional({ type: String, example, pattern: MONEY_PATTERN.source, description });
export const DateProperty = (description?: string) => ApiProperty({ type: String, format: 'date', example: '2026-10-15', description });
export const OptionalDateProperty = (description?: string) =>
  ApiPropertyOptional({ type: String, format: 'date', example: '2026-10-15', description });
export const MonthProperty = (description?: string) => ApiProperty({ type: String, example: '2026-10', pattern: MONTH_PATTERN.source, description });
export const OptionalMonthProperty = (description?: string) =>
  ApiPropertyOptional({ type: String, example: '2026-10', pattern: MONTH_PATTERN.source, description });

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

/** Converte "true"/"false" de query string. */
export const QueryBoolean = () => Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value));
