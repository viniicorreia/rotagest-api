import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestMeta } from '../../common/tenant/tenant-context';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface AuditEntry {
  companyId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  meta?: RequestMeta;
}

/** Grava a trilha de auditoria (tabela append-only). Aceita um Tx para gravar na mesma transação. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        companyId: entry.companyId ?? null,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        ip: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
