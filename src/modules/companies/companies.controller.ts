import { ApiDefaultResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { CompanyDto, CreateCompanyResponseDto, CurrentCompanyDto } from './dto/company-response.dto';
import { BadRequestException, Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isValidDocument } from '../../domain';
import { CurrentUser, NoTenant, ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@ApiTags('companies')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @NoTenant()
  @Post()
  @ApiCreatedResponse({ type: CreateCompanyResponseDto })
  @ApiOperation({ summary: 'Onboarding: cria a empresa, torna o usuário OWNER e ativa a empresa na sessão' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto, @ReqMeta() meta: RequestMeta) {
    return this.companies.create(user, dto, meta);
  }

  @Get('current')
  @ApiOkResponse({ type: CurrentCompanyDto })
  @RequirePermissions('company:read')
  current(@Tenant() ctx: TenantContext) {
    return this.companies.getCurrent(ctx);
  }

  @Patch('current')
  @ApiOkResponse({ type: CompanyDto })
  @RequirePermissions('company:update')
  update(@Tenant() ctx: TenantContext, @Body() dto: UpdateCompanyDto, @ReqMeta() meta: RequestMeta) {
    if ((dto.personType === undefined) !== (dto.document === undefined)) {
      throw new BadRequestException({ message: 'Informe tipo de pessoa e documento juntos', code: 'VALIDATION_ERROR' });
    }
    if (dto.personType && dto.document && !isValidDocument(dto.personType, dto.document)) {
      throw new BadRequestException({ message: 'Documento inválido', code: 'VALIDATION_ERROR' });
    }
    return this.companies.updateCurrent(ctx, dto, meta);
  }
}
