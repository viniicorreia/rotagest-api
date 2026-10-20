import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { DEFAULT_CATEGORIES } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCategoryDto, ListCategoriesQueryDto, UpdateCategoryDto } from './categories.dto';

const FIELDS = { id: true, type: true, name: true, systemKey: true, status: true } satisfies Prisma.FinancialCategorySelect;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Cria as categorias padrão que faltarem (idempotente: chave única por empresa + systemKey). */
  async ensureDefaults(companyId: string, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).financialCategory.createMany({
      data: DEFAULT_CATEGORIES.map((c) => ({ companyId, type: c.type, name: c.name, systemKey: c.systemKey })),
      skipDuplicates: true,
    });
  }

  async list(ctx: TenantContext, q: ListCategoriesQueryDto) {
    await this.ensureDefaults(ctx.companyId);
    return this.prisma.financialCategory.findMany({
      where: { companyId: ctx.companyId, type: q.type, status: q.includeInactive ? undefined : 'ACTIVE' },
      select: FIELDS,
      orderBy: [{ type: 'asc' }, { systemKey: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    });
  }

  async create(ctx: TenantContext, dto: CreateCategoryDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, ctx.companyId, dto.type, dto.name);
      const category = await tx.financialCategory.create({ data: { companyId: ctx.companyId, type: dto.type, name: dto.name }, select: FIELDS });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'category.created', entityType: 'FinancialCategory', entityId: category.id, after: category, meta }, tx);
      return category;
    });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateCategoryDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.financialCategory.findFirst({ where: { id, companyId: ctx.companyId }, select: FIELDS });
      if (!before) throw notFound('Categoria não encontrada');
      if (dto.name !== undefined && dto.name !== before.name) {
        if (before.systemKey) throw badRequest('Categorias padrão não podem ser renomeadas; crie uma categoria personalizada.');
        await this.assertNameFree(tx, ctx.companyId, before.type, dto.name);
      }
      const after = await tx.financialCategory.update({ where: { id }, data: dto, select: FIELDS });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'category.updated', entityType: 'FinancialCategory', entityId: id, before, after, meta }, tx);
      return after;
    });
  }

  /** Valida que a categoria é da empresa, do tipo esperado e está ativa. */
  async assertUsable(tx: Tx, companyId: string, id: string, type: 'INCOME' | 'EXPENSE') {
    const category = await tx.financialCategory.findFirst({ where: { id, companyId }, select: FIELDS });
    if (!category) throw notFound('Categoria não encontrada');
    if (category.type !== type) throw badRequest(type === 'EXPENSE' ? 'Escolha uma categoria de despesa' : 'Escolha uma categoria de receita');
    if (category.status !== 'ACTIVE') throw badRequest('Esta categoria está desativada');
    return category;
  }

  /** Categoria padrão pela chave do sistema (cria as padrão que faltarem). */
  async bySystemKey(tx: Tx, companyId: string, systemKey: string) {
    await this.ensureDefaults(companyId, tx);
    return tx.financialCategory.findFirstOrThrow({ where: { companyId, systemKey }, select: FIELDS });
  }

  private async assertNameFree(tx: Tx, companyId: string, type: 'INCOME' | 'EXPENSE', name: string) {
    const existing = await tx.financialCategory.findFirst({ where: { companyId, type, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (existing) throw conflict('Já existe uma categoria com este nome');
  }
}
