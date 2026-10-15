import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { ReverseSettlementDto, SettlementDto } from '../obligations/obligations.dto';
import { SettlementsService } from './settlements.service';

@ApiTags('settlements')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: SettlementDto })
  @ApiOperation({ summary: 'Estorna um pagamento/recebimento: lança o movimento oposto e reabre o saldo da conta a pagar/receber' })
  async reverse(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseSettlementDto, @ReqMeta() meta: RequestMeta) {
    return this.settlements.toDto(await this.settlements.reverse(ctx, id, dto.reason, meta));
  }
}
