import { ApiCreatedResponse } from '@nestjs/swagger';
import { ApiDefaultResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { MeResponseDto } from './dto/me.dto';
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthRateLimit, CurrentUser, NoTenant, Public, ReqMeta } from '../../common/decorators';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import { AppConfig } from '../../config/app-config.service';
import { AuthService, type AuthResult } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchCompanyDto,
  TokenResponseDto,
} from './dto/auth.dto';
import { SessionService } from './session.service';
import { REFRESH_COOKIE, clearRefreshCookie, readRefreshCookie, refreshCookieOptions } from './refresh-cookie';

@ApiTags('auth')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @AuthRateLimit()
  @Post('register')
  @ApiOperation({ summary: 'Cria um usuário e inicia a sessão' })
  @ApiCreatedResponse({ type: TokenResponseDto })
  async register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.register(dto, meta));
  }

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.login(dto, meta));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renova o access token usando o cookie HttpOnly (rotação)' })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    try {
      return this.withCookie(res, await this.auth.refresh(readRefreshCookie(req), meta));
    } catch (error) {
      clearRefreshCookie(res, this.secure);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.secure);
  }

  @NoTenant()
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logoutAll(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(user, meta);
    clearRefreshCookie(res, this.secure);
  }

  @NoTenant()
  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ type: MeResponseDto })
  @ApiOperation({ summary: 'Usuário, empresas autorizadas, empresa ativa e permissões efetivas' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @NoTenant()
  @ApiBearerAuth()
  @Post('switch-company')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  switchCompany(@CurrentUser() user: AuthUser, @Body() dto: SwitchCompanyDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.switchCompany(user, dto.companyId, meta);
  }

  @Public()
  @AuthRateLimit()
  @Post('forgot-password')
  @HttpCode(204)
  @ApiNoContentResponse()
  async forgotPassword(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.auth.forgotPassword(dto.email, meta);
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(204)
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(dto.token, dto.password, meta);
    clearRefreshCookie(res, this.secure);
  }

  private get secure(): boolean {
    return this.config.get('COOKIE_SECURE');
  }

  private withCookie(res: Response, result: AuthResult): TokenResponseDto {
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(this.secure, this.sessions.refreshTtlMs));
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, activeCompanyId: result.activeCompanyId };
  }
}
