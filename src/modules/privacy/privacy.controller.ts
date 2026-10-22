import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthRateLimit, CurrentUser, NoTenant, ReqMeta } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import { AppConfig } from '../../config/app-config.service';
import { clearRefreshCookie } from '../auth/refresh-cookie';
import { DeleteAccountDto, PersonalDataExportDto } from './privacy.dto';
import { PrivacyService } from './privacy.service';

@ApiTags('privacy')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@NoTenant()
@Controller('me')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly config: AppConfig,
  ) {}

  @Get('data-export')
  @ApiOkResponse({ type: PersonalDataExportDto })
  @ApiOperation({ summary: 'Baixa os dados pessoais do usuário (LGPD)' })
  async export(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-rotagest.json"');
    return this.privacy.export(user, meta);
  }

  @Post('delete')
  @AuthRateLimit()
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Exclui a conta do usuário (anonimiza nome e e-mail, encerra sessões e vínculos)' })
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.privacy.deleteAccount(user, dto.password, meta);
    clearRefreshCookie(res, this.config.get('COOKIE_SECURE'));
  }
}
