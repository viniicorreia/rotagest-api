import { Controller, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiDefaultResponse, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { BillingService } from './billing.service';

@ApiTags('billing')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Recebe eventos do gateway configurado; 404 enquanto não houver integração. */
  @Post('webhooks/:provider')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.billing.handleWebhook(provider, req.headers, req.rawBody);
  }
}
