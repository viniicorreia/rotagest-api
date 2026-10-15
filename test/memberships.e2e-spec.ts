import {
  addMember,
  bearer,
  createTestApp,
  inviteTokenFrom,
  ownerWithCompany,
  register,
  resetDb,
  uniqueEmail,
  type TestApp,
} from './helpers';

describe('Membros, convites, permissões e limites (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });
  afterAll(() => t.close());

  /** Plano com limite folgado para testes que não tratam de limite. */
  async function roomyPlan(companyId: string) {
    await t.prisma.subscription.update({ where: { companyId }, data: { overrideMaxUsers: 50 } });
  }

  describe('convites', () => {
    it('fluxo completo: convidar, visualizar, aceitar e entrar na empresa', async () => {
      const { owner, company } = await ownerWithCompany(t, 'Escolar Feliz');
      const email = uniqueEmail('motorista');
      const inv = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: email.toUpperCase(), role: 'DRIVER' }).expect(201);
      expect(inv.body.invitation.email).toBe(email);
      expect(t.mail.lastTo(email)?.actionUrl).toBe(inv.body.inviteUrl);

      const token = inviteTokenFrom(inv.body.inviteUrl);
      const stored = await t.prisma.companyInvitation.findUniqueOrThrow({ where: { id: inv.body.invitation.id } });
      expect(stored.tokenHash).not.toBe(token);

      const preview = await t.http().get(`/api/v1/invitations/token/${encodeURIComponent(token)}`).expect(200);
      expect(preview.body).toMatchObject({ companyName: 'Escolar Feliz', email, role: 'DRIVER', status: 'PENDING' });

      const driver = await register(t, 'Motorista', email);
      const acc = await t.http().post(`/api/v1/invitations/token/${encodeURIComponent(token)}/accept`).set(bearer(driver)).expect(200);
      expect(acc.body.activeCompanyId).toBe(company.id);

      const me = await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${acc.body.accessToken}`).expect(200);
      expect(me.body.activeCompany.role).toBe('DRIVER');

      await t.http().post(`/api/v1/invitations/token/${encodeURIComponent(token)}/accept`).set(bearer(driver)).expect(409);
    });

    it('convite só pode ser aceito pelo e-mail convidado', async () => {
      const { owner } = await ownerWithCompany(t);
      const inv = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('certo'), role: 'FINANCIAL' }).expect(201);
      const other = await register(t, 'Outra pessoa');
      await t
        .http()
        .post(`/api/v1/invitations/token/${encodeURIComponent(inviteTokenFrom(inv.body.inviteUrl))}/accept`)
        .set(bearer(other))
        .expect(403);
    });

    it('convite revogado ou expirado não pode ser aceito', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await roomyPlan(company.id);
      const email = uniqueEmail('rev');
      const guest = await register(t, 'Convidado', email);

      const revoked = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email, role: 'DRIVER' }).expect(201);
      await t.http().post(`/api/v1/invitations/${revoked.body.invitation.id}/revoke`).set(bearer(owner)).expect(204);
      await t.http().post(`/api/v1/invitations/token/${encodeURIComponent(inviteTokenFrom(revoked.body.inviteUrl))}/accept`).set(bearer(guest)).expect(404);

      const expired = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email, role: 'DRIVER' }).expect(201);
      await t.prisma.companyInvitation.update({ where: { id: expired.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await t.http().post(`/api/v1/invitations/token/${encodeURIComponent(inviteTokenFrom(expired.body.inviteUrl))}/accept`).set(bearer(guest)).expect(409);

      // Reenviar gera novo link válido e invalida o anterior.
      const resent = await t.http().post(`/api/v1/invitations/${expired.body.invitation.id}/resend`).set(bearer(owner)).expect(200);
      expect(resent.body.inviteUrl).not.toBe(expired.body.inviteUrl);
      await t.http().post(`/api/v1/invitations/token/${encodeURIComponent(inviteTokenFrom(resent.body.inviteUrl))}/accept`).set(bearer(guest)).expect(200);
    });

    it('não convida quem já é membro', async () => {
      const { owner } = await ownerWithCompany(t);
      const res = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: owner.email, role: 'MANAGER' }).expect(409);
      expect(res.body.message).toMatch(/já é membro/);
    });
  });

  describe('limites do plano', () => {
    it('Starter permite 2 usuários contando convites pendentes', async () => {
      const { owner } = await ownerWithCompany(t);
      await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('um'), role: 'DRIVER' }).expect(201);
      const blocked = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('dois'), role: 'DRIVER' }).expect(409);
      expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');

      const sub = await t.http().get('/api/v1/subscription').set(bearer(owner)).expect(200);
      expect(sub.body.limits.maxUsers).toBe(2);
      expect(sub.body.usage.users).toBe(2);
    });

    it('limites vêm do banco: override da assinatura libera mais usuários', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await t.prisma.subscription.update({ where: { companyId: company.id }, data: { overrideMaxUsers: 3 } });
      await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('a'), role: 'DRIVER' }).expect(201);
      await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('b'), role: 'DRIVER' }).expect(201);
      await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('c'), role: 'DRIVER' }).expect(409);
    });

    it('convites simultâneos não ultrapassam o limite', async () => {
      const { owner } = await ownerWithCompany(t);
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail(`par${i}`), role: 'DRIVER' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });

    it('revogar convite libera a vaga; reativar membro respeita o limite', async () => {
      const { owner } = await ownerWithCompany(t);
      const fin = await addMember(t, owner, 'FINANCIAL');
      await t.http().post(`/api/v1/members/${fin.memberId}/deactivate`).set(bearer(owner)).expect(200);

      const inv = await t.http().post('/api/v1/invitations').set(bearer(owner)).send({ email: uniqueEmail('vaga'), role: 'DRIVER' }).expect(201);
      const blocked = await t.http().post(`/api/v1/members/${fin.memberId}/reactivate`).set(bearer(owner)).expect(409);
      expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');

      await t.http().post(`/api/v1/invitations/${inv.body.invitation.id}/revoke`).set(bearer(owner)).expect(204);
      await t.http().post(`/api/v1/members/${fin.memberId}/reactivate`).set(bearer(owner)).expect(200);
    });
  });

  describe('permissões (RBAC)', () => {
    it('motorista: vê a empresa, mas não membros, convites, assinatura nem edição', async () => {
      const { owner } = await ownerWithCompany(t);
      const { member: driver } = await addMember(t, owner, 'DRIVER');
      await t.http().get('/api/v1/companies/current').set(bearer(driver)).expect(200);
      await t.http().get('/api/v1/members').set(bearer(driver)).expect(403);
      await t.http().get('/api/v1/invitations').set(bearer(driver)).expect(403);
      await t.http().post('/api/v1/invitations').set(bearer(driver)).send({ email: uniqueEmail(), role: 'DRIVER' }).expect(403);
      await t.http().get('/api/v1/subscription').set(bearer(driver)).expect(403);
      await t.http().patch('/api/v1/companies/current').set(bearer(driver)).send({ tradeName: 'Novo nome' }).expect(403);

      const me = await t.http().get('/api/v1/auth/me').set(bearer(driver)).expect(200);
      expect(me.body.activeCompany.permissions).toEqual(['company:read', 'expenses:own', 'assignments:own']);
    });

    it('financeiro não gerencia membros; gestor vê membros mas não gerencia', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await roomyPlan(company.id);
      const fin = await addMember(t, owner, 'FINANCIAL');
      const mgr = await addMember(t, owner, 'MANAGER');

      await t.http().get('/api/v1/members').set(bearer(fin.member)).expect(403);
      await t.http().get('/api/v1/members').set(bearer(mgr.member)).expect(200);
      await t.http().patch(`/api/v1/members/${fin.memberId}`).set(bearer(mgr.member)).send({ role: 'DRIVER' }).expect(403);
    });

    it('gestor configurável: permissões extras somam ao papel, apenas as concedíveis', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await roomyPlan(company.id);
      const mgr = await addMember(t, owner, 'MANAGER');

      await t.http().patch(`/api/v1/members/${mgr.memberId}`).set(bearer(owner)).send({ permissions: ['members:manage'] }).expect(400);
      const res = await t.http().patch(`/api/v1/members/${mgr.memberId}`).set(bearer(owner)).send({ permissions: ['finance:read', 'reports:read'] }).expect(200);
      expect(res.body.effectivePermissions).toEqual(expect.arrayContaining(['fleet:manage', 'finance:read', 'reports:read']));

      const me = await t.http().get('/api/v1/auth/me').set(bearer(mgr.member)).expect(200);
      expect(me.body.activeCompany.permissions).toContain('finance:read');
    });

    it('protege o último proprietário e impede alterar o próprio acesso', async () => {
      const { owner, company } = await ownerWithCompany(t);
      await roomyPlan(company.id);
      const ownerMember = await t.prisma.companyMember.findFirstOrThrow({ where: { companyId: company.id, userId: owner.userId } });
      await t.http().patch(`/api/v1/members/${ownerMember.id}`).set(bearer(owner)).send({ role: 'MANAGER' }).expect(403);
      await t.http().post(`/api/v1/members/${ownerMember.id}/deactivate`).set(bearer(owner)).expect(403);

      // Com dois proprietários, um pode rebaixar o outro, mas não o último restante.
      const second = await addMember(t, owner, 'OWNER');
      await t.http().patch(`/api/v1/members/${ownerMember.id}`).set(bearer(second.member)).send({ role: 'MANAGER' }).expect(200);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { companyId: company.id, action: 'member.updated' } });
      expect(audit.before).toMatchObject({ role: 'OWNER' });
      expect(audit.after).toMatchObject({ role: 'MANAGER' });
    });

    it('remove o acesso e audita', async () => {
      const { owner, company } = await ownerWithCompany(t);
      const drv = await addMember(t, owner, 'DRIVER');
      await t.http().delete(`/api/v1/members/${drv.memberId}`).set(bearer(owner)).expect(204);
      await t.http().get('/api/v1/companies/current').set(bearer(drv.member)).expect(403);
      expect(await t.prisma.auditLog.count({ where: { companyId: company.id, action: 'member.removed' } })).toBe(1);
    });

    it('auditoria é append-only no banco', async () => {
      const log = await t.prisma.auditLog.findFirstOrThrow();
      await expect(t.prisma.auditLog.update({ where: { id: log.id }, data: { action: 'adulterado' } })).rejects.toThrow();
      await expect(t.prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
    });
  });

  describe('dados da empresa', () => {
    it('proprietário edita; alteração fica auditada com antes/depois', async () => {
      const { owner, company } = await ownerWithCompany(t, 'Nome Antigo');
      const res = await t.http().patch('/api/v1/companies/current').set(bearer(owner)).send({ tradeName: 'Nome Novo', phone: '(19) 99999-0000' }).expect(200);
      expect(res.body.tradeName).toBe('Nome Novo');
      const log = await t.prisma.auditLog.findFirstOrThrow({ where: { companyId: company.id, action: 'company.updated' } });
      expect(log.before).toMatchObject({ tradeName: 'Nome Antigo' });
      expect(log.after).toMatchObject({ tradeName: 'Nome Novo' });
    });
  });
});
