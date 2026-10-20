import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReqMeta, RequireAnyPermission, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { AttachmentDto } from '../obligations/obligations.dto';
import { UploadAttachmentDto } from './attachments.dto';
import { AttachmentsService, type UploadedFile as File } from './attachments.service';

/** Limite de bytes aceito pelo multer; o limite de negócio (ATTACHMENT_MAX_MB) é validado no serviço. */
const MULTER_HARD_LIMIT = 50 * 1024 * 1024;

@ApiTags('attachments')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @RequireAnyPermission('finance:manage', 'expenses:own')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF, JPG, PNG ou WEBP' },
        payableId: { type: 'string', format: 'uuid' },
        receivableId: { type: 'string', format: 'uuid' },
        settlementId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: AttachmentDto })
  @ApiOperation({ summary: 'Anexa comprovante a uma conta a pagar, a receber ou a um pagamento/recebimento' })
  upload(@Tenant() ctx: TenantContext, @Body() dto: UploadAttachmentDto, @UploadedFile() file: File | undefined, @ReqMeta() meta: RequestMeta) {
    return this.attachments.upload(ctx, dto, file, meta);
  }

  @Get(':id/download')
  @RequireAnyPermission('finance:read', 'expenses:own')
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiOperation({ summary: 'Baixa o comprovante (somente da empresa ativa)' })
  async download(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.attachments.open(ctx, id);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('finance:manage')
  @ApiNoContentResponse()
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.attachments.remove(ctx, id, meta);
  }
}
