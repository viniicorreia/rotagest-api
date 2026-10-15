import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { addMember, bearer, createCompany, createTestApp, ownerWithCompany, register, resetDb, type TestApp } from './helpers';

describe('Multi-tenant (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });
  afterAll(() => t.close());

  describe('associação usuário ↔ empresa', () => {
    it('onboarding cria empresa, vínculo OWNER, assinatura em trial e auditoria', async () => {
      const s = await register(t, 'Carlos');
      const company = await createCompany(t, s, 'Vans do Carlos');

      const member = await t.prisma.companyMember.findUniqueOrThrow({
        where: { companyId_userId: { companyId: company.id, userId: s.userId } },
      });
      expect(member.role).toBe('OWNER');
      expect(member.status).toBe('ACTIVE');

      const sub = await t.prisma.subscription.findUniqueOrThrow({ where: { companyId: company.id }, include: { plan: true } });
      expect(sub.status).toBe('TRIALING');
      expect(sub.plan.code).toBe('starter');
      expect(sub.trialEndsAt).not.toBeNull();

      expect(await t.prisma.auditLog.count({ where: { companyId: company.id, action: 'company.created' } })).toBe(1);

      const me = await t.http().get('/api/v1/auth/me').set(bearer(s)).expect(200);
      expect(me.body.activeCompany.id).toBe(company.id);
      expect(me.body.activeCompany.role).toBe('OWNER');
      expect(me.body.activeCompany.permissions).toContain('members:manage');
    });

    it('valida CPF/CNPJ conforme o tipo de pessoa', async () => {
      const s = await register(t);
      const send = (body: object) => t.http().post('/api/v1/companies').set(bearer(s)).send({ tradeName: 'X Transportes', ...body });
      await send({ personType: 'COMPANY', document: '11.222.333/0001-82' }).expect(400);
      await send({ personType: 'INDIVIDUAL', document: '11.222.333/0001-81' }).expect(400);
      const ok = await send({ personType: 'INDIVIDUAL', document: '529.982.247-25' }).expect(201);
      expect(ok.body.company.document).toBe('52998224725');
    });

    it('rotas de negócio exigem empresa ativa', async () => {
      const s = await register(t);
      const res = await t.http().get('/api/v1/companies/current').set(bearer(s)).expect(403);
      expect(res.body.code).toBe('NO_ACTIVE_COMPANY');
    });
  });

  describe('troca de empresa ativa', () => {
    it('alterna entre empresas autorizadas e preserva a escolha no refresh', async () => {
      const s = await register(t, 'Multi');
      const a = await createCompany(t, s, 'Empresa A');
      const b = await createCompany(t, s, 'Empresa B');

      let current = await t.http().get('/api/v1/companies/current').set(bearer(s)).expect(200);
      expect(current.body.id).toBe(b.id);

      const sw = await t.http().post('/api/v1/auth/switch-company').set(bearer(s)).send({ companyId: a.id }).expect(200);
      expect(sw.body.activeCompanyId).toBe(a.id);
      current = await t.http().get('/api/v1/companies/current').set('Authorization', `Bearer ${sw.body.accessToken}`).expect(200);
      expect(current.body.id).toBe(a.id);

      const refreshed = await t.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
      expect(refreshed.body.activeCompanyId).toBe(a.id);

      const me = await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${sw.body.accessToken}`).expect(200);
      expect(me.body.companies.map((c: { id: string }) => c.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('recusa troca para empresa da qual o usuário não é membro', async () => {
      const { company: other } = await ownerWithCompany(t, 'Empresa de Outro');
      const intruder = await register(t, 'Intruso');
      const res = await t.http().post('/api/v1/auth/switch-company').set(bearer(intruder)).send({ companyId: other.id }).expect(403);
      expect(res.body.code).toBe('COMPANY_ACCESS_DENIED');
      expect(res.body.message).not.toContain('Empresa de Outro');
    });
  });

  describe('acesso indevido entre tenants', () => {
    it('não lê nem altera membros de outra empresa, mesmo sabendo o id (404, sem vazar existência)', async () => {
      const a = await ownerWithCompany(t, 'Tenant A');
      const b = await ownerWithCompany(t, 'Tenant B');
      const { memberId: memberOfB } = await addMember(t, b.owner, 'FINANCIAL');

      const list = await t.http().get('/api/v1/members').set(bearer(a.owner)).expect(200);
      expect(list.body.map((m: { id: string }) => m.id)).not.toContain(memberOfB);

      await t.http().patch(`/api/v1/members/${memberOfB}`).set(bearer(a.owner)).send({ role: 'DRIVER' }).expect(404);
      await t.http().post(`/api/v1/members/${memberOfB}/deactivate`).set(bearer(a.owner)).expect(404);
      await t.http().delete(`/api/v1/members/${memberOfB}`).set(bearer(a.owner)).expect(404);

      const untouched = await t.prisma.companyMember.findUniqueOrThrow({ where: { id: memberOfB } });
      expect(untouched.role).toBe('FINANCIAL');
      expect(untouched.status).toBe('ACTIVE');
    });

    it('não revoga convites de outra empresa', async () => {
      const a = await ownerWithCompany(t);
      const b = await ownerWithCompany(t);
      const inv = await t.http().post('/api/v1/invitations').set(bearer(b.owner)).send({ email: 'alguem@b.com', role: 'DRIVER' }).expect(201);
      await t.http().post(`/api/v1/invitations/${inv.body.invitation.id}/revoke`).set(bearer(a.owner)).expect(404);
      const stored = await t.prisma.companyInvitation.findUniqueOrThrow({ where: { id: inv.body.invitation.id } });
      expect(stored.status).toBe('PENDING');
    });

    it('ignora companyId enviado pelo cliente', async () => {
      const a = await ownerWithCompany(t, 'Tenant Real');
      const b = await ownerWithCompany(t, 'Tenant Alvo');
      // Campo extra é rejeitado pela validação (whitelist + forbidNonWhitelisted)...
      await t.http().patch('/api/v1/companies/current').set(bearer(a.owner)).send({ companyId: b.company.id, tradeName: 'Hack' }).expect(400);
      // ...e query string não muda o tenant resolvido.
      const res = await t.http().get(`/api/v1/companies/current?companyId=${b.company.id}`).set(bearer(a.owner)).expect(200);
      expect(res.body.id).toBe(a.company.id);
      const target = await t.prisma.company.findUniqueOrThrow({ where: { id: b.company.id } });
      expect(target.tradeName).toBe('Tenant Alvo');
    });

    it('token assinado com empresa forjada no claim é recusado (vínculo é checado no banco)', async () => {
      const a = await ownerWithCompany(t);
      const b = await ownerWithCompany(t);
      const jwt = t.app.get(JwtService);
      const decoded = jwt.decode(a.owner.token) as { sub: string; sid: string };
      const forged = await jwt.signAsync({ sub: decoded.sub, sid: decoded.sid, cid: b.company.id });
      const res = await t.http().get('/api/v1/members').set('Authorization', `Bearer ${forged}`).expect(403);
      expect(res.body.code).toBe('COMPANY_ACCESS_DENIED');
    });

    it('membro desativado ou removido perde acesso imediatamente, mesmo com token válido', async () => {
      const { owner } = await ownerWithCompany(t);
      const fin = await addMember(t, owner, 'FINANCIAL');
      await t.http().get('/api/v1/companies/current').set(bearer(fin.member)).expect(200);

      await t.http().post(`/api/v1/members/${fin.memberId}/deactivate`).set(bearer(owner)).expect(200);
      await t.http().get('/api/v1/companies/current').set(bearer(fin.member)).expect(403);

      // Ao renovar, a empresa ativa é descartada.
      const refreshed = await t.http().post('/api/v1/auth/refresh').set('Cookie', fin.member.cookie).expect(200);
      expect(refreshed.body.activeCompanyId).toBeNull();
    });

    it('empresa suspensa bloqueia o acesso de todos os membros', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await t.prisma.company.update({ where: { id: company.id }, data: { status: 'SUSPENDED' } });
      const res = await t.http().get('/api/v1/companies/current').set(bearer(owner)).expect(403);
      expect(res.body.code).toBe('COMPANY_SUSPENDED');
    });

    it('o banco recusa vínculo entre registros de empresas diferentes (FK composta)', async () => {
      const a = await ownerWithCompany(t);
      const b = await ownerWithCompany(t);
      const vehicleOfB = await t.prisma.vehicle.create({ data: { companyId: b.company.id, name: 'Van B', plate: 'BBB1B11' } });

      const attempt = t.prisma.maintenance.create({
        data: {
          companyId: a.company.id,
          vehicleId: vehicleOfB.id,
          type: 'PREVENTIVE',
          description: 'Tentativa entre tenants',
          date: new Date('2026-10-01'),
          amount: new Prisma.Decimal('100.00'),
        },
      });
      await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    });

    it('erros de banco não vazam detalhes internos', async () => {
      const s = await register(t);
      const res = await t.http().post('/api/v1/auth/register').send({ name: 'Dup', email: s.email, password: 'Senha12345' }).expect(409);
      expect(JSON.stringify(res.body)).not.toMatch(/constraint|prisma|users_email/i);
    });
  });
});
