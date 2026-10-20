import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { attachmentDto } from './attachment-dto';
import type { UploadAttachmentDto } from './attachments.dto';
import { detectFileType, safeFileName } from './file-types';
import { StorageService } from './storage.service';

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Comprovantes privados. O dono (conta a pagar, a receber ou liquidação) é
 * validado no tenant antes de gravar; o download confere tenant e permissão
 * e nunca expõe caminho de disco.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async upload(ctx: TenantContext, dto: UploadAttachmentDto, file: UploadedFile | undefined, meta: RequestMeta) {
    if (!file) throw badRequest('Envie o arquivo no campo "file"');
    const owners = [dto.payableId, dto.receivableId, dto.settlementId].filter(Boolean);
    if (owners.length !== 1) throw badRequest('Informe exatamente um entre payableId, receivableId e settlementId');
    const maxBytes = this.config.get('ATTACHMENT_MAX_MB') * 1024 * 1024;
    if (file.size === 0) throw badRequest('Arquivo vazio');
    if (file.size > maxBytes) throw badRequest(`Arquivo maior que ${this.config.get('ATTACHMENT_MAX_MB')} MB`);
    const type = detectFileType(file.buffer);
    if (!type) throw badRequest('Formato não aceito. Envie PDF, JPG, PNG ou WEBP.');

    await this.assertOwner(ctx.companyId, dto);
    const id = randomUUID();
    const storageKey = `${ctx.companyId}/${id}.${type.ext}`;
    await this.storage.put(storageKey, file.buffer);
    const attachment = await this.prisma.attachment.create({
      data: {
        id,
        companyId: ctx.companyId,
        payableId: dto.payableId ?? null,
        receivableId: dto.receivableId ?? null,
        settlementId: dto.settlementId ?? null,
        storageKey,
        originalName: safeFileName(file.originalname, type.ext),
        mimeType: type.mime,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById: ctx.userId,
      },
    });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.uploaded', entityType: 'Attachment', entityId: id, after: attachmentDto(attachment), meta });
    return attachmentDto(attachment);
  }

  async open(ctx: TenantContext, id: string) {
    const a = await this.prisma.attachment.findFirst({ where: { id, companyId: ctx.companyId, deletedAt: null } });
    if (!a) throw notFound('Comprovante não encontrado');
    return { stream: this.storage.read(a.storageKey), mimeType: a.mimeType, fileName: a.originalName, size: a.sizeBytes };
  }

  /** Remoção lógica: o arquivo continua guardado para auditoria. */
  async remove(ctx: TenantContext, id: string, meta: RequestMeta) {
    const a = await this.prisma.attachment.findFirst({ where: { id, companyId: ctx.companyId, deletedAt: null } });
    if (!a) throw notFound('Comprovante não encontrado');
    await this.prisma.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.deleted', entityType: 'Attachment', entityId: id, before: attachmentDto(a), meta });
  }

  private async assertOwner(companyId: string, dto: UploadAttachmentDto) {
    const where = { companyId };
    const found = dto.payableId
      ? await this.prisma.payable.findFirst({ where: { ...where, id: dto.payableId }, select: { id: true } })
      : dto.receivableId
        ? await this.prisma.receivable.findFirst({ where: { ...where, id: dto.receivableId }, select: { id: true } })
        : await this.prisma.settlement.findFirst({ where: { ...where, id: dto.settlementId }, select: { id: true } });
    if (!found) throw notFound('Lançamento não encontrado');
  }
}
