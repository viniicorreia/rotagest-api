import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QueryBoolean, trimOrUndefined } from '../../common/validation';

export const CATEGORY_TYPES = ['INCOME', 'EXPENSE'] as const;
export type CategoryTypeValue = (typeof CATEGORY_TYPES)[number];
export const CategoryTypeEnum = { enum: CATEGORY_TYPES, enumName: 'CategoryType' } as const;
export const RecordStatusEnum = { enum: ['ACTIVE', 'INACTIVE'], enumName: 'RecordStatus' } as const;

export class CreateCategoryDto {
  @ApiProperty(CategoryTypeEnum)
  @IsEnum(CATEGORY_TYPES)
  type: CategoryTypeValue;

  @ApiProperty({ example: 'Monitora' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Somente categorias personalizadas podem ser renomeadas' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional(RecordStatusEnum)
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ListCategoriesQueryDto {
  @ApiPropertyOptional(CategoryTypeEnum)
  @IsOptional()
  @IsEnum(CATEGORY_TYPES)
  type?: CategoryTypeValue;

  @ApiPropertyOptional({ description: 'Inclui categorias desativadas', default: false })
  @IsOptional()
  @QueryBoolean()
  includeInactive?: boolean;
}

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty(CategoryTypeEnum) type: CategoryTypeValue;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'Chave das categorias padrão (FUEL, MAINTENANCE...); null = personalizada' })
  systemKey: string | null;
  @ApiProperty(RecordStatusEnum) status: 'ACTIVE' | 'INACTIVE';
}
