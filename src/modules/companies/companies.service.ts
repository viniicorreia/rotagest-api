import { Injectable } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { MEMBER_ROLE_LABELS } from '../../domain';
import { notFound } from '../../common/errors';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { CategoriesService } from '../categories/categories.service';
import { SessionService } from '../auth/session.service';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

const PUBLIC_FIELDS = {
  id: true,
  tradeName: true,
  legalName: true,
  personType: true,
  document: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  state: true,
  postalCode: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * Onboarding: cria empresa, vínculo OWNER e assinatura em trial numa única
   * transação, e torna a nova empresa a ativa da sessão.
   */
  async create(user: AuthUser, dto: CreateCompanyDto, meta: RequestMeta) {
    const company = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { code: this.config.get('DEFAULT_PLAN_CODE') } });
      if (!plan || plan.status !== 'ACTIVE') {
        throw new Error(`Plano padrão "${this.config.get('DEFAULT_PLAN_CODE')}" não encontrado. Rode o seed.`);
      }
      const created = await tx.company.create({ data: { ...dto, status: 'ACTIVE' }, select: PUBLIC_FIELDS });
      await tx.companyMember.create({ data: { companyId: created.id, userId: user.userId, role: 'OWNER' } });
      await this.categories.ensureDefaults(created.id, tx);
      const trialDays = this.config.get('TRIAL_DAYS');
      await tx.subscription.create({
        data: {
          companyId: created.id,
          planId: plan.id,
          status: trialDays > 0 ? 'TRIALING' : 'ACTIVE',
          trialEndsAt: trialDays > 0 ? addDays(new Date(), trialDays) : null,
        },
      });
      await this.audit.log(
        { companyId: created.id, actorUserId: user.userId, action: 'company.created', entityType: 'Company', entityId: created.id, after: created, meta },
        tx,
      );
      await this.sessions.setActiveCompany(user.sessionId, created.id, tx);
      return created;
    });

    return { company, ...(await this.auth.accessFor(user.userId, user.sessionId, company.id)) };
  }

  async getCurrent(ctx: TenantContext) {
    const company = await this.prisma.company.findUnique({ where: { id: ctx.companyId }, select: PUBLIC_FIELDS });
    if (!company) throw notFound();
    return { ...company, myRole: ctx.role, myRoleLabel: MEMBER_ROLE_LABELS[ctx.role], myPermissions: ctx.permissions };
  }

  async updateCurrent(ctx: TenantContext, dto: UpdateCompanyDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.company.findUnique({ where: { id: ctx.companyId }, select: PUBLIC_FIELDS });
      if (!before) throw notFound();
      const data: Partial<Company> = { ...dto };
      const after = await tx.company.update({ where: { id: ctx.companyId }, data, select: PUBLIC_FIELDS });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'company.updated', entityType: 'Company', entityId: ctx.companyId, before, after, meta },
        tx,
      );
      return after;
    });
  }
}
