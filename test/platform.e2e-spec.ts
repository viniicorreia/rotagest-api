import { TrialExpiryJob } from '../src/modules/subscriptions/trial-expiry.job';
import { createHmac, randomUUID } from 'node:crypto';
import type { GatewayEvent, PaymentGateway } from '../src/modules/billing/payment-gateway';
import { bearer, createCompany, createTestApp, createVehicle, ownerWithCompany, register, resetDb, type Session, type TestApp } from './helpers';

/** Adaptador de teste: valida HMAC do corpo, como os gateways reais fazem. */
class HmacTestGateway implements PaymentGateway {
  readonly provider = 'teste';
  constructor(private readonly secret: string) {}
  createCustomer(): Promise<{ customerId: string }> {
    throw new Error('não usado');
  }
  createSubscription(): Promise<{ subscriptionId: string; checkoutUrl: string | null }> {
    throw new Error('não usado');
  }
  cancelSubscription(): Promise<void> {
    throw new Error('não usado');
  }
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent {
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    if (headers['x-signature'] !== expected) throw new Error('assinatura inválida');
    const body = JSON.parse(rawBody.toString()) as { id: string; type: string; subscription: string };
    const type = body.type === 'invoice.overdue' ? 'subscription.past_due' : body.type === 'invoice.paid' ? 'subscription.activated' : 'other';
    return { externalId: body.id, type, rawType: body.type, externalSubscriptionId: body.subscription, payload: body };
  }
}

describe('Painel da plataforma (e2e)', () => {
  let t: TestApp;
  let admin: Session;
  let owner: Session;
  let company: { id: string };
  const suffix = randomUUID().slice(0, 8);

  const as = (s: Session) => ({
    get: (path: string) => t.http().get(`/api/v1${path}`).set(bearer(s)),
    post: (path: string, body: object) => t.http().post(`/api/v1${path}`).set(bearer(s)).send(body),
    patch: (path: string, body: object) => t.http().patch(`/api/v1${path}`).set(bearer(s)).send(body),
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
    admin = await register(t, 'Admin da Plataforma');
    await t.prisma.user.update({ where: { id: admin.userId }, data: { platformRole: 'SUPER_ADMIN' } });
    ({ owner, company } = await ownerWithCompany(t, 'Vans do Painel'));
    await createVehicle(t, owner, 'Van 01');
    await createVehicle(t, owner, 'Van 02');
  });
  afterAll(() => t.close());

  it('só SUPER_ADMIN entra, e sem precisar de empresa', async () => {
    await t.http().get('/api/v1/platform/overview').expect(401);
    await as(owner).get('/platform/overview').expect(403);
    const res = await as(admin).get('/platform/overview').expect(200);
    expect(res.body).toMatchObject({ companies: 1, newCompanies30d: 1, vehicles: 2, members: 1, billing: { configured: false, provider: null } });
    expect(res.body.subscriptionsByStatus).toEqual([{ status: 'TRIALING', count: 1 }]);
    expect(res.body.mrr).toBe('0.00');
  });

  it('lista empresas com assinatura e uso, sem dados financeiros', async () => {
    const res = await as(admin).get('/platform/companies?search=painel').expect(200);
    expect(res.body.total).toBe(1);
    const item = res.body.items[0];
    expect(item).toMatchObject({ id: company.id, tradeName: 'Vans do Painel', status: 'ACTIVE', subscription: { status: 'TRIALING', plan: { code: 'starter' } } });
    expect(item.usage).toMatchObject({ users: 1, vehicles: 2, maxVehicles: 2, maxUsers: 2 });
    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['balance']));
    const detail = await as(admin).get(`/platform/companies/${company.id}`).expect(200);
    expect(detail.body.owners).toEqual([expect.objectContaining({ id: owner.userId })]);
    // O admin não é membro: os dados da empresa continuam fechados para ele.
    await t.http().get('/api/v1/vehicles').set(bearer(admin)).expect(403);
    await as(admin).get('/platform/companies/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('suspende e reativa a empresa com justificativa auditada', async () => {
    await as(admin).post(`/platform/companies/${company.id}/status`, { status: 'SUSPENDED', reason: 'curta' }).expect(400);
    const res = await as(admin).post(`/platform/companies/${company.id}/status`, { status: 'SUSPENDED', reason: 'Pagamento em atraso há 60 dias' }).expect(200);
    expect(res.body.status).toBe('SUSPENDED');
    expect(res.body.history[0]).toMatchObject({ action: 'platform.company.suspended', reason: 'Pagamento em atraso há 60 dias', actor: { id: admin.userId } });
    const blocked = await as(owner).get('/vehicles').expect(403);
    expect(blocked.body.code).toBe('COMPANY_SUSPENDED');
    await as(admin).post(`/platform/companies/${company.id}/status`, { status: 'SUSPENDED', reason: 'Pagamento em atraso há 60 dias' }).expect(409);
    await as(admin).post(`/platform/companies/${company.id}/status`, { status: 'ACTIVE', reason: 'Pagamento regularizado pelo cliente' }).expect(200);
    await as(owner).get('/vehicles').expect(200);
  });

  describe('planos e assinaturas', () => {
    let small: { id: string };
    let subscriptionId: string;

    it('cria e edita planos com limites e recursos configuráveis', async () => {
      await as(admin)
        .post('/platform/plans', { code: `x-${suffix}`, name: 'Inválido', price: '10.00', interval: 'MONTHLY', features: [{ key: 'nao.existe', enabled: true }] })
        .expect(400);
      const res = await as(admin)
        .post('/platform/plans', {
          code: `mini-${suffix}`,
          name: 'Mini',
          price: '29.90',
          interval: 'MONTHLY',
          maxVehicles: 1,
          maxUsers: 1,
          isPublic: false,
          features: [{ key: 'reports.export', enabled: true }],
        })
        .expect(201);
      small = res.body;
      expect(res.body).toMatchObject({ code: `mini-${suffix}`, price: '29.90', maxVehicles: 1, status: 'ACTIVE', subscriptions: 0, isDefault: false });
      expect(res.body.features).toEqual([{ key: 'reports.export', label: expect.any(String), enabled: true }]);
      await as(admin).post('/platform/plans', { code: `mini-${suffix}`, name: 'Repetido', price: '1.00', interval: 'MONTHLY' }).expect(409);
      const upd = await as(admin).patch(`/platform/plans/${small.id}`, { maxUsers: null, price: '39.90' }).expect(200);
      expect(upd.body).toMatchObject({ maxUsers: null, price: '39.90' });
      const list = await as(admin).get('/platform/plans').expect(200);
      expect(list.body.items.find((p: { code: string }) => p.code === 'starter')).toMatchObject({ isDefault: true });
      expect(list.body.catalog.length).toBeGreaterThan(0);
    });

    it('troca de plano avisa sobre uso acima do limite e o limite passa a valer', async () => {
      subscriptionId = (await t.prisma.subscription.findUniqueOrThrow({ where: { companyId: company.id } })).id;
      await as(admin).patch(`/platform/subscriptions/${subscriptionId}`, { planId: small.id }).expect(400);
      const res = await as(admin)
        .patch(`/platform/subscriptions/${subscriptionId}`, { planId: small.id, status: 'ACTIVE', reason: 'Cliente contratou o plano Mini' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, plan: { id: small.id }, usage: { vehicles: 2, maxVehicles: 1 } });
      expect(res.body.warnings).toHaveLength(1);
      const limit = await as(owner).post('/vehicles', { name: 'Van 03', plate: 'QWE1R23' }).expect(409);
      expect(limit.body.code).toBe('PLAN_LIMIT_REACHED');

      await as(admin).patch(`/platform/subscriptions/${subscriptionId}`, { overrideMaxVehicles: 5, reason: 'Exceção negociada para 5 vans' }).expect(200);
      await as(owner).post('/vehicles', { name: 'Van 03', plate: 'QWE1R23' }).expect(201);

      const overview = await as(admin).get('/platform/overview').expect(200);
      expect(overview.body.mrr).toBe('39.90');
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'platform.subscription.updated', entityId: subscriptionId }, orderBy: { createdAt: 'asc' } });
      expect(audit).toMatchObject({ companyId: company.id, actorUserId: admin.userId, reason: 'Cliente contratou o plano Mini' });
    });

    it('assinatura suspensa bloqueia o acesso; plano arquivado não aceita novas assinaturas', async () => {
      await as(admin).patch(`/platform/subscriptions/${subscriptionId}`, { status: 'SUSPENDED', reason: 'Suspensa a pedido do financeiro' }).expect(200);
      expect((await as(owner).get('/dashboard').expect(403)).body.code).toBe('COMPANY_SUSPENDED');
      const me = await as(owner).get('/auth/me').expect(200);
      expect(me.body).toMatchObject({ activeCompany: null, companies: [expect.objectContaining({ id: company.id, status: 'SUSPENDED' })] });
      await as(admin).patch(`/platform/subscriptions/${subscriptionId}`, { status: 'PAST_DUE', reason: 'Volta com pagamento em atraso' }).expect(200);
      await as(owner).get('/subscription').expect(200);

      const archived = await as(admin).post('/platform/plans', { code: `old-${suffix}`, name: 'Antigo', price: '9.90', interval: 'MONTHLY' }).expect(201);
      await as(admin).patch(`/platform/plans/${archived.body.id}`, { status: 'ARCHIVED' }).expect(200);
      await as(admin).patch(`/platform/subscriptions/${subscriptionId}`, { planId: archived.body.id, reason: 'Tentativa com plano arquivado' }).expect(422);
      const starter = await t.prisma.plan.findUniqueOrThrow({ where: { code: 'starter' } });
      await as(admin).patch(`/platform/plans/${starter.id}`, { status: 'ARCHIVED' }).expect(422);

      const list = await as(admin).get('/platform/subscriptions?status=PAST_DUE').expect(200);
      expect(list.body.items.map((s: { id: string }) => s.id)).toEqual([subscriptionId]);
    });
  });

  describe('configurações globais', () => {
    it('plano padrão, dias de teste e pausa de novas empresas valem no onboarding', async () => {
      const plan = await as(admin).post('/platform/plans', { code: `promo-${suffix}`, name: 'Promo', price: '0.00', interval: 'YEARLY' }).expect(201);
      const res = await as(admin).patch('/platform/settings', { defaultPlanId: plan.body.id, trialDays: 0, supportEmail: 'suporte@rotagest.com.br' }).expect(200);
      expect(res.body).toMatchObject({ defaultPlan: { id: plan.body.id }, trialDays: 0, supportEmail: 'suporte@rotagest.com.br', allowNewCompanies: true });
      await as(owner).patch('/platform/settings', { trialDays: 5 }).expect(403);

      const other = await register(t, 'Outro dono');
      const created = await createCompany(t, other, 'Nova Transportes');
      const sub = await t.prisma.subscription.findUniqueOrThrow({ where: { companyId: created.id } });
      expect(sub).toMatchObject({ planId: plan.body.id, status: 'ACTIVE', trialEndsAt: null });
      const mine = await as(other).get('/subscription').expect(200);
      expect(mine.body).toMatchObject({ supportEmail: 'suporte@rotagest.com.br', billing: { configured: false } });

      await as(admin).patch('/platform/settings', { allowNewCompanies: false }).expect(200);
      const late = await register(t, 'Atrasado');
      const closed = await t
        .http()
        .post('/api/v1/companies')
        .set(bearer(late))
        .send({ tradeName: 'Fora', personType: 'COMPANY', document: '11222333000181', city: 'Campinas', state: 'SP' })
        .expect(403);
      expect(closed.body.code).toBe('SIGNUPS_CLOSED');
      await as(admin).patch('/platform/settings', { allowNewCompanies: true, defaultPlanId: (await t.prisma.plan.findUniqueOrThrow({ where: { code: 'starter' } })).id }).expect(200);
    });

    it('lista pública mostra só planos ativos e públicos', async () => {
      const res = await t.http().get('/api/v1/plans').expect(200);
      const codes = res.body.items.map((p: { code: string }) => p.code);
      expect(codes).toContain('starter');
      expect(codes).not.toContain(`mini-${suffix}`);
      expect(codes).not.toContain(`old-${suffix}`);
    });
  });

  describe('webhook do gateway', () => {
    it('sem gateway configurado não existe', async () => {
      await t.http().post('/api/v1/billing/webhooks/teste').send({ id: 'x' }).expect(404);
    });

    it('com gateway: valida assinatura, aplica o status uma única vez e audita', async () => {
      const secret = 'segredo-de-teste';
      const g = await createTestApp({ BILLING_PROVIDER: 'teste' }, [new HmacTestGateway(secret)]);
      try {
        const { owner: o, company: c } = await ownerWithCompany(g, 'Cobrada');
        await g.prisma.subscription.update({ where: { companyId: c.id }, data: { status: 'ACTIVE', externalProvider: 'teste', externalId: 'sub_123' } });
        const body = JSON.stringify({ id: `evt_${suffix}`, type: 'invoice.overdue', subscription: 'sub_123' });
        const sig = createHmac('sha256', secret).update(body).digest('hex');
        const send = (signature: string) =>
          g.http().post('/api/v1/billing/webhooks/teste').set('content-type', 'application/json').set('x-signature', signature).send(body);

        await send('assinatura-falsa').expect(400);
        expect((await send(sig).expect(200)).body).toEqual({ received: true, duplicate: false });
        expect((await send(sig).expect(200)).body).toEqual({ received: true, duplicate: true });
        const sub = await g.prisma.subscription.findUniqueOrThrow({ where: { companyId: c.id } });
        expect(sub.status).toBe('PAST_DUE');
        expect(await g.prisma.billingEvent.count({ where: { companyId: c.id } })).toBe(1);
        expect(await g.prisma.auditLog.count({ where: { action: 'billing.subscription.status', companyId: c.id } })).toBe(1);
        const mine = await g.http().get('/api/v1/subscription').set(bearer(o)).expect(200);
        expect(mine.body).toMatchObject({ status: 'PAST_DUE', billing: { configured: true, provider: 'teste' } });
      } finally {
        await g.close();
      }
    });
  });

  it('fim do teste: a rotina marca a assinatura como em atraso, sem bloquear o acesso', async () => {
    const trial = await ownerWithCompany(t, 'Teste Vencendo');
    const sub = await t.prisma.subscription.findFirstOrThrow({ where: { companyId: trial.company.id } });
    // Um teste anterior zerou os dias de teste; força uma assinatura em teste já vencida.
    await t.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 60_000) } });
    const job = t.app.get(TrialExpiryJob);
    expect(await job.run()).toBeGreaterThanOrEqual(1);
    expect((await t.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('PAST_DUE');
    expect(await job.run()).toBe(0);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'platform.subscription.trial_expired', entityId: sub.id } });
    expect(audit.after).toEqual({ status: 'PAST_DUE' });
    await t.http().get('/api/v1/vehicles').set(bearer(trial.owner)).expect(200);
  });
});
