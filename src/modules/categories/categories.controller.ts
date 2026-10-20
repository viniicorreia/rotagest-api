import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { CategoryDto, CreateCategoryDto, ListCategoriesQueryDto, UpdateCategoryDto } from './categories.dto';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: [CategoryDto] })
  @ApiOperation({ summary: 'Categorias padrão e personalizadas da empresa' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListCategoriesQueryDto) {
    return this.categories.list(ctx, q);
  }

  @Post()
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: CategoryDto })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateCategoryDto, @ReqMeta() meta: RequestMeta) {
    return this.categories.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: CategoryDto })
  @ApiOperation({ summary: 'Renomeia (só personalizadas) ou ativa/desativa uma categoria' })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @ReqMeta() meta: RequestMeta) {
    return this.categories.update(ctx, id, dto, meta);
  }
}
